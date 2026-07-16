/**
 * Definitive Bonzo position snapshots (Hedera Mainnet, read-only)
 * -------------------------------------------------------------------------
 * Reads every supplied address's position in every reserve AS OF a fixed past
 * block, by issuing historical `eth_call`s (Hedera's mirror node serves archive
 * state, verified back to pool deployment).
 *
 * WHY A BLOCK, NOT A TIMESTAMP: the block is pinned ONCE and every call uses
 * that exact tag. Nothing here ever reads `latest`, so the snapshot is a single
 * consistent instant and is exactly reproducible later.
 *
 * WHAT IT CAPTURES: exact supply and variable-debt balances, reserve state,
 * collateral usage, and reconstructed account risk at each pinned block. Each
 * final CSV pivots all reserves into one row per user and values them
 * consistently in fixed-price USD and HBAR terms. Stable debt is omitted from
 * CSV and asserted to be zero.
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
 * RESUMABLE: while a run is incomplete, each successful user is appended to a
 * temporary JSONL checkpoint. Failures are never checkpointed, so re-running
 * retries exactly the users that failed and skips everything already done. A
 * failed read is never written out as a zero balance. After a successful run,
 * all checkpoints and diagnostics are deleted, leaving only final CSV files.
 *
 * COVERAGE CHECK: per reserve, the summed aToken balance across the supplied
 * addresses is compared to that aToken's totalSupply() at the same block. A
 * shortfall means the address list does not cover every holder - important to
 * know before computing payouts from it.
 *
 * Read-only. No signer, no private key; it cannot modify state.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/position-snapshot/createPositionSnapshots.ts
 *   npx ts-node --transpile-only scripts/position-snapshot/createPositionSnapshots.ts --all
 *   npx ts-node --transpile-only scripts/position-snapshot/createPositionSnapshots.ts --after-pause-only
 *   npx ts-node --transpile-only scripts/position-snapshot/createPositionSnapshots.ts --health-factors-only
 *   npx ts-node --transpile-only scripts/position-snapshot/createPositionSnapshots.ts --health-factors-only path/to/snapshot.csv
 *
 * Env:
 *   RPC_URLS              comma-separated RPC endpoints (falls back to PROVIDER_URL_MAINNET, then Hashio)
 *   CONCURRENCY_PER_RPC   in-flight requests per endpoint (default 6; raise on paid RPCs)
 *   ADDRESSES_CSV         seed csv (default docs/userPositionAddressesMainnet.csv)
 *   BATCH_SIZE            reserve reads per multicall (default 14; auto-splits if gas-bound)
 */
import { ethers } from 'hardhat';
import {
  DEFINITIONS,
  generatePositionSnapshotSummary,
  parseCsv,
  SUMMARY_FILE_NAME,
} from './generatePositionSnapshotSummary';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

import { LendingPool, AaveProtocolDataProvider } from '../outputReserveData.json';

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------
const CONCURRENCY_PER_RPC = Number(process.env.CONCURRENCY_PER_RPC || 6);
const MAX_BATCH = Number(process.env.BATCH_SIZE || 14);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 6);
const SCHEMA_VERSION = 2;
const MIRROR = 'https://mainnet-public.mirrornode.hedera.com';

type SnapshotPoint = {
  name: string;
  block: number;
  expectedTimestamp?: number;
  boundaryTxHash?: string;
};

const PRESETS: Record<string, SnapshotPoint> = {
  'pre-exploit': { name: 'pre-exploit', block: 97504300, expectedTimestamp: 1783730342 },
  'after-pause': {
    name: 'after-pause',
    block: 97506158,
    expectedTimestamp: 1783734058,
    boundaryTxHash: '0x4308e96070ee0fcbb361f71b0ed7399afe0447fc38c993b7d5cee29d449a0114',
  },
  'post-rates': {
    name: 'post-rates',
    block: 97702331,
    expectedTimestamp: 1784126432,
    boundaryTxHash: '0x036f791f4bd52e3454c57b17f3c7ce8ac636a2a807164302a36d22ee18f55630',
  },
};

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
  process.env.ADDRESSES_CSV || path.join(REPO_ROOT, 'docs', 'userPositionAddressesMainnet.csv');
const OUT_DIR = path.join(__dirname, 'out');
const FINAL_CSV_NAMES: Record<string, string> = {
  'pre-exploit': '01-positions-before-exploit.csv',
  'after-pause': '02-positions-after-pause.csv',
  'post-rates': '03-positions-after-interest-rate-changes.csv',
};

const POOL_ADDR = LendingPool.hedera_mainnet.address;
const DP_ADDR = AaveProtocolDataProvider.hedera_mainnet.address;
const AP_ADDR = require('../outputReserveData.json').LendingPoolAddressesProvider.hedera_mainnet
  .address;

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
const FIXED_HBAR_USD = USD_PRICES.WHBAR;

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
const AP_ABI = ['function getPriceOracle() view returns (address)'];
const ORACLE_ABI = ['function getAssetPrice(address asset) view returns (uint256)'];

const dpIface = new ethers.utils.Interface(DP_ABI);
const poolIface = new ethers.utils.Interface(POOL_ABI);
let at: { blockTag: number };

// --------------------------------------------------------------------------
// RPC shards. Each endpoint gets its own provider and its own in-flight budget,
// plus a cooldown that engages when that endpoint starts rate-limiting us.
// --------------------------------------------------------------------------
type Shard = {
  url: string;
  provider: any;
  mc: any;
  cooldownUntil: number;
  consecutiveFails: number;
  ok: number;
  failed: number;
  logSpan: number;
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
    logSpan: 100_000,
  };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Paid endpoints embed API keys. Never print one to stdout or checkpoints. */
function maskRpc(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? '/***' : '';
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return '***';
  }
}

function logProgress(message: string): void {
  console.log(`[snapshot ${new Date().toISOString()}] ${message}`);
}

