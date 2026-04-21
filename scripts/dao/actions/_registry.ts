import type { ActionKind, ActionModule } from '../types';

import setLtv from './setLtv';
import setLiquidationThreshold from './setLiquidationThreshold';
import setLiquidationBonus from './setLiquidationBonus';
import setReserveFactor from './setReserveFactor';
import configureReserveAsCollateral from './configureReserveAsCollateral';
import setReserveInterestRateStrategy from './setReserveInterestRateStrategy';

import activateReserve from './activateReserve';
import deactivateReserve from './deactivateReserve';
import freezeReserve from './freezeReserve';
import unfreezeReserve from './unfreezeReserve';
import enableBorrowingOnReserve from './enableBorrowingOnReserve';
import disableBorrowingOnReserve from './disableBorrowingOnReserve';
import enableReserveStableRate from './enableReserveStableRate';
import disableReserveStableRate from './disableReserveStableRate';

import setSupplyCap from './setSupplyCap';
import setBorrowCap from './setBorrowCap';
import setSupplyBorrowCaps from './setSupplyBorrowCaps';

import batchInitReserve from './batchInitReserve';
import initReserveFromMarketConfig from './initReserveFromMarketConfig';
import updateAToken from './updateAToken';
import updateVariableDebtToken from './updateVariableDebtToken';
import updateStableDebtToken from './updateStableDebtToken';

import setPoolAdmin from './setPoolAdmin';
import setEmergencyAdmin from './setEmergencyAdmin';
import setLendingPoolImpl from './setLendingPoolImpl';
import setLendingPoolConfiguratorImpl from './setLendingPoolConfiguratorImpl';
import setLendingPoolCollateralManager from './setLendingPoolCollateralManager';
import setPriceOracle from './setPriceOracle';
import setLendingRateOracle from './setLendingRateOracle';
import setAddress from './setAddress';
import setAddressAsProxy from './setAddressAsProxy';
import transferProviderOwnership from './transferProviderOwnership';

import aaveOracleSetAssetSources from './aaveOracleSetAssetSources';
import aaveOracleSetFallbackOracle from './aaveOracleSetFallbackOracle';
import lendingRateOracleSetMarketRate from './lendingRateOracleSetMarketRate';

import aTokenSweepToTreasury from './aTokenSweepToTreasury';
import stakingSetRewardRate from './stakingSetRewardRate';
import stakingSetRewardsDuration from './stakingSetRewardsDuration';
import stakingRecoverERC20 from './stakingRecoverERC20';

import setPoolPause from './setPoolPause';

export const REGISTRY: Record<ActionKind, ActionModule> = {
  setLtv,
  setLiquidationThreshold,
  setLiquidationBonus,
  setReserveFactor,
  configureReserveAsCollateral,
  setReserveInterestRateStrategy,

  activateReserve,
  deactivateReserve,
  freezeReserve,
  unfreezeReserve,
  enableBorrowingOnReserve,
  disableBorrowingOnReserve,
  enableReserveStableRate,
  disableReserveStableRate,

  setSupplyCap,
  setBorrowCap,
  setSupplyBorrowCaps,

  batchInitReserve,
  initReserveFromMarketConfig,
  updateAToken,
  updateVariableDebtToken,
  updateStableDebtToken,

  setPoolAdmin,
  setEmergencyAdmin,
  setLendingPoolImpl,
  setLendingPoolConfiguratorImpl,
  setLendingPoolCollateralManager,
  setPriceOracle,
  setLendingRateOracle,
  setAddress,
  setAddressAsProxy,
  transferProviderOwnership,

  aaveOracleSetAssetSources,
  aaveOracleSetFallbackOracle,
  lendingRateOracleSetMarketRate,

  aTokenSweepToTreasury,
  stakingSetRewardRate,
  stakingSetRewardsDuration,
  stakingRecoverERC20,

  setPoolPause,
};

export const getAction = (kind: ActionKind): ActionModule => {
  const mod = REGISTRY[kind];
  if (!mod) throw new Error(`Unknown action kind: ${kind}`);
  return mod;
};

export const allKinds = (): ActionKind[] => Object.keys(REGISTRY) as ActionKind[];
