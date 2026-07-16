/**
 * User position snapshot at a pinned block (Hedera Mainnet, read-only)
 * -------------------------------------------------------------------------
 * Reads every supplied address's position in every reserve AS OF a fixed past
 * block, by issuing historical `eth_call`s (Hedera's mirror node serves archive
 * state, verified back to pool deployment).
 *
 * WHY A BLOCK, NOT A TIMESTAMP: the block is pinned ONCE and every call uses
 * that exact tag. Nothing here ever reads `latest`, so the snapshot is a single
 * consistent instant and is exactly reproducible later.
 *
 * WHAT IT CAPTURES: supply, stable debt, variable debt, reserve liquidity, and
 * USD values calculated from the fixed investigation prices below. For current
 * risk analysis it also derives the same account-level collateral, debt, and
 * health-factor metrics from block-pinned oracle prices and reserve settings.
 * Those metrics are explicitly labelled oracle-derived and must not be used as
 * a reimbursement baseline. Token balances are the ground truth.
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
 *     npx ts-node --transpile-only scripts/snapshotPositions.ts
 *
 *   # re-run the exact same command to retry only the failed users:
 *   RPC_URLS="..." npx ts-node --transpile-only scripts/snapshotPositions.ts
 *
 * Env:
 *   RPC_URLS              comma-separated RPC endpoints (falls back to PROVIDER_URL_MAINNET, then Hashio)
 *   CONCURRENCY_PER_RPC   in-flight requests per endpoint (default 6; raise on paid RPCs)
 *   SNAPSHOT_BLOCK        target block or "latest" (default 97504300)
 *   ADDRESSES_CSV         input csv      (default docs/userPositionAddressesMainnet.csv)
 *   BASELINE_JSON         optional earlier snapshot; queries only each user's known non-zero reserves
 *                         and account data for known borrowers (coverage checks detect missed additions)
 *   BATCH_SIZE            reserve reads per multicall (default 14; auto-splits if gas-bound)
 */
import { ethers } from 'ethers';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

import { LendingPool, AaveProtocolDataProvider } from './outputReserveData.json';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const BLOCK_SETTING = process.env.SNAPSHOT_BLOCK || '97504300';
let BLOCK = 0;
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
const REPO_ROOT = path.resolve(__dirname, '..');
const ADDRESSES_CSV =
  process.env.ADDRESSES_CSV || path.join(REPO_ROOT, 'docs', 'userPositionAddressesMainnet.csv');
const OUT_DIR = path.join(__dirname, 'out');
const BASELINE_JSON = process.env.BASELINE_JSON
  ? path.resolve(process.env.BASELINE_JSON)
  : undefined;

const POOL_ADDR = LendingPool.hedera_mainnet.address;
const DP_ADDR = AaveProtocolDataProvider.hedera_mainnet.address;
const ADDRESSES_PROVIDER_ADDR = require('./outputReserveData.json').LendingPoolAddressesProvider
  .hedera_mainnet.address;

// --------------------------------------------------------------------------
// ABIs (exact fragments needed to encode/decode multicalls)
// --------------------------------------------------------------------------
const POOL_ABI = [
  'function getReservesList() view returns (address[])',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];
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
const ADDRESSES_PROVIDER_ABI = ['function getPriceOracle() view returns (address)'];
const ORACLE_ABI = ['function getAssetPrice(address asset) view returns (uint256)'];

const dpIface = new ethers.utils.Interface(DP_ABI);
const poolIface = new ethers.utils.Interface(POOL_ABI);
let at: { blockTag: number }; // assigned once in main; every subsequent read is pinned.

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
  const provider = new ethers.providers.JsonRpcProvider(url, {
    name: 'hedera_mainnet',
    chainId: 295,
  });
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
  throw new Error(`${label}: ${String(lastErr?.message || lastErr)}`);
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
  availableLiquidity: string;
  totalStableDebt: string;
  totalVariableDebt: string;
  liquidationThreshold: number;
  ltv: number;
  assetPriceBaseRaw: string;
};

