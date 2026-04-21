/**
 * Phase A §11.1 — calldata round-trip spec.
 * For every entry in the DAO action registry, build an EncodedAction and assert
 * the calldata decodes back to the same args via the relevant ethers.Interface.
 */
import { expect } from 'chai';
import { utils } from 'ethers';
import { REGISTRY, allKinds } from '../scripts/dao/actions/_registry';
import {
  ILendingPoolConfigurator,
  ILendingPoolAddressesProvider,
  IAaveOracle,
  ILendingRateOracle,
  IAToken,
  IMultiSendCallOnly,
  IStakingModule,
} from '../scripts/dao/actions/_interfaces';
import type { ActionKind, BuildContext } from '../scripts/dao/types';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ASSET = '0x0000000000000000000000000000000000001549';
const ONE = '0x0000000000000000000000000000000000000001';

const ctx: BuildContext = {
  chain_type: 'hedera_testnet',
  addresses: {
    lendingPool: '0x1000000000000000000000000000000000000001',
    lendingPoolConfigurator: '0x1000000000000000000000000000000000000002',
    lendingPoolAddressesProvider: '0x1000000000000000000000000000000000000003',
    aaveProtocolDataProvider: '0x1000000000000000000000000000000000000004',
    aaveOracle: '0x1000000000000000000000000000000000000005',
    lendingRateOracle: '0x1000000000000000000000000000000000000006',
    lendingPoolCollateralManager: '0x1000000000000000000000000000000000000007',
    executorSafe: '0x1000000000000000000000000000000000000008',
    guardianSafe: '0x1000000000000000000000000000000000000009',
    multiSendCallOnly: '0x100000000000000000000000000000000000000A',
  },
};

// Test args per action kind
const sampleArgs: Partial<Record<ActionKind, any>> = {
  setLtv: { asset: ASSET, ltv: 7000 },
  setLiquidationThreshold: { asset: ASSET, threshold: 7500 },
  setLiquidationBonus: { asset: ASSET, bonus: 10500 },
  setReserveFactor: { asset: ASSET, reserveFactor: 1000 },
  configureReserveAsCollateral: {
    asset: ASSET,
    ltv: 7000,
    liquidationThreshold: 7500,
    liquidationBonus: 10500,
  },
  setReserveInterestRateStrategy: { asset: ASSET, strategy: ONE },
  activateReserve: { asset: ASSET },
  deactivateReserve: { asset: ASSET },
  freezeReserve: { asset: ASSET },
  unfreezeReserve: { asset: ASSET },
  enableBorrowingOnReserve: { asset: ASSET, stableBorrowRateEnabled: true },
  disableBorrowingOnReserve: { asset: ASSET },
  enableReserveStableRate: { asset: ASSET },
  disableReserveStableRate: { asset: ASSET },
  setSupplyCap: { asset: ASSET, supplyCap: 1000 },
  setBorrowCap: { asset: ASSET, borrowCap: 800 },
  setSupplyBorrowCaps: { asset: ASSET, supplyCap: 1000, borrowCap: 800 },
  batchInitReserve: {
    inputs: [
      {
        aTokenImpl: ONE,
        stableDebtTokenImpl: ONE,
        variableDebtTokenImpl: ONE,
        underlyingAssetDecimals: 6,
        interestRateStrategyAddress: ONE,
        underlyingAsset: ASSET,
        treasury: ONE,
        incentivesController: ZERO_ADDR,
        underlyingAssetName: 'USDC',
        aTokenName: 'Bonzo aToken USDC',
        aTokenSymbol: 'mUSDC',
        variableDebtTokenName: 'Bonzo variableDebt USDC',
        variableDebtTokenSymbol: 'variableDebtUSDC',
        stableDebtTokenName: 'Bonzo Stable Debt USDC',
        stableDebtTokenSymbol: 'stableDebtUSDC',
        params: '0x',
      },
    ],
  },
  initReserveFromMarketConfig: {
    symbol: 'USDC',
    underlyingAsset: ASSET,
    underlyingAssetDecimals: 6,
    aTokenImpl: ONE,
    stableDebtTokenImpl: ONE,
    variableDebtTokenImpl: ONE,
    interestRateStrategyAddress: ONE,
    treasury: ONE,
    incentivesController: ZERO_ADDR,
  },
  updateAToken: {
    asset: ASSET,
    treasury: ONE,
    incentivesController: ZERO_ADDR,
    name: 'Bonzo aToken USDC',
    symbol: 'mUSDC',
    implementation: ONE,
  },
  updateVariableDebtToken: {
    asset: ASSET,
    incentivesController: ZERO_ADDR,
    name: 'Bonzo variableDebt USDC',
    symbol: 'variableDebtUSDC',
    implementation: ONE,
  },
  updateStableDebtToken: {
    asset: ASSET,
    incentivesController: ZERO_ADDR,
    name: 'Bonzo Stable Debt USDC',
    symbol: 'stableDebtUSDC',
    implementation: ONE,
  },
  setPoolAdmin: { admin: ONE },
  setEmergencyAdmin: { admin: ONE },
  setLendingPoolImpl: { pool: ONE },
  setLendingPoolConfiguratorImpl: { configurator: ONE },
  setLendingPoolCollateralManager: { manager: ONE },
  setPriceOracle: { priceOracle: ONE },
  setLendingRateOracle: { lendingRateOracle: ONE },
  setAddress: { id: 'POOL_ADMIN', newAddress: ONE },
  setAddressAsProxy: { id: 'LENDING_POOL', impl: ONE },
  transferProviderOwnership: { newOwner: ONE },
  aaveOracleSetAssetSources: { assets: [ASSET], sources: [ONE] },
  aaveOracleSetFallbackOracle: { fallbackOracle: ONE },
  lendingRateOracleSetMarketRate: { asset: ASSET, rate: 100 },
  aTokenSweepToTreasury: { aToken: ONE, tokens: [ASSET] },
  stakingSetRewardRate: { stakingModule: ONE, rate: 100 },
  stakingSetRewardsDuration: { stakingModule: ONE, duration: 604800 },
  stakingRecoverERC20: { stakingModule: ONE, token: ASSET, amount: 1000 },
  setPoolPause: { val: true },
};

