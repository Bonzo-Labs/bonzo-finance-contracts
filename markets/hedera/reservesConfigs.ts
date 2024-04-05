// import BigNumber from 'bignumber.js';
// import { oneRay } from '../../helpers/constants';
import { eContractid, IReserveParams } from '../../helpers/types';
import {
  rateStrategyStableTwo,
  rateStrategyStableThree,
  rateStrategyVolatileOne,
  rateStrategyVolatileTwo,
  rateStrategyVolatileThree,
} from './rateStrategies';

// Reference - https://docs.aave.com/risk/v/aave-v2/liquidity-risk/borrow-interest-rate for the rate strategies

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyDAI: IReserveParams = {
  strategy: rateStrategyStableTwo,
  baseLTVAsCollateral: '8000',
  liquidationThreshold: '8001',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyCLXY: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5000',
  liquidationThreshold: '5001',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyHBARX: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5000',
  liquidationThreshold: '5001',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategySAUCE: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5000',
  liquidationThreshold: '5001',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyUSDC: IReserveParams = {
  strategy: rateStrategyStableThree,
  baseLTVAsCollateral: '8000',
  liquidationThreshold: '8001',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: true,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1000',
};
