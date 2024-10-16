import BigNumber from 'bignumber.js';
import { oneRay } from '../../helpers/constants';
import { IInterestRateStrategyParams } from '../../helpers/types';

export const rateStrategyUSDC: IInterestRateStrategyParams = {
  name: 'rateStrategyUSDC',
  optimalUtilizationRate: new BigNumber(0.75).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.04).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyHBAR: IInterestRateStrategyParams = {
  name: 'rateStrategyHBAR',
  optimalUtilizationRate: new BigNumber(0.75).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.06).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyHBARX: IInterestRateStrategyParams = {
  name: 'rateStrategyHBARX',
  optimalUtilizationRate: new BigNumber(0.7).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.06).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyWETH: IInterestRateStrategyParams = {
  name: 'rateStrategyWETH',
  optimalUtilizationRate: new BigNumber(0.65).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.04).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
};

// SAUCE, XSAUCE
export const rateStrategySAUCE: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.55).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.07).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

// KARATE, DOVU, PACK, HST
export const rateStrategyVolatileOne: IInterestRateStrategyParams = {
  name: 'rateStrategyVolatileOne',
  optimalUtilizationRate: new BigNumber(0.45).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.1).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(3).multipliedBy(oneRay).toFixed(),
};

// STEAM
export const rateStrategyVolatileTwo: IInterestRateStrategyParams = {
  name: 'rateStrategyVolatileTwo',
  optimalUtilizationRate: new BigNumber(0.45).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.08).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.1).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(3).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyVolatileThree: IInterestRateStrategyParams = {
  name: 'rateStrategyVolatileThree',
  optimalUtilizationRate: new BigNumber(0.45).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.08).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(3).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.1).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(3).multipliedBy(oneRay).toFixed(),
};