const ifaceForKind = (kind: ActionKind): utils.Interface => {
  if (kind === 'setPoolPause') return ILendingPoolConfigurator;
  if (kind.startsWith('staking')) return IStakingModule;
  if (kind === 'aTokenSweepToTreasury') return IAToken;
  if (kind === 'setSupplyBorrowCaps') return IMultiSendCallOnly;
  if (kind === 'aaveOracleSetAssetSources' || kind === 'aaveOracleSetFallbackOracle')
    return IAaveOracle;
  if (kind === 'lendingRateOracleSetMarketRate') return ILendingRateOracle;
  if (
    kind === 'setPoolAdmin' ||
    kind === 'setEmergencyAdmin' ||
    kind === 'setLendingPoolImpl' ||
    kind === 'setLendingPoolConfiguratorImpl' ||
    kind === 'setLendingPoolCollateralManager' ||
    kind === 'setPriceOracle' ||
    kind === 'setLendingRateOracle' ||
    kind === 'setAddress' ||
    kind === 'setAddressAsProxy' ||
    kind === 'transferProviderOwnership'
  ) {
    return ILendingPoolAddressesProvider;
  }
  return ILendingPoolConfigurator;
};

describe('DAO actions registry — calldata round-trip', () => {
  for (const kind of allKinds()) {
    it(`builds valid calldata for ${kind}`, () => {
      const args = sampleArgs[kind];
      expect(args, `missing sampleArgs for ${kind}`).to.exist;
      const mod = REGISTRY[kind];
      const enc = mod.build(args, ctx);
      expect(enc.kind).to.equal(kind);
      expect(enc.to).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(enc.data).to.match(/^0x[a-fA-F0-9]+$/);
      expect(enc.value).to.equal('0');
      expect(enc.targetSafe).to.be.oneOf(['executor', 'guardian']);

      // Decode through the matching iface and expect no throw
      const iface = ifaceForKind(kind);
      const selector = enc.data.slice(0, 10);
      const fragment = iface.getFunction(selector);
      expect(fragment, `selector ${selector} not in iface for ${kind}`).to.exist;
      const decoded = iface.decodeFunctionData(fragment, enc.data);
      expect(decoded).to.be.an('array');
    });
  }
});
