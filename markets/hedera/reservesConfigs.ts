// import BigNumber from 'bignumber.js';
// import { oneRay } from '../../helpers/constants';
import { eContractid, IReserveParams } from '../../helpers/types';
import {
  rateStrategyUSDC,
  rateStrategyHBAR,
  rateStrategyVolatileOne,
  rateStrategySAUCE,
  rateStrategyHBARX,
  rateStrategyVolatileTwo,
} from './rateStrategies';

// Reference - https://docs.aave.com/risk/v/aave-v2/liquidity-risk/borrow-interest-rate for the rate strategies

export const strategyXSAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '7600',
  liquidationBonus: '10800',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyKARATE: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5500',
  liquidationThreshold: '6500',
  liquidationBonus: '11300',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyWHBAR: IReserveParams = {
  strategy: rateStrategyHBAR,
  baseLTVAsCollateral: '7500',
  liquidationThreshold: '8000',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyHBARX: IReserveParams = {
  strategy: rateStrategyHBARX,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '7500',
  liquidationBonus: '10500',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategySAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '7600',
  liquidationBonus: '10800',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

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
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyDOVU: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '5500',
  liquidationThreshold: '6500',
  liquidationBonus: '11200',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyHST: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '4000',
  liquidationThreshold: '5000',
  liquidationBonus: '11200',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyPACK: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '4500',
  liquidationThreshold: '6000',
  liquidationBonus: '11200',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategySTEAM: IReserveParams = {
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: '4500',
  liquidationThreshold: '5000',
  liquidationBonus: '11400',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '2',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '2000',
  supplyCap: '0',
  borrowCap: '0',
};
