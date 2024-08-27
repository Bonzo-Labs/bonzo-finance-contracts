// import BigNumber from 'bignumber.js';
// import { oneRay } from '../../helpers/constants';
import { eContractid, IReserveParams } from '../../helpers/types';
import {
  rateStrategyUSDC,
  rateStrategyHBAR,
  rateStrategyVolatileOne,
  rateStrategySAUCE,
  rateStrategyHBARX,
} from './rateStrategies';

// Reference - https://docs.aave.com/risk/v/aave-v2/liquidity-risk/borrow-interest-rate for the rate strategies

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyXSAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '8400',
  liquidationBonus: '10800',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '500000000', // 500 * (10^6)
  borrowCap: '300000000', // 300 * (10^6)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyKARATE: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5500',
  liquidationThreshold: '7400',
  liquidationBonus: '11300',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '50000000000', // 500 * (10^8)
  borrowCap: '30000000000', // 300 * (10^8)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyWHBAR: IReserveParams = {
  strategy: rateStrategyHBAR,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '8700',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '50000000000', // 500 * (10^8)
  borrowCap: '30000000000', // 300 * (10^8)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyHBARX: IReserveParams = {
  strategy: rateStrategyHBARX,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '8200',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '50000000000', // 500 * (10^8)
  borrowCap: '30000000000', // 300 * (10^8)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategySAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '8300',
  liquidationBonus: '10800',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '500000000', // 500 * (10^6)
  borrowCap: '300000000', // 300 * (10^6)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyUSDC: IReserveParams = {
  strategy: rateStrategyUSDC,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '7800',
  liquidationBonus: '10450',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '500000000', // 500 * (10^6)
  borrowCap: '300000000', // 300 * (10^6)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyDOVU: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5500',
  liquidationThreshold: '6700',
  liquidationBonus: '11200',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '50000000000', // 500 * (10^8)
  borrowCap: '30000000000', // 300 * (10^8)
};

// TODO - Reverse the LTVA and liquidationThreshold values
export const strategyHST: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '4000',
  liquidationThreshold: '5200',
  liquidationBonus: '11200',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '50000000000', // 500 * (10^8)
  borrowCap: '30000000000', // 300 * (10^8)
};

// // TODO - Reverse the LTVA and liquidationThreshold values
// export const strategyPACK: IReserveParams = {
//   strategy: rateStrategyVolatileOne,
//   baseLTVAsCollateral: '4500',
//   liquidationThreshold: '6000',
//   liquidationBonus: '11200',
//   borrowingEnabled: true,
//   stableBorrowRateEnabled: false,
//   reserveDecimals: '6',
//   aTokenImpl: eContractid.AToken,
//   reserveFactor: '2000',
// };

// // TODO - Reverse the LTVA and liquidationThreshold values
// export const strategySTEAM: IReserveParams = {
//   strategy: rateStrategyVolatileOne,
//   baseLTVAsCollateral: '4500',
//   liquidationThreshold: '5500',
//   liquidationBonus: '11400',
//   borrowingEnabled: true,
//   stableBorrowRateEnabled: false,
//   reserveDecimals: '2',
//   aTokenImpl: eContractid.AToken,
//   reserveFactor: '2000',
// };
