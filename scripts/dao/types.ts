import { BigNumber, providers } from 'ethers';

export type ChainType = 'hedera_testnet' | 'hedera_mainnet';
export type TargetSafe = 'executor' | 'guardian';

export type ActionKind =
  // Reserve risk params
  | 'setLtv'
  | 'setLiquidationThreshold'
  | 'setLiquidationBonus'
  | 'setReserveFactor'
  | 'configureReserveAsCollateral'
  | 'setReserveInterestRateStrategy'
  // Reserve lifecycle
  | 'activateReserve'
  | 'deactivateReserve'
  | 'freezeReserve'
  | 'unfreezeReserve'
  | 'enableBorrowingOnReserve'
  | 'disableBorrowingOnReserve'
  | 'enableReserveStableRate'
  | 'disableReserveStableRate'
  // Caps & factors
  | 'setSupplyCap'
  | 'setBorrowCap'
  | 'setSupplyBorrowCaps'
  // Reserve listing & upgrades
  | 'batchInitReserve'
  | 'initReserveFromMarketConfig'
  | 'updateAToken'
  | 'updateVariableDebtToken'
  | 'updateStableDebtToken'
  // LendingPoolAddressesProvider
  | 'setPoolAdmin'
  | 'setEmergencyAdmin'
  | 'setLendingPoolImpl'
  | 'setLendingPoolConfiguratorImpl'
  | 'setLendingPoolCollateralManager'
  | 'setPriceOracle'
  | 'setLendingRateOracle'
  | 'setAddress'
  | 'setAddressAsProxy'
  | 'transferProviderOwnership'
  // Oracles
  | 'aaveOracleSetAssetSources'
  | 'aaveOracleSetFallbackOracle'
  | 'lendingRateOracleSetMarketRate'
  // Treasury / staking stubs
  | 'aTokenSweepToTreasury'
  | 'stakingSetRewardRate'
  | 'stakingSetRewardsDuration'
  | 'stakingRecoverERC20'
  // Guardian-only
  | 'setPoolPause';

export interface EncodedAction {
  kind: ActionKind;
  to: string;
  value: string; // decimal string for JSON-safety
  data: string; // 0x-prefixed hex calldata
  description: string;
  expectedEvents: string[]; // event names the action is expected to emit
  targetSafe: TargetSafe;
}

export interface BundleAction<TArgs = unknown> {
  kind: ActionKind;
  target?: string; // optional override; action module resolves default if omitted
  args: TArgs;
}

export interface Bundle {
  bipId: string;
  targetSafe: TargetSafe;
  description?: string;
  actions: BundleAction[];
}

export interface PreviewResult {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ActionModule<TArgs = any> {
  kind: ActionKind;
  defaultTargetSafe: TargetSafe;
  build(args: TArgs, ctx: BuildContext): EncodedAction;
  preview(provider: providers.Provider, args: TArgs, ctx: BuildContext): Promise<PreviewResult>;
  verify(provider: providers.Provider, args: TArgs, ctx: BuildContext): Promise<boolean>;
}

export interface BuildContext {
  chain_type: ChainType;
  addresses: ChainAddresses;
}

export interface ChainAddresses {
  lendingPool: string;
  lendingPoolConfigurator: string;
  lendingPoolAddressesProvider: string;
  aaveProtocolDataProvider: string;
  aaveOracle: string;
  lendingRateOracle: string;
  lendingPoolCollateralManager: string;
  executorSafe: string;
  guardianSafe: string;
  multiSendCallOnly: string;
}

export interface NetworkRuntime {
  chain_type: ChainType;
  provider: providers.JsonRpcProvider;
  owner: any; // ethers Wallet
  addresses: ChainAddresses;
}

// Keep BigNumber-safe numeric conversions in one place
export const toDecimalString = (v: BigNumber | number | string): string =>
  BigNumber.from(v).toString();
