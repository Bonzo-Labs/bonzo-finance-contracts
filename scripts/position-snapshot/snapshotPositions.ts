/**
 * User position snapshot at a historical block (Hedera Mainnet, read-only)
 * -------------------------------------------------------------------------
 * Reads every supplied address's position in every reserve AS OF a fixed past
 * block, by issuing historical `eth_call`s (Hedera's mirror node serves archive
 * state, verified back to pool deployment).
 *
 * WHY A BLOCK, NOT A TIMESTAMP: the block is pinned ONCE and every call uses
 * that exact tag. Nothing here ever reads `latest`, so the snapshot is a single
 * consistent instant and is exactly reproducible later.
 *
 * WHAT IT CAPTURES: raw balances only - currentATokenBalance, currentStableDebt,
 * currentVariableDebt, scaledVariableDebt, usageAsCollateralEnabled. It
 * deliberately does NOT call getUserAccountData or the oracle: those return
 * USD/health-factor figures derived from whatever price the oracle reported at
 * that block, which is not a trustworthy basis for a reimbursement baseline.
 * Token balances are ground truth; oracle-derived values are not.
 *
 * THROUGHPUT: work is sharded across N RPC endpoints (RPC_URLS), each with its
 * own concurrency budget, so total in-flight = N x CONCURRENCY_PER_RPC. One
 * Multicall3 request per user bundles that user's reserve reads.
 *
 * ERROR HANDLING - the important part. Hedera returns a *generic* "missing
 * revert data" for BOTH a gas-cap overflow AND for rate limiting, so the error
 * text alone cannot tell them apart. We therefore always back off and retry
 * first (fixes rate limiting), and only split the batch after retries are
 * exhausted AND the batch is >1 (fixes gas). Splitting on the first failure
 * would multiply requests and make rate limiting worse, not better.
 *
 * RESUMABLE: each SUCCESSFUL user is appended to a JSONL checkpoint. Failures
 * are never checkpointed, so simply re-running the script retries exactly the
 * users that failed and skips everything already done. A failed read is never
 * written out as a zero balance.
 *
 * COVERAGE CHECK: per reserve, the summed aToken balance across the supplied
 * addresses is compared to that aToken's totalSupply() at the same block. A
 * shortfall means the address list does not cover every holder - important to
 * know before computing payouts from it.
 *
 * Read-only. No signer, no private key; it cannot modify state.
 *
 * Usage:
 *   RPC_URLS="https://paid1/api,https://paid2/api" CONCURRENCY_PER_RPC=10 \
 *     npx hardhat run scripts/position-snapshot/snapshotPositions.ts
 *
 *   # re-run the exact same command to retry only the failed users:
 *   RPC_URLS="..." npx hardhat run scripts/position-snapshot/snapshotPositions.ts
 *
 * Env:
 *   RPC_URLS              comma-separated RPC endpoints (falls back to PROVIDER_URL_MAINNET, then Hashio)
 *   CONCURRENCY_PER_RPC   in-flight requests per endpoint (default 6; raise on paid RPCs)
 *   SNAPSHOT_BLOCK        target block   (default 97504300)
 *   ADDRESSES_CSV         input csv      (default userPositionAddressesMainnet.csv at repo root)
 *   BATCH_SIZE            reserve reads per multicall (default 14; auto-splits if gas-bound)
 */
import { ethers } from 'hardhat';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

import { LendingPool, AaveProtocolDataProvider } from '../outputReserveData.json';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const BLOCK = Number(process.env.SNAPSHOT_BLOCK || 97504300);
const CONCURRENCY_PER_RPC = Number(process.env.CONCURRENCY_PER_RPC || 6);
const MAX_BATCH = Number(process.env.BATCH_SIZE || 14);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 6);

const RPC_URLS: string[] = (
  process.env.RPC_URLS ||
  process.env.PROVIDER_URL_MAINNET ||
  'https://mainnet.hashio.io/api'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const REPO_ROOT = path.resolve(__dirname, '../..');
const ADDRESSES_CSV =
  process.env.ADDRESSES_CSV || path.join(REPO_ROOT, 'userPositionAddressesMainnet.csv');
const OUT_DIR = path.join(__dirname, 'out');

const POOL_ADDR = LendingPool.hedera_mainnet.address;
const DP_ADDR = AaveProtocolDataProvider.hedera_mainnet.address;

// --------------------------------------------------------------------------
// ABIs (exact fragments needed to encode/decode multicalls)
// --------------------------------------------------------------------------
const POOL_ABI = ['function getReservesList() view returns (address[])'];
const DP_ABI = [
  'function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])',
  'function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveData(address asset) view returns (uint256 availableLiquidity, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)',
];
const MC3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
];
const ERC20_ABI = ['function totalSupply() view returns (uint256)'];

