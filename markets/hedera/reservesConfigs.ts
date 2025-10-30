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
  rateStrategyUSDCNew,
  rateStrategyWETH,
} from './rateStrategies';

// Reference - https://docs.aave.com/risk/v/aave-v2/liquidity-risk/borrow-interest-rate for the rate strategies

export const strategyXSAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '4000',
  liquidationThreshold: '6759',
  liquidationBonus: '10395',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1094',
  supplyCap: '0',
  borrowCap: '11656189',
};

export const strategyKARATE: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '2000',
  liquidationThreshold: '6500',
  liquidationBonus: '10346',
  borrowingEnabled: false,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1960',
  supplyCap: '0',
  borrowCap: '159294201',
};

export const strategyWHBAR: IReserveParams = {
  strategy: rateStrategyHBAR,
  baseLTVAsCollateral: '6272',
  liquidationThreshold: '6798',
  liquidationBonus: '10198',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1168',
  supplyCap: '0',
  borrowCap: '9714624',
};

export const strategyWETH: IReserveParams = {
  strategy: rateStrategyWETH,
  baseLTVAsCollateral: '7000',
  liquidationThreshold: '7500',
  liquidationBonus: '10700',
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
  baseLTVAsCollateral: '6298',
  liquidationThreshold: '6828',
  liquidationBonus: '10118',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1014',
  supplyCap: '0',
  borrowCap: '14770600',
};

export const strategySAUCE: IReserveParams = {
  strategy: rateStrategySAUCE,
  baseLTVAsCollateral: '4000',
  liquidationThreshold: '6804',
  liquidationBonus: '10395',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1460',
  supplyCap: '0',
  borrowCap: '2077258',
};

export const strategyUSDC: IReserveParams = {
  strategy: rateStrategyUSDCNew,
  baseLTVAsCollateral: '8045',
  liquidationThreshold: '8350',
  liquidationBonus: '10740',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1350',
  supplyCap: '0',
  borrowCap: '823749',
};

export const strategyDOVU: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '2000',
  liquidationThreshold: '5900',
  liquidationBonus: '10666',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1725',
  supplyCap: '0',
  borrowCap: '99458344',
};

export const strategyBONZO: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '4000',
  liquidationThreshold: '5900',
  liquidationBonus: '10666',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1725',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyGRELF: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '2000',
  liquidationThreshold: '5700',
  liquidationBonus: '10666',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1725',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyKBL: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '1000',
  liquidationThreshold: '5700',
  liquidationBonus: '10666',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1725',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyXPACK: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '3000',
  liquidationThreshold: '4350',
  liquidationBonus: '10666',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1725',
  supplyCap: '0',
  borrowCap: '0',
};

export const strategyHST: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '1000',
  liquidationThreshold: '5200',
  liquidationBonus: '10617',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '8',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1522',
  supplyCap: '50000000',
  borrowCap: '12098299',
};

export const strategyPACK: IReserveParams = {
  strategy: rateStrategyVolatileOne,
  baseLTVAsCollateral: '1000',
  liquidationThreshold: '5700',
  liquidationBonus: '10691',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '6',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1297',
  supplyCap: '0',
  borrowCap: '1001122',
};

export const strategySTEAM: IReserveParams = {
  strategy: rateStrategyVolatileTwo,
  baseLTVAsCollateral: '1000',
  liquidationThreshold: '5700',
  liquidationBonus: '10814',
  borrowingEnabled: true,
  stableBorrowRateEnabled: false,
  reserveDecimals: '2',
  aTokenImpl: eContractid.AToken,
  reserveFactor: '1388',
  supplyCap: '0',
  borrowCap: '5419281',
};