function safeErrorSummary(error: any): string {
  const status = error?.status ?? error?.error?.status ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code;
  const parts = [status ? `status=${status}` : '', code ? `code=${code}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'request failed';
}

function safeErrorDetail(error: any): string {
  let message = String(error?.stack || error?.message || error);
  for (const shard of shards) message = message.split(shard.url).join(maskRpc(shard.url));
  return message;
}

function displayPath(file: string): string {
  return path.relative(REPO_ROOT, file) || '.';
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'calculating';
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function finalCsvName(point: SnapshotPoint): string {
  return FINAL_CSV_NAMES[point.name] || `positions-${point.name}.csv`;
}

function cleanupIntermediateOutputs(keepNames: string[]): void {
  const keep = new Set([...Object.values(FINAL_CSV_NAMES), SUMMARY_FILE_NAME, ...keepNames]);
  let removed = 0;
  for (const name of fs.readdirSync(OUT_DIR)) {
    const file = path.join(OUT_DIR, name);
    if (!fs.statSync(file).isFile() || keep.has(name)) continue;
    fs.unlinkSync(file);
    removed++;
  }
  logProgress(
    `Removed ${removed} intermediate output file(s). Final output directory contains the three CSVs and summary Markdown.`
  );
}

function parseArgs(argv: string[]) {
  const has = (flag: string) => argv.includes(flag);
  const valueAfter = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const revalue = valueAfter('--revalue');
  if (revalue)
    return {
      points: [] as SnapshotPoint[],
      revalue,
      healthFactorsOnly: undefined as true | string | undefined,
    };

  const healthFactorIndex = argv.indexOf('--health-factors-only');
  if (healthFactorIndex >= 0) {
    const possiblePath = argv[healthFactorIndex + 1];
    const csvPath = possiblePath && !possiblePath.startsWith('--') ? possiblePath : undefined;
    const consumed = new Set([healthFactorIndex, ...(csvPath ? [healthFactorIndex + 1] : [])]);
    const extras = argv.filter((_, index) => !consumed.has(index));
    if (extras.length)
      throw new Error(`--health-factors-only cannot be combined with: ${extras.join(' ')}`);
    return {
      points: [] as SnapshotPoint[],
      revalue: undefined as string | undefined,
      healthFactorsOnly: csvPath || (true as const),
    };
  }

  if (has('--after-pause-only')) {
    if (argv.length !== 1) {
      throw new Error('--after-pause-only cannot be combined with other arguments');
    }
    return {
      points: [PRESETS['after-pause']],
      revalue: undefined as string | undefined,
      healthFactorsOnly: undefined as true | string | undefined,
    };
  }

  const points = [PRESETS['pre-exploit']];
  if (has('--all') || has('--after-pause')) points.push(PRESETS['after-pause']);
  if (has('--all') || has('--post-rates')) points.push(PRESETS['post-rates']);
  const custom = valueAfter('--block');
  if (custom) {
    const block = Number(custom);
    if (!Number.isSafeInteger(block) || block <= 0) throw new Error(`Invalid --block: ${custom}`);
    points.push({ name: `block-${block}`, block });
  }
  if (has('--latest')) points.push({ name: 'latest', block: -1 });
  const allowed = new Set(['--all', '--after-pause', '--post-rates', '--latest', '--block']);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    if (!allowed.has(argv[i])) throw new Error(`Unknown argument: ${argv[i]}`);
    if (argv[i] === '--block') i++;
  }
  return {
    points,
    revalue: undefined as string | undefined,
    healthFactorsOnly: undefined as true | string | undefined,
  };
}

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function trimDecimal(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function decimalValue(raw: string, decimals: number): string {
  return trimDecimal(ethers.utils.formatUnits(raw, decimals));
}

function usdValue(raw: string, decimals: number, price: string): string {
  const cents = ethers.BigNumber.from(raw)
    .mul(ethers.utils.parseUnits(price, USD_PRICE_DECIMALS))
    .add(
      ethers.BigNumber.from(10)
        .pow(decimals + USD_PRICE_DECIMALS - 2)
        .div(2)
    )
    .div(ethers.BigNumber.from(10).pow(decimals + USD_PRICE_DECIMALS - 2));
  const digits = cents.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function hbarValue(raw: string, decimals: number, price: string): string {
  const numerator = ethers.BigNumber.from(raw)
    .mul(ethers.utils.parseUnits(price, USD_PRICE_DECIMALS))
    .mul(ethers.BigNumber.from(10).pow(8));
  const denominator = ethers.BigNumber.from(10)
    .pow(decimals)
    .mul(ethers.utils.parseUnits(FIXED_HBAR_USD, USD_PRICE_DECIMALS));
  const tinybar = numerator.add(denominator.div(2)).div(denominator);
  return trimDecimal(ethers.utils.formatUnits(tinybar, 8));
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function mirrorGet(url: string): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 429 || response.status >= 500)
        throw new Error(`Mirror ${response.status}`);
      if (!response.ok) throw new Error(`Mirror ${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      const backoff = Math.min(500 * 2 ** attempt, 10_000);
      logProgress(
        `Retrying Mirror Node request after ${safeErrorSummary(error)} ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES}, backoff ${Math.ceil(backoff / 1000)}s)`
      );
      await sleep(backoff);
    }
  }
  throw lastError;
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
      logProgress(
        `Retrying ${label} via ${maskRpc(shard.url)} after ${safeErrorSummary(e)} ` +
          `(attempt ${i + 1}/${MAX_RETRIES}, backoff up to ${Math.ceil(backoff / 1000)}s)`
      );
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
  stableDebtToken: string;
  variableDebtToken: string;
  decimals: number;
  ltv: number;
  liquidationThreshold: number;
  liquidityIndex: string;
  variableBorrowIndex: string;
  aTokenTotalSupply: string;
  availableLiquidity: string;
  totalStableDebt: string;
  totalVariableDebt: string;
  liquidityRate: string;
  stableBorrowRate: string;
  variableBorrowRate: string;
  assetPriceBaseRaw: string;
};