const dpIface = new ethers.utils.Interface(DP_ABI);
const at = { blockTag: BLOCK }; // every read pinned to this block. Never `latest`.

// --------------------------------------------------------------------------
// RPC shards. Each endpoint gets its own provider and its own in-flight budget,
// plus a cooldown that engages when that endpoint starts rate-limiting us.
// --------------------------------------------------------------------------
type Shard = {
  url: string;
  provider: ethers.providers.JsonRpcProvider;
  mc: ethers.Contract;
  cooldownUntil: number;
  consecutiveFails: number;
  ok: number;
  failed: number;
};

const shards: Shard[] = RPC_URLS.map((url) => {
  const provider = new ethers.providers.JsonRpcProvider(url);
  return {
    url,
    provider,
    mc: new ethers.Contract(MULTICALL3, MC3_ABI, provider),
    cooldownUntil: 0,
    consecutiveFails: 0,
    ok: 0,
    failed: 0,
  };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Paid endpoints embed API keys. Never print one - to stdout or into the JSON. */
function maskRpc(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? '/***' : '';
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return '***';
  }
}

/**
 * Hedera reports a gas-cap overflow and a rate-limit rejection with the SAME
 * generic message, so we cannot classify on text. Treat everything as
 * potentially transient: back off and retry. Only the caller, after retries are
 * spent, decides that a >1 batch might be gas-bound and splits it.
 */
async function callWithBackoff<T>(shard: Shard, label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const wait = shard.cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const out = await fn();
      shard.consecutiveFails = 0;
      shard.ok++;
      return out;
    } catch (e: any) {
      lastErr = e;
      shard.consecutiveFails++;
      // Repeated failures on this endpoint mean we're pushing it too hard.
      // Cool the whole shard down, not just this one call, so every worker on
      // it eases off together.
      const backoff = Math.min(1000 * 2 ** i, 30_000);
      if (shard.consecutiveFails >= 3) {
        shard.cooldownUntil = Date.now() + backoff;
      }
      await sleep(backoff * (0.5 + Math.random() * 0.5)); // jitter: avoid lockstep retries
    }
  }
  throw lastErr;
}

/** Bounded-concurrency pool where each worker is pinned to one RPC shard. */
async function shardedPool<T>(items: T[], worker: (item: T, shard: Shard) => Promise<void>) {
  let next = 0;
  const runners: Promise<void>[] = [];
  for (const shard of shards) {
    for (let c = 0; c < CONCURRENCY_PER_RPC; c++) {
      runners.push(
        (async () => {
          while (true) {
            const i = next++;
            if (i >= items.length) return;
            await worker(items[i], shard);
          }
        })()
      );
    }
  }
  await Promise.all(runners);
}

type Reserve = {
  symbol: string;
  asset: string;
  aToken: string;
  decimals: number;
  liquidityIndex: string;
  variableBorrowIndex: string;
  aTokenTotalSupply: string;
};

type Position = {
  user: string;
  accountId: string;
  symbol: string;
  asset: string;
  decimals: number;
  aTokenBalance: string;
  stableDebt: string;
  variableDebt: string;
  scaledVariableDebt: string;
  usageAsCollateral: boolean;
};

// --------------------------------------------------------------------------
function readAddresses(): Array<{ evmAddress: string; accountId: string }> {
  const raw = fs.readFileSync(ADDRESSES_CSV, 'utf8').trim();
  const out: Array<{ evmAddress: string; accountId: string }> = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const [a, b] = line.split(',').map((s: string) => (s || '').trim());
    if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) continue; // also skips the header
    const key = a.toLowerCase();
    if (seen.has(key)) continue; // de-dupe: a repeat would double-count in coverage
    seen.add(key);
    out.push({ evmAddress: ethers.utils.getAddress(a), accountId: b || '' });
  }
  return out;
}

