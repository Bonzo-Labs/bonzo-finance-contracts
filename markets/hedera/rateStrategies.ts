import BigNumber from 'bignumber.js';
import { oneRay } from '../../helpers/constants';
import { IInterestRateStrategyParams } from '../../helpers/types';

export const rateStrategyUSDC: IInterestRateStrategyParams = {
  name: 'rateStrategyUSDC',
  optimalUtilizationRate: new BigNumber(0.52).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.12).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyHBAR: IInterestRateStrategyParams = {
  name: 'rateStrategyHBAR',
  optimalUtilizationRate: new BigNumber(0.55).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.06).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyHBARX: IInterestRateStrategyParams = {
  name: 'rateStrategyHBARX',
  optimalUtilizationRate: new BigNumber(0.53).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.06).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.02).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.8).multipliedBy(oneRay).toFixed(),
};

// XSAUCE
export const rateStrategyXSAUCE: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.54).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.07).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

// SAUCE
export const rateStrategySAUCE: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.54).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyKARATE: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.7).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(1).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyDOVU: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.47).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyPACK: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.52).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

export const rateStrategyHST: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.54).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

export const rateStrategySTEAM: IInterestRateStrategyParams = {
  name: 'rateStrategySAUCE',
  optimalUtilizationRate: new BigNumber(0.54).multipliedBy(oneRay).toFixed(),
  baseVariableBorrowRate: new BigNumber(0.0).multipliedBy(oneRay).toFixed(),
  variableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(0.09).multipliedBy(oneRay).toFixed(),
};

// HST, STEAM, BONZO, GRELF, KBL, XPACK
export const rateStrategyVolatileOne: IInterestRateStrategyParams = {
  name: 'rateStrategyVolatileOne',
  optimalUtilizationRate: new BigNumber(0.54).multipliedBy(oneRay).toFixed(),
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
  variableRateSlope2: new BigNumber(2.5).multipliedBy(oneRay).toFixed(),
  stableRateSlope1: new BigNumber(0.1).multipliedBy(oneRay).toFixed(),
  stableRateSlope2: new BigNumber(3).multipliedBy(oneRay).toFixed(),
};
