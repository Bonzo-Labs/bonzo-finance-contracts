import path from 'path';
import BigNumber from 'bignumber.js';
import { utils } from 'ethers';
import {
  WHBAR,
  USDC,
  WETH,
  BONZO,
  HBARX,
  SAUCE,
  GRELF,
  XSAUCE,
  KARATE,
  KBL,
  DOVU,
  HST,
  PACK,
  STEAM,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';

export const RATE_SYMBOLS = [
  'WHBAR',
  'USDC',
  'WETH',
  'BONZO',
  'HBARX',
  'SAUCE',
  'XSAUCE',
  'KARATE',
  'GRELF',
  'DOVU',
  'HST',
  'PACK',
  'STEAM',
  'KBL',
] as const;
export const EXPECTED_RESERVE_COUNT = 14;
export type RateSymbol = (typeof RATE_SYMBOLS)[number];

export const TARGET_BASE_VARIABLE_RATE_DECIMAL = '0';
export const TARGET_VARIABLE_RATE_SLOPE_DECIMAL = '0.00005'; // 0.005%

const RAY = new BigNumber(10).pow(27);
const toRay = (decimal: string) => new BigNumber(decimal).multipliedBy(RAY).toFixed(0);

export const TARGET_BASE_VARIABLE_RATE_RAY = toRay(TARGET_BASE_VARIABLE_RATE_DECIMAL);
export const TARGET_VARIABLE_RATE_SLOPE_RAY = toRay(TARGET_VARIABLE_RATE_SLOPE_DECIMAL);
export const TARGET_MAX_VARIABLE_RATE_RAY = new BigNumber(TARGET_BASE_VARIABLE_RATE_RAY)
  .plus(TARGET_VARIABLE_RATE_SLOPE_RAY)
  .plus(TARGET_VARIABLE_RATE_SLOPE_RAY)
  .toFixed(0);

export const MAINNET_CHAIN_ID = 295;
export const MAINNET_CHAIN_NAME = 'hedera_mainnet';

export const PROTOCOL_ADDRESSES = {
  provider: LendingPoolAddressesProvider.hedera_mainnet.address,
  pool: LendingPool.hedera_mainnet.address,
  configurator: LendingPoolConfigurator.hedera_mainnet.address,
  dataProvider: AaveProtocolDataProvider.hedera_mainnet.address,
} as const;

export const ASSET_BY_SYMBOL: Record<RateSymbol, string> = {
  WHBAR: WHBAR.hedera_mainnet.token.address,
  USDC: USDC.hedera_mainnet.token.address,
  WETH: WETH.hedera_mainnet.token.address,
  BONZO: BONZO.hedera_mainnet.token.address,
  HBARX: HBARX.hedera_mainnet.token.address,
  SAUCE: SAUCE.hedera_mainnet.token.address,
  XSAUCE: XSAUCE.hedera_mainnet.token.address,
  KARATE: KARATE.hedera_mainnet.token.address,
  GRELF: GRELF.hedera_mainnet.token.address,
  DOVU: DOVU.hedera_mainnet.token.address,
  HST: HST.hedera_mainnet.token.address,
  PACK: PACK.hedera_mainnet.token.address,
  STEAM: STEAM.hedera_mainnet.token.address,
  KBL: KBL.hedera_mainnet.token.address,
};

export const TARGET_ASSETS = RATE_SYMBOLS.map((symbol) => ({
  symbol,
  address: ASSET_BY_SYMBOL[symbol],
}));

export type StrategyMap = Record<RateSymbol, string>;

export const RATE_STATE_PATH = path.join(__dirname, 'rate-update-state.json');
export const EXECUTOR_STATE_PATH = path.join(__dirname, 'atomic-rate-poke-state.json');
export const FREEZE_STATE_PATH = path.join(__dirname, 'freeze-state.json');

export function assertMainnet(chain: string) {
  if (chain !== MAINNET_CHAIN_NAME) {
    throw new Error(`Mainnet only. Set CHAIN_TYPE=${MAINNET_CHAIN_NAME} (got ${chain}).`);
  }
}

export function assertConfiguredReserveSet(liveReserves: string[]) {
  if (RATE_SYMBOLS.length !== EXPECTED_RESERVE_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_RESERVE_COUNT} configured reserves, got ${RATE_SYMBOLS.length}`
    );
  }

  const configured = new Set(TARGET_ASSETS.map(({ address }) => address.toLowerCase()));
  const live = new Set(liveReserves.map((address) => address.toLowerCase()));
  const missing = [...live].filter((address) => !configured.has(address));
  const extra = [...configured].filter((address) => !live.has(address));
  if (missing.length || extra.length) {
    throw new Error(
      `Configured reserve set differs from LendingPool: missing=${missing.join(',') || 'none'} ` +
        `extra=${extra.join(',') || 'none'}`
    );
  }
}

export function assertTargetVariableCurve(
  symbol: string,
  values: {
    baseVariableBorrowRate: { toString(): string };
    variableRateSlope1: { toString(): string };
    variableRateSlope2: { toString(): string };
    maxVariableBorrowRate?: { toString(): string };
  }
) {
  const checks: Array<[string, string, string]> = [
    [
      'baseVariableBorrowRate',
      values.baseVariableBorrowRate.toString(),
      TARGET_BASE_VARIABLE_RATE_RAY,
    ],
    ['variableRateSlope1', values.variableRateSlope1.toString(), TARGET_VARIABLE_RATE_SLOPE_RAY],
    ['variableRateSlope2', values.variableRateSlope2.toString(), TARGET_VARIABLE_RATE_SLOPE_RAY],
  ];
  if (values.maxVariableBorrowRate) {
    checks.push([
      'getMaxVariableBorrowRate',
      values.maxVariableBorrowRate.toString(),
      TARGET_MAX_VARIABLE_RATE_RAY,
    ]);
  }

  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`${symbol}: ${label}=${actual}, expected approved target ${expected}`);
    }
  }
}

export async function assertApprovedVariableCurve(symbol: string, strategy: any) {
  const [baseVariableBorrowRate, variableRateSlope1, variableRateSlope2, maxVariableBorrowRate] =
    await Promise.all([
      strategy.baseVariableBorrowRate(),
      strategy.variableRateSlope1(),
      strategy.variableRateSlope2(),
      strategy.getMaxVariableBorrowRate(),
    ]);
  const curve = {
    baseVariableBorrowRate,
    variableRateSlope1,
    variableRateSlope2,
    maxVariableBorrowRate,
  };
  assertTargetVariableCurve(symbol, curve);
  return curve;
}

export async function assertRecordedStrategyIdentity(
  symbol: string,
  strategy: any,
  provider: any,
  deployment: any
) {
  if (!deployment?.address || !deployment?.runtimeBytecodeHash || !deployment?.constructorParams) {
    throw new Error(`${symbol}: incomplete recorded strategy deployment identity`);
  }
  if (strategy.address.toLowerCase() !== deployment.address.toLowerCase()) {
    throw new Error(`${symbol}: strategy contract differs from recorded deployment address`);
  }

  const runtimeCode = await provider.getCode(deployment.address);
  if (runtimeCode === '0x') throw new Error(`${symbol}: recorded strategy has no runtime bytecode`);
  const runtimeHash = utils.keccak256(runtimeCode);
  if (runtimeHash.toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase()) {
    throw new Error(
      `${symbol}: runtime bytecode hash ${runtimeHash} != recorded ${deployment.runtimeBytecodeHash}`
    );
  }

  const recorded = deployment.constructorParams;
  const [
    addressesProvider,
    optimalUtilizationRate,
    baseVariableBorrowRate,
    variableRateSlope1,
    variableRateSlope2,
    stableRateSlope1,
    stableRateSlope2,
    maxVariableBorrowRate,
  ] = await Promise.all([
    strategy.addressesProvider(),
    strategy.OPTIMAL_UTILIZATION_RATE(),
    strategy.baseVariableBorrowRate(),
    strategy.variableRateSlope1(),
    strategy.variableRateSlope2(),
    strategy.stableRateSlope1(),
    strategy.stableRateSlope2(),
    strategy.getMaxVariableBorrowRate(),
  ]);

  const expectedProvider = recorded.provider || deployment.addressesProvider;
  if (!expectedProvider || addressesProvider.toLowerCase() !== expectedProvider.toLowerCase()) {
    throw new Error(
      `${symbol}: strategy addressesProvider ${addressesProvider} != recorded ${expectedProvider}`
    );
  }
  if (
    deployment.addressesProvider &&
    deployment.addressesProvider.toLowerCase() !== expectedProvider.toLowerCase()
  ) {
    throw new Error(`${symbol}: deployment provider fields disagree`);
  }

  const recordedChecks: Array<[string, string, unknown]> = [
    ['optimalUtilizationRate', recorded.optimalUtilizationRate, optimalUtilizationRate],
    ['baseVariableBorrowRate', recorded.baseVariableBorrowRate, baseVariableBorrowRate],
    ['variableRateSlope1', recorded.variableRateSlope1, variableRateSlope1],
    ['variableRateSlope2', recorded.variableRateSlope2, variableRateSlope2],
    ['stableRateSlope1', recorded.stableRateSlope1, stableRateSlope1],
    ['stableRateSlope2', recorded.stableRateSlope2, stableRateSlope2],
  ];
  for (const [label, expected, actual] of recordedChecks) {
    if (expected === undefined || actual?.toString() !== expected) {
      throw new Error(`${symbol}: ${label}=${actual}, recorded=${expected}`);
    }
  }

  assertTargetVariableCurve(symbol, {
    baseVariableBorrowRate,
    variableRateSlope1,
    variableRateSlope2,
    maxVariableBorrowRate,
  });
}