// --------------------------------------------------------------------------
// Reserve metadata read AT THE TARGET BLOCK - today's reserve set may differ.
// --------------------------------------------------------------------------
async function loadReserves(): Promise<Reserve[]> {
  const s = shards[0];
  const poolC = new ethers.Contract(POOL_ADDR, POOL_ABI, s.provider);
  const dp = new ethers.Contract(DP_ADDR, DP_ABI, s.provider);

  const assets: string[] = await callWithBackoff(s, 'getReservesList', () => poolC.getReservesList(at));
  const tokens: any[] = await callWithBackoff(s, 'getAllReservesTokens', () => dp.getAllReservesTokens(at));
  const symbolOf = new Map<string, string>(
    tokens.map((t: any) => [t.tokenAddress.toLowerCase(), t.symbol])
  );

  const reserves: Reserve[] = [];
  for (const asset of assets) {
    const addrs = await callWithBackoff(s, `tokens ${asset}`, () => dp.getReserveTokensAddresses(asset, at));
    const cfg = await callWithBackoff(s, `cfg ${asset}`, () => dp.getReserveConfigurationData(asset, at));
    const rd = await callWithBackoff(s, `data ${asset}`, () => dp.getReserveData(asset, at));
    const aToken = new ethers.Contract(addrs.aTokenAddress, ERC20_ABI, s.provider);
    const totalSupply = await callWithBackoff(s, `supply ${asset}`, () => aToken.totalSupply(at));

    reserves.push({
      symbol: symbolOf.get(asset.toLowerCase()) || 'UNKNOWN',
      asset,
      aToken: addrs.aTokenAddress,
      decimals: Number(cfg.decimals),
      liquidityIndex: rd.liquidityIndex.toString(),
      variableBorrowIndex: rd.variableBorrowIndex.toString(),
      aTokenTotalSupply: totalSupply.toString(),
    });
  }
  return reserves;
}

// --------------------------------------------------------------------------
// One user across all reserves, batched via Multicall3 at the pinned block.
// --------------------------------------------------------------------------
async function readUser(
  shard: Shard,
  user: { evmAddress: string; accountId: string },
  reserves: Reserve[]
): Promise<Position[]> {
  const decode = (slice: Reserve[], returns: any[]): Position[] =>
    slice.map((r, i) => {
      const res = returns[i];
      if (!res.success) throw new Error(`sub-call reverted for ${r.symbol}`);
      const d = dpIface.decodeFunctionResult('getUserReserveData', res.returnData);
      return {
        user: user.evmAddress,
        accountId: user.accountId,
        symbol: r.symbol,
        asset: r.asset,
        decimals: r.decimals,
        aTokenBalance: d.currentATokenBalance.toString(),
        stableDebt: d.currentStableDebt.toString(),
        variableDebt: d.currentVariableDebt.toString(),
        scaledVariableDebt: d.scaledVariableDebt.toString(),
        usageAsCollateral: d.usageAsCollateralEnabled,
      };
    });

  const fetch = async (slice: Reserve[]): Promise<Position[]> => {
    const calls = slice.map((r) => ({
      target: DP_ADDR,
      allowFailure: false,
      callData: dpIface.encodeFunctionData('getUserReserveData', [r.asset, user.evmAddress]),
    }));
    try {
      // Retries first. If this is rate limiting, backoff fixes it and we never
      // split - splitting would only add load.
      const returns = await callWithBackoff(shard, `${user.evmAddress} x${slice.length}`, () =>
        shard.mc.callStatic.aggregate3(calls, at)
      );
      return decode(slice, returns);
    } catch (e: any) {
      // Retries exhausted. A multi-call batch may genuinely be gas-bound, so
      // now (and only now) is splitting the right move.
      if (slice.length === 1) throw e;
      const mid = Math.ceil(slice.length / 2);
      const a = await fetch(slice.slice(0, mid));
      const b = await fetch(slice.slice(mid));
      return [...a, ...b];
    }
  };

  const out: Position[] = [];
  for (let i = 0; i < reserves.length; i += MAX_BATCH) {
    out.push(...(await fetch(reserves.slice(i, i + MAX_BATCH))));
  }
  return out;
}