type Position = {
  evmAddress: string;
  accountId: string;
  token: string;
  tokenAddress: string;
  decimals: number;
  supplyRaw: string;
  stableBorrowRaw: string;
  variableBorrowRaw: string;
  borrowRaw: string;
  usageAsCollateral: boolean;
};

type AccountData = {
  totalCollateralBaseRaw: string;
  totalDebtBaseRaw: string;
  availableBorrowsBaseRaw: string;
  currentLiquidationThresholdBps: number;
  ltvBps: number;
  healthFactorRaw: string;
};

type UserSnapshot = {
  evmAddress: string;
  accountId: string;
  positions: Position[];
  accountData: AccountData;
};

const baselineByUser = new Map<string, Position[]>();
if (BASELINE_JSON) {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_JSON, 'utf8'));
  if (!baseline.summary?.complete) throw new Error('BASELINE_JSON must be a complete snapshot');
  for (const p of baseline.positions as Position[]) {
    const key = p.evmAddress.toLowerCase();
    const list = baselineByUser.get(key) || [];
    list.push(p);
    baselineByUser.set(key, list);
  }
}

// Fixed investigation prices supplied by the Bonzo team. These are deliberately
// independent of the protocol oracle at the incident block.
const USD_PRICES: Record<string, string> = {
  USDC: '1',
  WHBAR: '0.07',
  HBAR: '0.07',
  HBARX: '0.097',
  SAUCE: '0.01376845',
  DOVU: '0.0011',
  KARATE: '0.000018',
  BONZO: '0.011',
  STEAM: '0.0022',
  HST: '0.0011',
  WETH: '1790',
  XSAUCE: '0.017',
  KBL: '0.0007',
  PACK: '0.0048',
  GRELF: '0.077',
};

const USD_PRICE_DECIMALS = 8;

function decimalValue(raw: string, decimals: number): string {
  return trimDecimal(ethers.utils.formatUnits(raw, decimals));
}

function usdValue(raw: string, decimals: number, price: string): string {
  const scaledPrice = ethers.utils.parseUnits(price, USD_PRICE_DECIMALS);
  return trimDecimal(
    ethers.utils.formatUnits(
      ethers.BigNumber.from(raw).mul(scaledPrice),
      decimals + USD_PRICE_DECIMALS
    )
  );
}