type Position = {
  evmAddress: string;
  accountId: string;
  assetSymbol: string;
  assetAddress: string;
  decimals: number;
  suppliedRaw: string;
  stableBorrowedRaw: string;
  variableBorrowedRaw: string;
  totalBorrowedRaw: string;
  scaledVariableBorrowedRaw: string;
  usedAsCollateral: boolean;
  suppliedValueUsd?: string;
  suppliedValueHbar?: string;
  borrowedValueUsd?: string;
  borrowedValueHbar?: string;
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

// --------------------------------------------------------------------------
function readAddresses(file = ADDRESSES_CSV): Array<{ evmAddress: string; accountId: string }> {
  const raw = fs.readFileSync(file, 'utf8').trim();
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
  logProgress(`Loading reserve metadata at block ${at.blockTag}.`);
  const poolC = new ethers.Contract(POOL_ADDR, POOL_ABI, s.provider);
  const dp = new ethers.Contract(DP_ADDR, DP_ABI, s.provider);
  const ap = new ethers.Contract(AP_ADDR, AP_ABI, s.provider);
  const oracleAddress = await callWithBackoff<string>(s, 'getPriceOracle', () =>
    ap.getPriceOracle(at)
  );
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, s.provider);

  const assets = await callWithBackoff<string[]>(s, 'getReservesList', () =>
    poolC.getReservesList(at)
  );
  const tokens = await callWithBackoff<any[]>(s, 'getAllReservesTokens', () =>
    dp.getAllReservesTokens(at)
  );
  const symbolOf = new Map<string, string>(
    tokens.map((t: any) => [t.tokenAddress.toLowerCase(), t.symbol])
  );
  logProgress(`Found ${assets.length} reserves at block ${at.blockTag}.`);

  const reserves: Reserve[] = [];
  for (const [index, asset] of assets.entries()) {
    const symbol = symbolOf.get(asset.toLowerCase()) || 'UNKNOWN';
    logProgress(`Loading reserve ${index + 1}/${assets.length}: ${symbol}.`);
    const addrs = await callWithBackoff<any>(s, `tokens ${asset}`, () =>
      dp.getReserveTokensAddresses(asset, at)
    );
    const cfg = await callWithBackoff<any>(s, `cfg ${asset}`, () =>
      dp.getReserveConfigurationData(asset, at)
    );
    const rd = await callWithBackoff<any>(s, `data ${asset}`, () => dp.getReserveData(asset, at));
    const assetPrice = await callWithBackoff<any>(s, `price ${asset}`, () =>
      oracle.getAssetPrice(asset, at)
    );
    if (!rd.totalStableDebt.isZero()) {
      throw new Error(`Stable debt invariant violated for reserve ${symbol}`);
    }
    const aToken = new ethers.Contract(addrs.aTokenAddress, ERC20_ABI, s.provider);
    const totalSupply = await callWithBackoff<any>(s, `supply ${asset}`, () =>
      aToken.totalSupply(at)
    );

    reserves.push({
      symbol,
      asset,
      aToken: addrs.aTokenAddress,
      stableDebtToken: addrs.stableDebtTokenAddress,
      variableDebtToken: addrs.variableDebtTokenAddress,
      decimals: Number(cfg.decimals),
      ltv: Number(cfg.ltv),
      liquidationThreshold: Number(cfg.liquidationThreshold),
      liquidityIndex: rd.liquidityIndex.toString(),
      variableBorrowIndex: rd.variableBorrowIndex.toString(),
      aTokenTotalSupply: totalSupply.toString(),
      availableLiquidity: rd.availableLiquidity.toString(),
      totalStableDebt: rd.totalStableDebt.toString(),
      totalVariableDebt: rd.totalVariableDebt.toString(),
      liquidityRate: rd.liquidityRate.toString(),
      stableBorrowRate: rd.stableBorrowRate.toString(),
      variableBorrowRate: rd.variableBorrowRate.toString(),
      assetPriceBaseRaw: assetPrice.toString(),
    });
  }
  logProgress(`Loaded all ${reserves.length} reserves at block ${at.blockTag}.`);
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
  const decode = (slice: Reserve[], returns: any[]): Position[] =>
    slice.map((r, i) => {
      const res = returns[i];
      if (!res.success) throw new Error(`sub-call reverted for ${r.symbol}`);
      const d = dpIface.decodeFunctionResult('getUserReserveData', res.returnData);
      if (!d.currentStableDebt.isZero()) {
        throw new Error(`Stable debt invariant violated for ${user.evmAddress}/${r.symbol}`);
      }
      return {
        evmAddress: user.evmAddress,
        accountId: user.accountId,
        assetSymbol: r.symbol.toUpperCase(),
        assetAddress: r.asset,
        decimals: r.decimals,
        suppliedRaw: d.currentATokenBalance.toString(),
        stableBorrowedRaw: d.currentStableDebt.toString(),
        variableBorrowedRaw: d.currentVariableDebt.toString(),
        totalBorrowedRaw: d.currentStableDebt.add(d.currentVariableDebt).toString(),
        scaledVariableBorrowedRaw: d.scaledVariableDebt.toString(),
        usedAsCollateral: d.usageAsCollateralEnabled,
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
      const returns = await callWithBackoff<any[]>(
        shard,
        `${user.evmAddress} x${slice.length}`,
        () => shard.mc.callStatic.aggregate3(calls, at)
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
  const accountData = await readAccountData(shard, user.evmAddress, at.blockTag);
  return {
    evmAddress: user.evmAddress,
    accountId: user.accountId,
    positions: out,
    accountData,
  };
}

async function readAccountData(
  shard: Shard,
  evmAddress: string,
  block: number
): Promise<AccountData> {
  const data = poolIface.encodeFunctionData('getUserAccountData', [evmAddress]);
  const result = await callWithBackoff<string>(shard, `health factor ${evmAddress}`, () =>
    shard.provider.call({ to: POOL_ADDR, data }, block)
  );
  const decoded = poolIface.decodeFunctionResult('getUserAccountData', result);
  return {
    totalCollateralBaseRaw: decoded.totalCollateralETH.toString(),
    totalDebtBaseRaw: decoded.totalDebtETH.toString(),
    availableBorrowsBaseRaw: decoded.availableBorrowsETH.toString(),
    currentLiquidationThresholdBps: Number(decoded.currentLiquidationThreshold),
    ltvBps: Number(decoded.ltv),
    healthFactorRaw: decoded.healthFactor.toString(),
  };
}

function healthFactorCell(accountData: AccountData): string {
  return accountData.totalDebtBaseRaw === '0'
    ? 'infinite'
    : decimalValue(accountData.healthFactorRaw, 18);
}

function deriveAccountData(positions: Position[], reserves: Reserve[]): AccountData {
  const byAsset = new Map(reserves.map((reserve) => [reserve.asset.toLowerCase(), reserve]));
  let collateral = ethers.BigNumber.from(0);
  let debt = ethers.BigNumber.from(0);
  let weightedThreshold = ethers.BigNumber.from(0);
  let weightedLtv = ethers.BigNumber.from(0);
  for (const position of positions) {
    const reserve = byAsset.get(position.assetAddress.toLowerCase());
    if (!reserve) continue;
    const unit = ethers.BigNumber.from(10).pow(position.decimals);
    const price = ethers.BigNumber.from(reserve.assetPriceBaseRaw);
    const supplyBase = ethers.BigNumber.from(position.suppliedRaw).mul(price).div(unit);
    const debtBase = ethers.BigNumber.from(position.totalBorrowedRaw).mul(price).div(unit);
    debt = debt.add(debtBase);
    if (position.usedAsCollateral && reserve.liquidationThreshold > 0) {
      collateral = collateral.add(supplyBase);
      weightedThreshold = weightedThreshold.add(supplyBase.mul(reserve.liquidationThreshold));
      weightedLtv = weightedLtv.add(supplyBase.mul(reserve.ltv));
    }
  }
  const threshold = collateral.isZero() ? 0 : Number(weightedThreshold.div(collateral));
  const ltv = collateral.isZero() ? 0 : Number(weightedLtv.div(collateral));
  const percentMul = (value: any, bps: number) => value.mul(bps).add(5000).div(10000);
  const capacity = percentMul(collateral, ltv);
  const available = capacity.gt(debt) ? capacity.sub(debt) : ethers.constants.Zero;
  const healthFactor = debt.isZero()
    ? ethers.constants.MaxUint256
    : percentMul(collateral, threshold)
        .mul(ethers.constants.WeiPerEther)
        .add(debt.div(2))
        .div(debt);
  return {
    totalCollateralBaseRaw: collateral.toString(),
    totalDebtBaseRaw: debt.toString(),
    availableBorrowsBaseRaw: available.toString(),
    currentLiquidationThresholdBps: threshold,
    ltvBps: ltv,
    healthFactorRaw: healthFactor.toString(),
  };
}

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function contractCreationBlock(address: string): Promise<number> {
  const info = await mirrorGet(`${MIRROR}/api/v1/contracts/${address}`);
  if (!info.created_timestamp) throw new Error(`Missing creation timestamp for ${address}`);
  const result = await mirrorGet(
    `${MIRROR}/api/v1/blocks?timestamp=lte:${info.created_timestamp}&order=desc&limit=1`
  );
  if (!result.blocks?.[0]?.number) throw new Error(`Missing creation block for ${address}`);
  return result.blocks[0].number;
}

async function scanTransferHolders(
  shard: Shard,
  address: string,
  fromBlock: number,
  toBlock: number,
  label: string
): Promise<string[]> {
  const holders = new Set<string>();
  let cursor = fromBlock;
  let failures = 0;
  let chunks = 0;
  let lastHeartbeat = 0;
  logProgress(
    `Scanning ${label} Transfer logs from block ${fromBlock} to ${toBlock} via ${maskRpc(
      shard.url
    )}.`
  );
  while (cursor <= toBlock) {
    const end = Math.min(cursor + shard.logSpan - 1, toBlock);
    try {
      const logs = await shard.provider.getLogs({
        address,
        topics: [TRANSFER_TOPIC],
        fromBlock: cursor,
        toBlock: end,
      });
      for (const log of logs) {
        for (const topic of [log.topics[1], log.topics[2]]) {
          if (!topic) continue;
          const holder = ethers.utils.getAddress(`0x${topic.slice(-40)}`);
          if (holder !== ZERO_ADDRESS) holders.add(holder);
        }
      }
      cursor = end + 1;
      failures = 0;
      chunks++;
      if (Date.now() - lastHeartbeat >= 15_000 || cursor > toBlock) {
        const scanned = Math.min(cursor, toBlock + 1) - fromBlock;
        const total = toBlock - fromBlock + 1;
        const percent = total > 0 ? ((scanned / total) * 100).toFixed(1) : '100.0';
        logProgress(
          `${label} holder scan: ${percent}% (${Math.min(cursor, toBlock)}/${toBlock}), ` +
            `${holders.size} holders, ${chunks} ranges, current range size ${shard.logSpan}.`
        );
        lastHeartbeat = Date.now();
      }
    } catch (error: any) {
      const message = String(error?.error?.message || error?.body || error?.message || error);
      if (/429|rate.?limit|too many/i.test(message)) {
        failures++;
        const backoff = Math.min(1000 * 2 ** failures, 20_000);
        logProgress(
          `${label} holder scan was rate-limited at block ${cursor}; retrying in ${formatDuration(
            backoff / 1000
          )}.`
        );
        await sleep(backoff);
      } else if (shard.logSpan > 1000) {
        const oldSpan = shard.logSpan;
        shard.logSpan = Math.max(1000, Math.floor(shard.logSpan / 2));
        logProgress(
          `${label} holder scan failed at block ${cursor}; reducing range from ${oldSpan} to ${shard.logSpan}.`
        );
      } else if (++failures > MAX_RETRIES) {
        throw new Error(
          `Transfer scan failed for ${address} at ${cursor}: ${message.slice(0, 120)}`
        );
      } else {
        await sleep(Math.min(1000 * 2 ** failures, 20_000));
      }
    }
  }
  return [...holders];
}

async function discoverAddressUniverse(
  reserves: Reserve[],
  highestBlock: number
): Promise<{
  users: Array<{ evmAddress: string; accountId: string }>;
  missing: string[];
  tokenHash: string;
}> {
  const targets = reserves.flatMap((reserve) => [
    { symbol: reserve.symbol, kind: 'aToken', address: reserve.aToken },
    { symbol: reserve.symbol, kind: 'stableDebt', address: reserve.stableDebtToken },
    { symbol: reserve.symbol, kind: 'variableDebt', address: reserve.variableDebtToken },
  ]);
  const uniqueTargets = [
    ...new Map(targets.map((target) => [target.address.toLowerCase(), target])).values(),
  ];
  const tokenHash = sha256(
    uniqueTargets
      .map((target) => target.address.toLowerCase())
      .sort()
      .join('\n')
  ).slice(0, 12);
  const checkpointPath = path.join(
    OUT_DIR,
    `holder-discovery-${highestBlock}-${tokenHash}.v${SCHEMA_VERSION}.json`
  );
  const checkpoint: Record<string, string[]> = fs.existsSync(checkpointPath)
    ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8'))
    : {};

  const pending = uniqueTargets.filter((target) => !checkpoint[target.address.toLowerCase()]);
  logProgress(
    `Holder discovery checkpoint: ${displayPath(checkpointPath)}. ${
      uniqueTargets.length - pending.length
    }/${uniqueTargets.length} token contracts cached; ${pending.length} remain.`
  );
  let completedTargets = uniqueTargets.length - pending.length;
  let startedTargets = completedTargets;
  await shardedPool(pending, async (target, shard) => {
    const label = `${target.symbol}/${target.kind}`;
    const ordinal = ++startedTargets;
    logProgress(`Starting holder contract ${ordinal}/${uniqueTargets.length}: ${label}.`);
    const created = await contractCreationBlock(target.address);
    const holders = await scanTransferHolders(shard, target.address, created, highestBlock, label);
    checkpoint[target.address.toLowerCase()] = holders;
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + '\n');
    completedTargets++;
    logProgress(
      `Completed holder contract ${completedTargets}/${uniqueTargets.length}: ${label}, ${holders.length} historical holders.`
    );
  });

  const seed = readAddresses();
  const supplied = new Map(seed.map((user) => [user.evmAddress.toLowerCase(), user]));
  const discovered = new Set<string>();
  for (const holders of Object.values(checkpoint))
    for (const holder of holders) discovered.add(holder);
  const missing = [...discovered].filter((holder) => !supplied.has(holder.toLowerCase())).sort();
  for (const holder of missing)
    supplied.set(holder.toLowerCase(), { evmAddress: holder, accountId: '' });
  const users = [...supplied.values()].sort((a, b) => a.evmAddress.localeCompare(b.evmAddress));

  logProgress(
    `Holder universe ready: ${discovered.size} discovered, ${seed.length} seed addresses, ` +
      `${missing.length} missing from seed, ${users.length} total users.`
  );
  return { users, missing, tokenHash };
}

function validateReserveConfiguration(reserves: Reserve[]) {
  const config = require('../outputReserveData.json');
  for (const reserve of reserves) {
    const symbol = reserve.symbol.toUpperCase();
    const expected = config[symbol]?.hedera_mainnet?.token?.address;
    if (!USD_PRICES[symbol]) throw new Error(`Missing fixed USD price for ${symbol}`);
    if (!expected) throw new Error(`Missing configured mainnet address for ${symbol}`);
    if (expected.toLowerCase() !== reserve.asset.toLowerCase()) {
      throw new Error(`${symbol} address mismatch: chain=${reserve.asset}, config=${expected}`);
    }
  }
}

function valuePosition(position: Position): Position {
  const price = USD_PRICES[position.assetSymbol];
  if (!price) throw new Error(`Missing fixed USD price for ${position.assetSymbol}`);
  return {
    ...position,
    suppliedValueUsd: usdValue(position.suppliedRaw, position.decimals, price),
    suppliedValueHbar: hbarValue(position.suppliedRaw, position.decimals, price),
    borrowedValueUsd: usdValue(position.totalBorrowedRaw, position.decimals, price),
    borrowedValueHbar: hbarValue(position.totalBorrowedRaw, position.decimals, price),
  };
}

function positionCsv(
  positions: Position[],
  assetSymbols?: string[],
  healthFactors: Map<string, string> = new Map()
): string {
  const symbols =
    assetSymbols || [...new Set(positions.map((position) => position.assetSymbol))].sort();
  const columns = [
    'evmAddress',
    'hederaAccountId',
    'healthFactor',
    'positionAssets',
    'totalSuppliedValueHbar',
    'totalSuppliedValueUsd',
    'totalBorrowedValueHbar',
    'totalBorrowedValueUsd',
    ...symbols.flatMap((symbol) => [
      `${symbol}_suppliedAmount`,
      `${symbol}_suppliedValueHbar`,
      `${symbol}_suppliedValueUsd`,
      `${symbol}_borrowedAmount`,
      `${symbol}_borrowedValueHbar`,
      `${symbol}_borrowedValueUsd`,
      `${symbol}_usedAsCollateral`,
    ]),
  ];
  const byUser = new Map<string, Position[]>();
  for (const rawPosition of positions) {
    const position = valuePosition(rawPosition);
    const key = position.evmAddress.toLowerCase();
    const list = byUser.get(key) || [];
    list.push(position);
    byUser.set(key, list);
  }
  const addDecimal = (left: string, right: string, decimals: number) =>
    trimDecimal(
      ethers.utils.formatUnits(
        ethers.utils
          .parseUnits(left || '0', decimals)
          .add(ethers.utils.parseUnits(right || '0', decimals)),
        decimals
      )
    );
  const fixedTwo = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0').slice(0, 2)}`;
  };
  const rows = [...byUser.values()].map((userPositions) => {
    const first = userPositions[0];
    const bySymbol = new Map(userPositions.map((position) => [position.assetSymbol, position]));
    let suppliedHbar = '0';
    let suppliedUsd = '0';
    let borrowedHbar = '0';
    let borrowedUsd = '0';
    for (const position of userPositions) {
      suppliedHbar = addDecimal(suppliedHbar, position.suppliedValueHbar!, 8);
      suppliedUsd = addDecimal(suppliedUsd, position.suppliedValueUsd!, 2);
      borrowedHbar = addDecimal(borrowedHbar, position.borrowedValueHbar!, 8);
      borrowedUsd = addDecimal(borrowedUsd, position.borrowedValueUsd!, 2);
    }
    const assets = userPositions
      .map((position) => position.assetSymbol)
      .sort()
      .join(';');
    return [
      first.evmAddress,
      first.accountId,
      healthFactors.get(first.evmAddress.toLowerCase()) || '',
      assets,
      suppliedHbar,
      fixedTwo(suppliedUsd),
      borrowedHbar,
      fixedTwo(borrowedUsd),
      ...symbols.flatMap((symbol) => {
        const position = bySymbol.get(symbol);
        if (!position) return ['0', '0', '0.00', '0', '0', '0.00', false];
        return [
          decimalValue(position.suppliedRaw, position.decimals),
          position.suppliedValueHbar!,
          position.suppliedValueUsd!,
          decimalValue(position.totalBorrowedRaw, position.decimals),
          position.borrowedValueHbar!,
          position.borrowedValueUsd!,
          position.usedAsCollateral,
        ];
      }),
    ]
      .map(csvCell)
      .join(',');
  });
  return columns.join(',') + '\n' + rows.join('\n') + '\n';
}

function serializeCsv(headers: string[], rows: Record<string, string>[]): string {
  return (
    headers.map(csvCell).join(',') +
    '\n' +
    rows.map((row) => headers.map((header) => csvCell(row[header] ?? '')).join(',')).join('\n') +
    '\n'
  );
}

function csvWithHealthFactors(
  csv: { headers: string[]; rows: Record<string, string>[] },
  healthFactors: Map<string, string>
): string {
  if (healthFactors.size !== csv.rows.length) {
    throw new Error(`Health-factor coverage incomplete: ${healthFactors.size}/${csv.rows.length}`);
  }
  const headers = csv.headers.filter((header) => header !== 'healthFactor');
  const insertion = Math.max(0, headers.indexOf('hederaAccountId') + 1);
  headers.splice(insertion, 0, 'healthFactor');
  const rows = csv.rows.map((row) => {
    const healthFactor = healthFactors.get(row.evmAddress.toLowerCase());
    if (healthFactor === undefined) throw new Error(`Missing health factor for ${row.evmAddress}`);
    return { ...row, healthFactor };
  });
  return serializeCsv(headers, rows);
}

async function addHealthFactorsToCsv(csvPath: string, block: number): Promise<void> {
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) throw new Error(`Snapshot CSV does not exist: ${resolved}`);
  const csv = parseCsv(fs.readFileSync(resolved, 'utf8'));
  if (!csv.headers.includes('evmAddress')) throw new Error(`${resolved} has no evmAddress column`);
  const healthFactors = new Map<string, string>();
  const startedAt = Date.now();
  let completed = 0;
  const report = () => {
    const elapsed = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const rate = completed / elapsed;
    const remaining = csv.rows.length - completed;
    logProgress(
      `Health factors for ${path.basename(resolved)}: ${completed}/${csv.rows.length}, ` +
        `${rate.toFixed(2)} users/s, ETA ${
          rate > 0 ? formatDuration(remaining / rate) : 'calculating'
        }.`
    );
  };
  report();
  const heartbeat = setInterval(report, 15_000);
  try {
    await shardedPool(csv.rows, async (row, shard) => {
      if (!ethers.utils.isAddress(row.evmAddress)) {
        throw new Error(`Invalid EVM address in ${path.basename(resolved)}: ${row.evmAddress}`);
      }
      const accountData = await readAccountData(shard, row.evmAddress, block);
      healthFactors.set(row.evmAddress.toLowerCase(), healthFactorCell(accountData));
      completed++;
      if (completed % 100 === 0 || completed === csv.rows.length) report();
    });
  } finally {
    clearInterval(heartbeat);
  }
  if (healthFactors.size !== csv.rows.length) {
    throw new Error(
      `Health-factor coverage incomplete for ${path.basename(resolved)}: ${healthFactors.size}/${
        csv.rows.length
      }`
    );
  }
  const temporary = `${resolved}.health-factor.tmp`;
  try {
    fs.writeFileSync(temporary, csvWithHealthFactors(csv, healthFactors));
    fs.renameSync(temporary, resolved);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  logProgress(
    `Updated only healthFactor in ${displayPath(resolved)} for ${
      csv.rows.length
    } users at block ${block}.`
  );
}

async function addHealthFactorsOnly(input: true | string): Promise<void> {
  const targets =
    typeof input === 'string'
      ? [
          (() => {
            const csvPath = path.resolve(input);
            const definition = DEFINITIONS.find(
              (candidate) => candidate.fileName === path.basename(csvPath)
            );
            if (!definition) {
              throw new Error(
                `Cannot infer a pinned block from ${path.basename(
                  csvPath
                )}. Use one of the three definitive snapshot filenames.`
              );
            }
            return { csvPath, block: definition.block };
          })(),
        ]
      : DEFINITIONS.map((definition) => ({
          csvPath: path.join(OUT_DIR, definition.fileName),
          block: definition.block,
        }));
  logProgress(
    `Health-factor-only mode selected for ${targets.length} CSV file(s). No position or valuation fields will be recomputed.`
  );
  for (const target of targets) await addHealthFactorsToCsv(target.csvPath, target.block);
  logProgress('Health-factor-only enrichment completed.');
}

function usersCsv(users: UserSnapshot[]): string {
  const columns = [
    'evmAddress',
    'hederaAccountId',
    'totalCollateralBase',
    'totalDebtBase',
    'availableBorrowsBase',
    'currentLiquidationThresholdBps',
    'ltvBps',
    'healthFactor',
  ];
  const rows = users.map((user) => {
    const data = user.accountData;
    return [
      user.evmAddress,
      user.accountId,
      decimalValue(data.totalCollateralBaseRaw, 18),
      decimalValue(data.totalDebtBaseRaw, 18),
      decimalValue(data.availableBorrowsBaseRaw, 18),
      data.currentLiquidationThresholdBps,
      data.ltvBps,
      data.totalDebtBaseRaw === '0' ? '' : decimalValue(data.healthFactorRaw, 18),
    ]
      .map(csvCell)
      .join(',');
  });
  return columns.join(',') + '\n' + rows.join('\n') + '\n';
}

function pricesCsv(assetSymbols: string[]): string {
  const rows = assetSymbols.map((symbol) =>
    [symbol, USD_PRICES[symbol], hbarValue('1', 0, USD_PRICES[symbol]), FIXED_HBAR_USD]
      .map(csvCell)
      .join(',')
  );
  return 'assetSymbol,assetUsdPrice,assetHbarPrice,hbarUsdPrice\n' + rows.join('\n') + '\n';
}

async function validatePoint(point: SnapshotPoint): Promise<any> {
  logProgress(`Validating snapshot point ${point.name} at block ${point.block}.`);
  const block = await callWithBackoff<any>(shards[0], `block ${point.block}`, () =>
    shards[0].provider.getBlock(point.block)
  );
  if (!block) throw new Error(`Block ${point.block} was not returned by the RPC`);
  if (point.expectedTimestamp !== undefined && block.timestamp !== point.expectedTimestamp) {
    throw new Error(
      `${point.name} timestamp mismatch: ${block.timestamp} != ${point.expectedTimestamp}`
    );
  }
  logProgress(
    `Confirmed ${point.name} block timestamp ${new Date(block.timestamp * 1000).toISOString()}.`
  );
  if (point.boundaryTxHash) {
    logProgress(`Checking ${point.name} boundary transaction receipt.`);
    const receipt = await callWithBackoff<any>(shards[0], `receipt ${point.boundaryTxHash}`, () =>
      shards[0].provider.getTransactionReceipt(point.boundaryTxHash!)
    );
    if (!receipt || receipt.status !== 1 || receipt.blockNumber !== point.block) {
      throw new Error(
        `${point.name} boundary transaction was not successful in block ${point.block}`
      );
    }
    logProgress(`Confirmed ${point.name} boundary transaction in block ${point.block}.`);
  }
  return block;
}

async function generateSnapshot(
  point: SnapshotPoint,
  block: any,
  reserves: Reserve[],
  users: Array<{ evmAddress: string; accountId: string }>,
  tokenHash: string
): Promise<any> {
  at = { blockTag: point.block };
  const shardStatsStart = new Map(
    shards.map((shard) => [shard, { ok: shard.ok, failed: shard.failed }])
  );
  logProgress(`Starting ${point.name} snapshot at block ${point.block}.`);
  validateReserveConfiguration(reserves);
  logProgress(`Checking Multicall3 availability at block ${point.block}.`);
  const code = await callWithBackoff(shards[0], 'Multicall3 code', () =>
    shards[0].provider.getCode(MULTICALL3, point.block)
  );
  if (code === '0x') throw new Error(`Multicall3 has no code at block ${point.block}`);

  const addressHash = sha256(
    users.map((user) => `${user.evmAddress.toLowerCase()},${user.accountId}`).join('\n')
  ).slice(0, 12);
  const checkpointPath = path.join(
    OUT_DIR,
    `snapshot-${point.block}-${addressHash}-${tokenHash}.v${SCHEMA_VERSION}.checkpoint.jsonl`
  );
  const done = new Map<string, UserSnapshot>();
  if (fs.existsSync(checkpointPath)) {
    for (const line of fs.readFileSync(checkpointPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.evmAddress && Array.isArray(record.positions))
          done.set(record.evmAddress.toLowerCase(), record);
      } catch {
        /* tolerate a torn final checkpoint line */
      }
    }
  }
  const todo = users.filter((user) => !done.has(user.evmAddress.toLowerCase()));
  logProgress(
    `${point.name} checkpoint: ${displayPath(checkpointPath)}. ${done.size}/${users.length} ` +
      `users cached; ${todo.length} remain.`
  );
  const checkpoint = fs.createWriteStream(checkpointPath, { flags: 'a' });
  const failures: Array<{ evmAddress: string; error: string }> = [];
  let completed = 0;
  const snapshotStartedAt = Date.now();
  const reportUserProgress = () => {
    const elapsedSeconds = Math.max((Date.now() - snapshotStartedAt) / 1000, 0.001);
    const rate = completed / elapsedSeconds;
    const remaining = todo.length - completed;
    const eta = rate > 0 ? formatDuration(remaining / rate) : 'calculating';
    logProgress(
      `${point.name} users: ${done.size}/${users.length} complete ` +
        `(${completed}/${todo.length} this run), ${failures.length} failed, ` +
        `${rate.toFixed(2)} users/s, ETA ${eta}.`
    );
  };
  if (todo.length) reportUserProgress();
  const heartbeat = todo.length ? setInterval(reportUserProgress, 15_000) : undefined;
  try {
    await shardedPool(todo, async (user, shard) => {
      try {
        const snapshot = await readUser(shard, user, reserves);
        done.set(user.evmAddress.toLowerCase(), snapshot);
        checkpoint.write(JSON.stringify(snapshot) + '\n');
      } catch (error: any) {
        shard.failed++;
        failures.push({
          evmAddress: user.evmAddress,
          error: safeErrorDetail(error).slice(0, 160),
        });
      }
      completed++;
      if (completed % 50 === 0 || completed === todo.length) reportUserProgress();
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    checkpoint.end();
    await new Promise<void>((resolve, reject) => {
      checkpoint.on('close', resolve);
      checkpoint.on('error', reject);
    });
  }
  logProgress(
    `${point.name} user reads finished in ${formatDuration(
      (Date.now() - snapshotStartedAt) / 1000
    )}.`
  );
  for (const shard of shards) {
    const start = shardStatsStart.get(shard)!;
    logProgress(
      `${point.name} RPC stats for ${maskRpc(shard.url)}: ${
        shard.ok - start.ok
      } successful calls, ` + `${shard.failed - start.failed} failed user reads.`
    );
  }

  const successfulUsers = users
    .map((user) => done.get(user.evmAddress.toLowerCase()))
    .filter(Boolean) as UserSnapshot[];
  const allPositions = successfulUsers.flatMap((user) => user.positions);
  const positions = allPositions
    .filter((position) => position.suppliedRaw !== '0' || position.totalBorrowedRaw !== '0')
    .map(valuePosition);
  const positionedUsers = successfulUsers.filter((user) =>
    user.positions.some(
      (position) => position.suppliedRaw !== '0' || position.totalBorrowedRaw !== '0'
    )
  );
  const coverage = reserves.map((reserve) => {
    const supplied = allPositions
      .filter((position) => position.assetAddress.toLowerCase() === reserve.asset.toLowerCase())
      .reduce((sum, position) => sum.add(position.suppliedRaw), ethers.constants.Zero);
    const total = ethers.BigNumber.from(reserve.aTokenTotalSupply);
    const coveragePct = total.isZero()
      ? 100
      : Number(supplied.mul(1_000_000).div(total).toString()) / 10_000;
    const shortfall = total.gt(supplied) ? total.sub(supplied) : ethers.constants.Zero;
    return {
      assetSymbol: reserve.symbol.toUpperCase(),
      suppliedSum: decimalValue(supplied.toString(), reserve.decimals),
      aTokenTotalSupply: decimalValue(total.toString(), reserve.decimals),
      coveragePct,
      shortfall: decimalValue(shortfall.toString(), reserve.decimals),
    };
  });
  const borrowers = positionedUsers.filter((user) => user.accountData.totalDebtBaseRaw !== '0');
  const hf = (user: UserSnapshot) => Number(decimalValue(user.accountData.healthFactorRaw, 18));
  const summary = {
    usersQueried: users.length,
    usersSucceeded: successfulUsers.length,
    usersMissing: users.length - successfulUsers.length,
    usersFailed: failures.length,
    usersWithPosition: positionedUsers.length,
    nonZeroPositions: positions.length,
    healthFactors: {
      borrowers: borrowers.length,
      atOrBelow1: borrowers.filter((user) => hf(user) <= 1).length,
      above1To1_10: borrowers.filter((user) => hf(user) > 1 && hf(user) <= 1.1).length,
      above1_10To1_25: borrowers.filter((user) => hf(user) > 1.1 && hf(user) <= 1.25).length,
      above1_25: borrowers.filter((user) => hf(user) > 1.25).length,
    },
    complete: successfulUsers.length === users.length && failures.length === 0,
  };
  const snapshot = {
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      preset: point.name,
      network: 'hedera_mainnet',
      block: point.block,
      blockTimestamp: block.timestamp,
      blockTimestampISO: new Date(block.timestamp * 1000).toISOString(),
      boundaryTxHash: point.boundaryTxHash || null,
      lendingPool: POOL_ADDR,
      dataProvider: DP_ADDR,
      multicall3: MULTICALL3,
      seedAddressesFile: path.relative(REPO_ROOT, ADDRESSES_CSV),
      addressCount: users.length,
      addressUniverseHash: addressHash,
      tokenContractHash: tokenHash,
      generatedAt: new Date().toISOString(),
      valuation: {
        source: 'Fixed USD prices used consistently across incident snapshots',
        pricesUsd: USD_PRICES,
        hbarUsd: FIXED_HBAR_USD,
      },
      note: 'USD values in CSV are fixed-price comparisons, not protocol-oracle valuations.',
    },
    reserves,
    coverage,
    summary,
    positions,
    users: positionedUsers.map((user) => ({
      evmAddress: user.evmAddress,
      accountId: user.accountId,
      ...user.accountData,
    })),
    failures,
  };
  logProgress(
    `${point.name} coverage: ${summary.usersSucceeded}/${summary.usersQueried} users succeeded, ` +
      `${summary.usersWithPosition} users with positions, ${summary.nonZeroPositions} non-zero positions.`
  );
  for (const item of coverage) {
    logProgress(
      `${point.name} ${item.assetSymbol} aToken coverage: ${item.coveragePct.toFixed(4)}%.`
    );
  }
  if (!summary.complete)
    throw new Error(`${point.name} is incomplete: ${summary.usersMissing} users missing`);
  const gaps = coverage.filter((item) => item.coveragePct < 99);
  if (gaps.length)
    throw new Error(
      `${point.name} has material holder coverage gaps: ${gaps
        .map((item) => item.assetSymbol)
        .join(', ')}`
    );
  const csvPath = path.join(OUT_DIR, finalCsvName(point));
  const healthFactors = new Map(
    positionedUsers.map((user) => [
      user.evmAddress.toLowerCase(),
      healthFactorCell(user.accountData),
    ])
  );
  logProgress(`Writing ${displayPath(csvPath)} with ${positionedUsers.length} user rows.`);
  fs.writeFileSync(
    csvPath,
    positionCsv(
      positions,
      reserves.map((reserve) => reserve.symbol.toUpperCase()),
      healthFactors
    )
  );
  logProgress(`${point.name} snapshot completed successfully.`);
  return snapshot;
}

function normalizeLegacyPosition(position: any): Position {
  const stable =
    position.stableBorrowedRaw ?? position.stableBorrowRaw ?? position.stableDebt ?? '0';
  const variable =
    position.variableBorrowedRaw ??
    position.variableBorrowRaw ??
    position.variableDebt ??
    position.borrowRaw ??
    '0';
  return {
    evmAddress: position.evmAddress ?? position.user,
    accountId: position.accountId || '',
    assetSymbol: (position.assetSymbol ?? position.token ?? position.symbol).toUpperCase(),
    assetAddress: position.assetAddress ?? position.tokenAddress ?? position.asset,
    decimals: Number(position.decimals),
    suppliedRaw: position.suppliedRaw ?? position.supplyRaw ?? position.aTokenBalance,
    stableBorrowedRaw: stable,
    variableBorrowedRaw: variable,
    totalBorrowedRaw:
      position.totalBorrowedRaw ??
      position.borrowRaw ??
      ethers.BigNumber.from(stable).add(variable).toString(),
    scaledVariableBorrowedRaw:
      position.scaledVariableBorrowedRaw ?? position.scaledVariableDebt ?? '0',
    usedAsCollateral: position.usedAsCollateral ?? position.usageAsCollateral ?? false,
  };
}

function revalueSnapshot(input: string) {
  const jsonPath = path.resolve(input);
  logProgress(`Revaluing existing snapshot ${displayPath(jsonPath)}.`);
  const snapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const positions = snapshot.positions.map(normalizeLegacyPosition).map(valuePosition);
  snapshot.positions = positions;
  snapshot.metadata.valuation = {
    source: 'Fixed USD prices used consistently across incident snapshots',
    pricesUsd: USD_PRICES,
    hbarUsd: FIXED_HBAR_USD,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');
  fs.writeFileSync(jsonPath.replace(/\.json$/, '.csv'), positionCsv(positions));
  if (Array.isArray(snapshot.users)) {
    const users: UserSnapshot[] = snapshot.users.map((user: any) => ({
      evmAddress: user.evmAddress,
      accountId: user.accountId || '',
      positions: [],
      accountData: user.accountData || {
        totalCollateralBaseRaw: user.totalCollateralBaseRaw,
        totalDebtBaseRaw: user.totalDebtBaseRaw,
        availableBorrowsBaseRaw: user.availableBorrowsBaseRaw,
        currentLiquidationThresholdBps: user.currentLiquidationThresholdBps,
        ltvBps: user.ltvBps,
        healthFactorRaw: user.healthFactorRaw,
      },
    }));
    fs.writeFileSync(jsonPath.replace(/\.json$/, '-users.csv'), usersCsv(users));
  }
  logProgress(`Revalued ${displayPath(jsonPath)} and regenerated its CSV exports.`);
}

function comparisonMarkdown(snapshots: any[]): string {
  const totalValue = (
    snapshot: any,
    field: 'suppliedRaw' | 'totalBorrowedRaw',
    denomination: 'usd' | 'hbar'
  ) =>
    snapshot.positions.reduce((sum: number, position: Position) => {
      const value =
        denomination === 'usd'
          ? usdValue(position[field], position.decimals, USD_PRICES[position.assetSymbol])
          : hbarValue(position[field], position.decimals, USD_PRICES[position.assetSymbol]);
      return sum + Number(value);
    }, 0);
  const rows = snapshots.map(
    (snapshot) =>
      `| ${snapshot.metadata.preset} | ${snapshot.metadata.block} | ${
        snapshot.metadata.blockTimestampISO
      } | ${snapshot.summary.usersWithPosition} | ${snapshot.summary.healthFactors.borrowers} | ${
        snapshot.summary.healthFactors.atOrBelow1
      } | ${totalValue(snapshot, 'suppliedRaw', 'hbar').toFixed(8)} | ${totalValue(
        snapshot,
        'suppliedRaw',
        'usd'
      ).toFixed(2)} | ${totalValue(snapshot, 'totalBorrowedRaw', 'hbar').toFixed(8)} | ${totalValue(
        snapshot,
        'totalBorrowedRaw',
        'usd'
      ).toFixed(2)} |`
  );
  const reserveSymbols = [
    ...new Set(
      snapshots.flatMap((snapshot) =>
        snapshot.reserves.map((reserve: Reserve) => reserve.symbol.toUpperCase())
      )
    ),
  ].sort();
  const reserveRows = reserveSymbols.map((symbol) => {
    const cells = snapshots
      .map((snapshot) => {
        const reserve = snapshot.reserves.find(
          (item: Reserve) => item.symbol.toUpperCase() === symbol
        );
        if (!reserve) return '| n/a | n/a ';
        return `| ${decimalValue(reserve.aTokenTotalSupply, reserve.decimals)} | ${decimalValue(
          ethers.BigNumber.from(reserve.totalStableDebt).add(reserve.totalVariableDebt).toString(),
          reserve.decimals
        )} `;
      })
      .join('');
    return `| ${symbol} ${cells}|`;
  });
  const headers = snapshots
    .map((snapshot) => `| ${snapshot.metadata.preset} supply | ${snapshot.metadata.preset} debt `)
    .join('');
  const align = snapshots.map(() => '|---:|---:').join('');
  return `# Bonzo position snapshot comparison\n\nGenerated: ${new Date().toISOString()}\n\nUSD and HBAR values use the same fixed investigation prices at every snapshot, with HBAR fixed at $${FIXED_HBAR_USD}. They are comparison values, not contemporaneous market or protocol-oracle valuations.\n\n| Snapshot | Block | Timestamp | Users with positions | Borrowers | HF <= 1 | Supplied HBAR | Supplied USD | Borrowed HBAR | Borrowed USD |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join(
    '\n'
  )}\n\n## Reserve totals\n\n| Asset ${headers}|\n|---${align}|\n${reserveRows.join('\n')}\n`;
}

function generateComparison(snapshots: any[]): string {
  const last = snapshots[snapshots.length - 1];
  const report = comparisonMarkdown(snapshots);
  const output = path.join(OUT_DIR, `position-snapshot-comparison-${last.metadata.block}.md`);
  fs.writeFileSync(output, report);
  logProgress(`Wrote comparison report ${displayPath(output)}.`);
  return output;
}

async function main() {
  const runStartedAt = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const args = parseArgs(process.argv.slice(2));
  if (args.revalue) return revalueSnapshot(args.revalue);
  if (args.healthFactorsOnly) {
    logProgress(
      `Using ${shards.length} RPC endpoint(s) with ${CONCURRENCY_PER_RPC} workers per endpoint for health-factor reads.`
    );
    for (const shard of shards) logProgress(`RPC endpoint: ${maskRpc(shard.url)}.`);
    return addHealthFactorsOnly(args.healthFactorsOnly);
  }
  const rpcSource = process.env.RPC_URLS
    ? 'RPC_URLS'
    : process.env.PROVIDER_URL_MAINNET
    ? 'PROVIDER_URL_MAINNET'
    : 'public Hashio fallback';
  logProgress(
    `Starting snapshot run with ${shards.length} RPC endpoint(s) from ${rpcSource}, ` +
      `${CONCURRENCY_PER_RPC} workers per endpoint, batch size ${MAX_BATCH}, ${MAX_RETRIES} retries.`
  );
  for (const shard of shards) logProgress(`RPC endpoint: ${maskRpc(shard.url)}.`);
  const latest = args.points.find((point) => point.block === -1);
  if (latest) {
    logProgress('Resolving the latest mainnet block.');
    latest.block = await callWithBackoff<number>(shards[0], 'latest block number', () =>
      shards[0].provider.getBlockNumber()
    );
    logProgress(`Resolved latest mainnet block to ${latest.block}.`);
  }
  const points = [...new Map(args.points.map((point) => [point.block, point])).values()].sort(
    (a, b) => a.block - b.block
  );
  logProgress(
    `Selected snapshots: ${points.map((point) => `${point.name}@${point.block}`).join(', ')}.`
  );
  const blocks = new Map<number, any>();
  const reservesByBlock = new Map<number, Reserve[]>();
  logProgress('[phase 1/4] Validating blocks and loading reserve state.');
  for (const point of points) {
    const block = await validatePoint(point);
    blocks.set(point.block, block);
    at = { blockTag: point.block };
    const reserves = await loadReserves();
    validateReserveConfiguration(reserves);
    reservesByBlock.set(point.block, reserves);
  }
  const highestBlock = points[points.length - 1].block;
  const unionReserves = [
    ...new Map(
      [...reservesByBlock.values()]
        .flat()
        .map((reserve) => [
          `${reserve.asset.toLowerCase()}:${reserve.aToken.toLowerCase()}`,
          reserve,
        ])
    ).values(),
  ];
  logProgress('[phase 2/4] Discovering the complete historical holder universe.');
  const discovery = await discoverAddressUniverse(unionReserves, highestBlock);
  logProgress('[phase 3/4] Reading and validating user positions.');
  for (const point of points) {
    await generateSnapshot(
      point,
      blocks.get(point.block),
      reservesByBlock.get(point.block)!,
      discovery.users,
      discovery.tokenHash
    );
  }
  logProgress('[phase 4/4] Generating the summary and removing intermediate outputs.');
  const definitiveCsvsExist = Object.values(FINAL_CSV_NAMES).every((name) =>
    fs.existsSync(path.join(OUT_DIR, name))
  );
  if (definitiveCsvsExist) {
    const summaryPath = generatePositionSnapshotSummary(OUT_DIR);
    logProgress(`Wrote detailed summary ${displayPath(summaryPath)}.`);
  } else {
    logProgress('Not all three definitive CSVs exist yet, so the summary was not regenerated.');
  }
  cleanupIntermediateOutputs(points.map(finalCsvName));
  logProgress(
    `Completed ${points.length} definitive snapshot(s) in ${formatDuration(
      (Date.now() - runStartedAt) / 1000
    )}.`
  );
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[snapshot ${new Date().toISOString()}] Fatal: ${safeErrorDetail(error)}`);
      process.exit(1);
    });
}

export {
  addHealthFactorsToCsv,
  csvWithHealthFactors,
  healthFactorCell,
  parseArgs,
  decimalValue,
  finalCsvName,
  usdValue,
  hbarValue,
  normalizeLegacyPosition,
  positionCsv,
  serializeCsv,
  usersCsv,
  pricesCsv,
  comparisonMarkdown,
  generateComparison,
};