// --------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const CHECKPOINT = path.join(OUT_DIR, `snapshot-${BLOCK}.checkpoint.jsonl`);

  const users = readAddresses();
  const block = await shards[0].provider.getBlock(BLOCK);
  const blockISO = new Date(block.timestamp * 1000).toISOString();

  console.log('=== Bonzo user position snapshot (read-only) ===');
  console.log('Block      :', BLOCK, `(${blockISO})`);
  console.log('Addresses  :', users.length);
  console.log('RPC shards :', shards.length);
  shards.forEach((s) => console.log('   -', maskRpc(s.url)));
  console.log(
    'Throughput :',
    `${CONCURRENCY_PER_RPC}/rpc x ${shards.length} rpc = ${CONCURRENCY_PER_RPC * shards.length} in flight`
  );

  // Multicall3 must have code at the target block or every batched call reverts.
  const mcCode = await shards[0].provider.getCode(MULTICALL3, BLOCK);
  if (mcCode === '0x') {
    throw new Error(`Multicall3 has no code at block ${BLOCK}. Set BATCH_SIZE=1 to run unbatched.`);
  }
  console.log('Multicall3 : code present at target block\n');

  const reserves = await loadReserves();
  console.log(`Reserves @ block: ${reserves.map((r) => r.symbol).join(', ')}\n`);

  // Resume. Only SUCCESSFUL users were ever checkpointed, so whatever failed on
  // a previous run is simply still in `todo` - re-running retries exactly those.
  const done = new Map<string, Position[]>();
  if (fs.existsSync(CHECKPOINT)) {
    for (const line of fs.readFileSync(CHECKPOINT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        done.set(rec.user.toLowerCase(), rec.positions);
      } catch {
        /* tolerate a torn final line from a hard kill */
      }
    }
  }

  const todo = users.filter((u) => !done.has(u.evmAddress.toLowerCase()));
  if (done.size) {
    console.log(`Resuming: ${done.size} done, ${todo.length} to fetch (incl. any prior failures)\n`);
  }
  if (!todo.length) {
    console.log('Nothing to fetch - all users already in checkpoint.\n');
  }

  const ckpt = fs.createWriteStream(CHECKPOINT, { flags: 'a' });
  const failures: Array<{ user: string; error: string }> = [];
  let completed = 0;
  const t0 = Date.now();

  await shardedPool(todo, async (u, shard) => {
    try {
      const positions = await readUser(shard, u, reserves);
      done.set(u.evmAddress.toLowerCase(), positions);
      ckpt.write(JSON.stringify({ user: u.evmAddress, positions }) + '\n');
    } catch (e: any) {
      shard.failed++;
      // Recorded, never checkpointed -> the next run retries exactly this user.
      failures.push({ user: u.evmAddress, error: String(e?.message || e).slice(0, 140) });
    }
    completed++;
    if (completed % 20 === 0 || completed === todo.length) {
      const el = (Date.now() - t0) / 1000;
      const rate = completed / el;
      const eta = Math.round((todo.length - completed) / Math.max(rate, 0.01));
      process.stdout.write(
        `\r  ${completed}/${todo.length} | ${rate.toFixed(2)}/s | ETA ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s | ${failures.length} failed  `
      );
    }
  });
  ckpt.end();
  await new Promise((r) => ckpt.on('close', r)); // flush before we read anything back
  console.log('\n');

  shards.forEach((s) => console.log(`  rpc ${maskRpc(s.url)} -> ${s.ok} ok, ${s.failed} failed`));
  console.log('');

  // ---- assemble ----
  // The checkpoint is a cache keyed by block, so it can hold users from an
  // earlier run over a different address file. Count and report ONLY the users
  // in the current list - never `done.size`, which would over-report.
  const all: Position[] = [];
  let succeeded = 0;
  for (const u of users) {
    const p = done.get(u.evmAddress.toLowerCase());
    if (p) {
      succeeded++;
      all.push(...p);
    }
  }
  const nonZero = all.filter(
    (p) => p.aTokenBalance !== '0' || p.stableDebt !== '0' || p.variableDebt !== '0'
  );

  // ---- coverage ----
  const coverage = reserves.map((r) => {
    const summed = all
      .filter((p) => p.asset.toLowerCase() === r.asset.toLowerCase())
      .reduce((acc, p) => acc.add(ethers.BigNumber.from(p.aTokenBalance)), ethers.BigNumber.from(0));
    const total = ethers.BigNumber.from(r.aTokenTotalSupply);
    const pct = total.isZero() ? 100 : Number(summed.mul(10000).div(total).toString()) / 100;
    return {
      symbol: r.symbol,
      suppliedSum: ethers.utils.formatUnits(summed, r.decimals),
      aTokenTotalSupply: ethers.utils.formatUnits(total, r.decimals),
      coveragePct: pct,
      shortfall: ethers.utils.formatUnits(total.sub(summed), r.decimals),
    };
  });

  // ---- outputs ----
  const csvPath = path.join(OUT_DIR, `snapshot-${BLOCK}.csv`);
  const header =
    'user,accountId,symbol,asset,decimals,aTokenBalance,aTokenBalanceRaw,stableDebt,stableDebtRaw,variableDebt,variableDebtRaw,usageAsCollateral\n';
  fs.writeFileSync(
    csvPath,
    header +
      nonZero
        .map((p) =>
          [
            p.user,
            p.accountId,
            p.symbol,
            p.asset,
            p.decimals,
            ethers.utils.formatUnits(p.aTokenBalance, p.decimals),
            p.aTokenBalance,
            ethers.utils.formatUnits(p.stableDebt, p.decimals),
            p.stableDebt,
            ethers.utils.formatUnits(p.variableDebt, p.decimals),
            p.variableDebt,
            p.usageAsCollateral,
          ].join(',')
        )
        .join('\n') +
      '\n'
  );

  const jsonPath = path.join(OUT_DIR, `snapshot-${BLOCK}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        metadata: {
          network: 'hedera_mainnet',
          block: BLOCK,
          blockTimestamp: block.timestamp,
          blockTimestampISO: blockISO,
          lendingPool: POOL_ADDR,
          dataProvider: DP_ADDR,
          multicall3: MULTICALL3,
          addressesFile: path.relative(REPO_ROOT, ADDRESSES_CSV),
          addressCount: users.length,
          generatedAt: new Date().toISOString(),
          note: 'Raw token balances only. No oracle prices or health factors: oracle-derived values at this block are not a trustworthy basis for reimbursement.',
        },
        reserves,
        coverage,
        summary: {
          usersQueried: users.length,
          usersSucceeded: succeeded,
          usersMissing: users.length - succeeded,
          usersFailed: failures.length,
          usersWithPosition: new Set(nonZero.map((p) => p.user)).size,
          nonZeroPositions: nonZero.length,
          complete: succeeded === users.length,
        },
        positions: nonZero,
        failures,
      },
      null,
      2
    ) + '\n'
  );

  // ---- report ----
  console.log('=== coverage (supplied addresses vs aToken totalSupply @ block) ===');
  console.table(
    coverage.map((c) => ({
      symbol: c.symbol,
      suppliedSum: c.suppliedSum,
      aTokenTotalSupply: c.aTokenTotalSupply,
      'coverage%': c.coveragePct.toFixed(2),
    }))
  );

  const gaps = coverage.filter((c) => c.coveragePct < 99);
  if (gaps.length) {
    console.log('WARNING: supplied addresses do not fully cover these reserves:');
    for (const g of gaps) {
      console.log(`   ${g.symbol.padEnd(8)} ${g.coveragePct.toFixed(2)}% covered, shortfall ${g.shortfall}`);
    }
    console.log('   Holders are missing from the list; payouts from it would under-count.\n');
  } else {
    console.log('Supplied addresses account for ~100% of every reserve.\n');
  }

  console.log(`Users queried      : ${users.length}`);
  console.log(`Users succeeded    : ${succeeded}`);
  console.log(`Users with position: ${new Set(nonZero.map((p) => p.user)).size}`);
  console.log(`Non-zero positions : ${nonZero.length}`);

  if (succeeded < users.length) {
    console.log(
      `\nINCOMPLETE: ${users.length - succeeded} of ${users.length} users missing (${failures.length} failed this run).`
    );
    console.log('They are NOT written as zeros. Re-run the same command to retry only those.');
  } else {
    console.log('\nCOMPLETE: every address in the list fetched successfully.');
  }
  console.log(`\nCSV : ${csvPath}`);
  console.log(`JSON: ${jsonPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