function trimDecimal(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function csvCell(value: string | number | boolean): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
  const addressesProvider = new ethers.Contract(
    ADDRESSES_PROVIDER_ADDR,
    ADDRESSES_PROVIDER_ABI,
    s.provider
  );
  const oracleAddress: any = await callWithBackoff(s, 'getPriceOracle', () =>
    addressesProvider.getPriceOracle(at)
  );
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, s.provider);

  const assets: string[] = await callWithBackoff(s, 'getReservesList', () =>
    poolC.getReservesList(at)
  );
  const tokens: any[] = await callWithBackoff(s, 'getAllReservesTokens', () =>
    dp.getAllReservesTokens(at)
  );
  const symbolOf = new Map<string, string>(
    tokens.map((t: any) => [t.tokenAddress.toLowerCase(), t.symbol])
  );

  const reserves: Reserve[] = [];
  for (const asset of assets) {
    const addrs: any = await callWithBackoff(s, `tokens ${asset}`, () =>
      dp.getReserveTokensAddresses(asset, at)
    );
    const cfg: any = await callWithBackoff(s, `cfg ${asset}`, () =>
      dp.getReserveConfigurationData(asset, at)
    );
    const rd: any = await callWithBackoff(s, `data ${asset}`, () => dp.getReserveData(asset, at));
    const aToken = new ethers.Contract(addrs.aTokenAddress, ERC20_ABI, s.provider);
    const totalSupply: any = await callWithBackoff(s, `supply ${asset}`, () =>
      aToken.totalSupply(at)
    );
    const assetPrice: any = await callWithBackoff(s, `price ${asset}`, () =>
      oracle.getAssetPrice(asset, at)
    );

    reserves.push({
      symbol: symbolOf.get(asset.toLowerCase()) || 'UNKNOWN',
      asset,
      aToken: addrs.aTokenAddress,
      decimals: Number(cfg.decimals),
      liquidityIndex: rd.liquidityIndex.toString(),
      variableBorrowIndex: rd.variableBorrowIndex.toString(),
      aTokenTotalSupply: totalSupply.toString(),
      availableLiquidity: rd.availableLiquidity.toString(),
      totalStableDebt: rd.totalStableDebt.toString(),
      totalVariableDebt: rd.totalVariableDebt.toString(),
      liquidationThreshold: Number(cfg.liquidationThreshold),
      ltv: Number(cfg.ltv),
      assetPriceBaseRaw: assetPrice.toString(),
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
): Promise<UserSnapshot> {
  const key = user.evmAddress.toLowerCase();
  const baselinePositions = baselineByUser.get(key) || [];
  const knownTokens = new Set(baselinePositions.map((p) => p.tokenAddress.toLowerCase()));
  // A user absent from the baseline may have opened a position after it, so query
  // every reserve. Otherwise query the reserves that were known non-zero.
  const reservesToRead = BASELINE_JSON
    ? baselinePositions.length
      ? reserves.filter((r) => knownTokens.has(r.asset.toLowerCase()))
      : reserves
    : reserves;
  const decode = (slice: Reserve[], returns: any[]): Position[] =>
    slice.map((r, i) => {
      const res = returns[i];
      if (!res.success) throw new Error(`sub-call reverted for ${r.symbol}`);
      const d = dpIface.decodeFunctionResult('getUserReserveData', res.returnData);
      return {
        evmAddress: user.evmAddress,
        accountId: user.accountId,
        token: r.symbol.toUpperCase(),
        tokenAddress: r.asset,
        decimals: r.decimals,
        supplyRaw: d.currentATokenBalance.toString(),
        stableBorrowRaw: d.currentStableDebt.toString(),
        variableBorrowRaw: d.currentVariableDebt.toString(),
        borrowRaw: d.currentStableDebt.add(d.currentVariableDebt).toString(),
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
  for (let i = 0; i < reservesToRead.length; i += MAX_BATCH) {
    out.push(...(await fetch(reservesToRead.slice(i, i + MAX_BATCH))));
  }
  const account: AccountData = {
    totalCollateralBaseRaw: '0',
    totalDebtBaseRaw: '0',
    availableBorrowsBaseRaw: '0',
    currentLiquidationThresholdBps: 0,
    ltvBps: 0,
    healthFactorRaw: ethers.constants.MaxUint256.toString(),
  };

  return {
    evmAddress: user.evmAddress,
    accountId: user.accountId,
    positions: out,
    accountData: account,
  };
}

function deriveAccountData(positions: Position[], reserves: Reserve[]): AccountData {
  const reserveByAsset = new Map(reserves.map((r) => [r.asset.toLowerCase(), r]));
  let collateral = ethers.BigNumber.from(0);
  let debt = ethers.BigNumber.from(0);
  let weightedThreshold = ethers.BigNumber.from(0);
  let weightedLtv = ethers.BigNumber.from(0);

  for (const p of positions) {
    const reserve = reserveByAsset.get(p.tokenAddress.toLowerCase());
    if (!reserve) continue;
    const unit = ethers.BigNumber.from(10).pow(p.decimals);
    const price = ethers.BigNumber.from(reserve.assetPriceBaseRaw);
    const suppliedBase = ethers.BigNumber.from(p.supplyRaw).mul(price).div(unit);
    const debtBase = ethers.BigNumber.from(p.borrowRaw).mul(price).div(unit);
    debt = debt.add(debtBase);
    if (p.usageAsCollateral && reserve.liquidationThreshold > 0) {
      collateral = collateral.add(suppliedBase);
      weightedThreshold = weightedThreshold.add(suppliedBase.mul(reserve.liquidationThreshold));
      weightedLtv = weightedLtv.add(suppliedBase.mul(reserve.ltv));
    }
  }

  const thresholdBps = collateral.isZero() ? 0 : Number(weightedThreshold.div(collateral));
  const ltvBps = collateral.isZero() ? 0 : Number(weightedLtv.div(collateral));
  // Match Aave V2 PercentageMath.percentMul and WadRayMath.wadDiv rounding.
  const percentMul = (value: ethers.BigNumber, bps: number) =>
    value.mul(bps).add(5_000).div(10_000);
  const borrowCapacity = percentMul(collateral, ltvBps);
  const available = borrowCapacity.gt(debt) ? borrowCapacity.sub(debt) : ethers.BigNumber.from(0);
  const healthFactor = debt.isZero()
    ? ethers.constants.MaxUint256
    : percentMul(collateral, thresholdBps)
        .mul(ethers.constants.WeiPerEther)
        .add(debt.div(2))
        .div(debt);

  return {
    totalCollateralBaseRaw: collateral.toString(),
    totalDebtBaseRaw: debt.toString(),
    availableBorrowsBaseRaw: available.toString(),
    currentLiquidationThresholdBps: thresholdBps,
    ltvBps,
    healthFactorRaw: healthFactor.toString(),
  };
}

// --------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (BLOCK_SETTING.toLowerCase() === 'latest') {
    BLOCK = await callWithBackoff(shards[0], 'latest block number', () =>
      shards[0].provider.getBlockNumber()
    );
  } else {
    BLOCK = Number(BLOCK_SETTING);
    if (!Number.isSafeInteger(BLOCK) || BLOCK <= 0) {
      throw new Error(`Invalid SNAPSHOT_BLOCK: ${BLOCK_SETTING}`);
    }
  }
  at = { blockTag: BLOCK };
  const addressFileHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(ADDRESSES_CSV))
    .digest('hex')
    .slice(0, 12);
  const scanKey = BASELINE_JSON
    ? `baseline-${crypto
        .createHash('sha256')
        .update(fs.readFileSync(BASELINE_JSON))
        .digest('hex')
        .slice(0, 12)}`
    : 'full';
  const CHECKPOINT = path.join(
    OUT_DIR,
    `snapshot-${BLOCK}-${addressFileHash}-${scanKey}.v3.checkpoint.jsonl`
  );

  const users = readAddresses();
  console.log(`Loading historical block ${BLOCK} for ${users.length} addresses...`);
  const block = await callWithBackoff(shards[0], `block ${BLOCK}`, () =>
    shards[0].provider.getBlock(BLOCK)
  );
  const blockISO = new Date(block.timestamp * 1000).toISOString();

  console.log('=== Bonzo user position snapshot (read-only) ===');
  console.log('Block      :', BLOCK, `(${blockISO})`);
  console.log('Addresses  :', users.length);
  console.log('Baseline   :', BASELINE_JSON || 'none (full reserve scan)');
  console.log('RPC shards :', shards.length);
  shards.forEach((s) => console.log('   -', maskRpc(s.url)));
  console.log(
    'Throughput :',
    `${CONCURRENCY_PER_RPC}/rpc x ${shards.length} rpc = ${
      CONCURRENCY_PER_RPC * shards.length
    } in flight`
  );

  // Multicall3 must have code at the target block or every batched call reverts.
  const mcCode = await callWithBackoff(shards[0], 'Multicall3 code', () =>
    shards[0].provider.getCode(MULTICALL3, BLOCK)
  );
  if (mcCode === '0x') {
    throw new Error(`Multicall3 has no code at block ${BLOCK}. Set BATCH_SIZE=1 to run unbatched.`);
  }
  console.log('Multicall3 : code present at target block\n');

  const reserves = await loadReserves();
  const reserveConfig = require('./outputReserveData.json');
  for (const reserve of reserves) {
    const token = reserve.symbol.toUpperCase();
    const configuredAddress = reserveConfig[token]?.hedera_mainnet?.token?.address;
    if (!USD_PRICES[token]) throw new Error(`Missing fixed USD price for ${token}`);
    if (!configuredAddress) throw new Error(`Missing mainnet token address for ${token}`);
    if (configuredAddress.toLowerCase() !== reserve.asset.toLowerCase()) {
      throw new Error(
        `${token} address mismatch: chain=${reserve.asset}, outputReserveData=${configuredAddress}`
      );
    }
  }
  console.log(`Reserves @ block: ${reserves.map((r) => r.symbol).join(', ')}\n`);

  // Resume. Only SUCCESSFUL users were ever checkpointed, so whatever failed on
  // a previous run is simply still in `todo` - re-running retries exactly those.
  const done = new Map<string, UserSnapshot>();
  if (fs.existsSync(CHECKPOINT)) {
    for (const line of fs.readFileSync(CHECKPOINT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.accountData && Array.isArray(rec.positions)) {
          done.set(rec.evmAddress.toLowerCase(), rec);
        }
      } catch {
        /* tolerate a torn final line from a hard kill */
      }
    }
  }

  const todo = users.filter((u) => !done.has(u.evmAddress.toLowerCase()));
  if (done.size) {
    console.log(
      `Resuming: ${done.size} done, ${todo.length} to fetch (incl. any prior failures)\n`
    );
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
      const snapshot = await readUser(shard, u, reserves);
      done.set(u.evmAddress.toLowerCase(), snapshot);
      ckpt.write(JSON.stringify(snapshot) + '\n');
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
        `\r  ${completed}/${todo.length} | ${rate.toFixed(2)}/s | ETA ${Math.floor(
          eta / 60
        )}m${String(eta % 60).padStart(2, '0')}s | ${failures.length} failed  `
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
  const accountData: UserSnapshot[] = [];
  let succeeded = 0;
  for (const u of users) {
    const snapshot = done.get(u.evmAddress.toLowerCase());
    if (snapshot) {
      snapshot.accountData = deriveAccountData(snapshot.positions, reserves);
      succeeded++;
      all.push(...snapshot.positions);
      accountData.push(snapshot);
    }
  }
  const nonZero = all.filter((p) => p.supplyRaw !== '0' || p.borrowRaw !== '0');

  // ---- coverage ----
  const coverage = reserves.map((r) => {
    const summed = all
      .filter((p) => p.tokenAddress.toLowerCase() === r.asset.toLowerCase())
      .reduce((acc, p) => acc.add(ethers.BigNumber.from(p.supplyRaw)), ethers.BigNumber.from(0));
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
  const columns = [
    'evmAddress',
    'accountId',
    'token',
    'tokenAddress',
    'supplyTokens',
    'supplyUsd',
    'borrowTokens',
    'borrowUsd',
    'stableBorrowTokens',
    'variableBorrowTokens',
    'usageAsCollateral',
  ];
  fs.writeFileSync(
    csvPath,
    columns.join(',') +
      '\n' +
      nonZero
        .map((p) => {
          const price = USD_PRICES[p.token];
          return [
            p.evmAddress,
            p.accountId,
            p.token,
            p.tokenAddress,
            decimalValue(p.supplyRaw, p.decimals),
            usdValue(p.supplyRaw, p.decimals, price),
            decimalValue(p.borrowRaw, p.decimals),
            usdValue(p.borrowRaw, p.decimals, price),
            decimalValue(p.stableBorrowRaw, p.decimals),
            decimalValue(p.variableBorrowRaw, p.decimals),
            p.usageAsCollateral,
          ]
            .map(csvCell)
            .join(',');
        })
        .join('\n') +
      '\n'
  );

  const usersCsvPath = path.join(OUT_DIR, `snapshot-${BLOCK}-users.csv`);
  const userColumns = [
    'evmAddress',
    'accountId',
    'totalCollateralBase',
    'totalDebtBase',
    'availableBorrowsBase',
    'currentLiquidationThresholdBps',
    'ltvBps',
    'healthFactor',
  ];
  fs.writeFileSync(
    usersCsvPath,
    userColumns.join(',') +
      '\n' +
      accountData
        .filter((u) => u.positions.some((p) => p.supplyRaw !== '0' || p.borrowRaw !== '0'))
        .map((u) => {
          const a = u.accountData;
          const hasDebt = a.totalDebtBaseRaw !== '0';
          return [
            u.evmAddress,
            u.accountId,
            decimalValue(a.totalCollateralBaseRaw, 18),
            decimalValue(a.totalDebtBaseRaw, 18),
            decimalValue(a.availableBorrowsBaseRaw, 18),
            a.currentLiquidationThresholdBps,
            a.ltvBps,
            hasDebt ? decimalValue(a.healthFactorRaw, 18) : '',
          ]
            .map(csvCell)
            .join(',');
        })
        .join('\n') +
      '\n'
  );

  const borrowers = accountData.filter((u) => u.accountData.totalDebtBaseRaw !== '0');
  const healthFactorNumber = (u: UserSnapshot) =>
    Number(ethers.utils.formatUnits(u.accountData.healthFactorRaw, 18));
  const healthFactorSummary = {
    borrowers: borrowers.length,
    atOrBelow1: borrowers.filter((u) => healthFactorNumber(u) <= 1).length,
    above1To1_05: borrowers.filter((u) => {
      const hf = healthFactorNumber(u);
      return hf > 1 && hf <= 1.05;
    }).length,
    above1_05To1_10: borrowers.filter((u) => {
      const hf = healthFactorNumber(u);
      return hf > 1.05 && hf <= 1.1;
    }).length,
    above1_10To1_25: borrowers.filter((u) => {
      const hf = healthFactorNumber(u);
      return hf > 1.1 && hf <= 1.25;
    }).length,
    above1_25: borrowers.filter((u) => healthFactorNumber(u) > 1.25).length,
  };

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
          valuation: {
            source: 'Fixed USD prices used for consistent snapshot comparison',
            pricesUsd: USD_PRICES,
          },
          note: 'Historical token balances at one pinned block. USD values use fixed investigation prices, not the protocol oracle.',
          accountDataNote:
            'Account collateral, debt, borrowing power, liquidation threshold, LTV, and health factor are derived from block-pinned protocol oracle prices, reserve configuration, and user balances.',
          scanMode: BASELINE_JSON
            ? `Baseline-guided reserve scan using ${path.relative(REPO_ROOT, BASELINE_JSON)}; reserve coverage detects positions opened in previously unused reserves.`
            : 'Full reserve scan for every supplied address.',
        },
        reserves,
        coverage,
        summary: {
          usersQueried: users.length,
          usersSucceeded: succeeded,
          usersMissing: users.length - succeeded,
          usersFailed: failures.length,
          usersWithPosition: new Set(nonZero.map((p) => p.evmAddress)).size,
          nonZeroPositions: nonZero.length,
          healthFactors: healthFactorSummary,
          complete: succeeded === users.length,
        },
        positions: nonZero,
        users: accountData
          .filter((u) => u.positions.some((p) => p.supplyRaw !== '0' || p.borrowRaw !== '0'))
          .map((u) => ({
            evmAddress: u.evmAddress,
            accountId: u.accountId,
            ...u.accountData,
          })),
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
      console.log(
        `   ${g.symbol.padEnd(8)} ${g.coveragePct.toFixed(2)}% covered, shortfall ${g.shortfall}`
      );
    }
    console.log('   Holders are missing from the list; payouts from it would under-count.\n');
  } else {
    console.log('Supplied addresses account for ~100% of every reserve.\n');
  }

  console.log(`Users queried      : ${users.length}`);
  console.log(`Users succeeded    : ${succeeded}`);
  console.log(`Users with position: ${new Set(nonZero.map((p) => p.evmAddress)).size}`);
  console.log(`Non-zero positions : ${nonZero.length}`);
  console.log(`Borrowers          : ${healthFactorSummary.borrowers}`);
  console.log(`HF <= 1            : ${healthFactorSummary.atOrBelow1}`);
  console.log(`1 < HF <= 1.10     : ${
    healthFactorSummary.above1To1_05 + healthFactorSummary.above1_05To1_10
  }`);

  if (succeeded < users.length) {
    console.log(
      `\nINCOMPLETE: ${users.length - succeeded} of ${users.length} users missing (${
        failures.length
      } failed this run).`
    );
    console.log('They are NOT written as zeros. Re-run the same command to retry only those.');
  } else {
    console.log('\nCOMPLETE: every address in the list fetched successfully.');
  }
  console.log(`\nCSV : ${csvPath}`);
  console.log(`Users: ${usersCsvPath}`);
  console.log(`JSON: ${jsonPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
