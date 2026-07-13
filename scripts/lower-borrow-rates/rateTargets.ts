import BigNumber from 'bignumber.js';

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
