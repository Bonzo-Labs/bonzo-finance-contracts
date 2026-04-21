/**
 * Shared helpers used by every action module.
 */
import { Contract, providers, utils } from 'ethers';
import {
  IAaveOracle,
  IAaveProtocolDataProvider,
  ILendingPool,
  ILendingPoolAddressesProvider,
  ILendingPoolConfigurator,
  ILendingRateOracle,
  IAToken,
} from './_interfaces';
import type { BuildContext, EncodedAction, ActionKind, TargetSafe } from '../types';

export const assertAddress = (label: string, address: string): string => {
  if (!address || !utils.isAddress(address) || address === '0x' + '0'.repeat(40)) {
    throw new Error(`${label} is not a valid non-zero address: "${address}"`);
  }
  return utils.getAddress(address);
};

import { BigNumber } from 'ethers';

export const assertUint = (label: string, value: number | string, max?: number | string): string => {
  const n = BigNumber.from(value);
  if (n.isNegative()) throw new Error(`${label} must be non-negative, got ${value}`);
  if (max !== undefined && n.gt(BigNumber.from(max))) {
    throw new Error(`${label} exceeds maximum ${max}, got ${value}`);
  }
  return n.toString();
};

export const makeAction = (
  kind: ActionKind,
  to: string,
  data: string,
  description: string,
  expectedEvents: string[],
  targetSafe: TargetSafe
): EncodedAction => ({
  kind,
  to: assertAddress(`action.to for ${kind}`, to),
  value: '0',
  data,
  description,
  expectedEvents,
  targetSafe,
});

export const getDataProvider = (provider: providers.Provider, ctx: BuildContext): Contract =>
  new Contract(ctx.addresses.aaveProtocolDataProvider, IAaveProtocolDataProvider, provider);

export const getConfigurator = (provider: providers.Provider, ctx: BuildContext): Contract =>
  new Contract(ctx.addresses.lendingPoolConfigurator, ILendingPoolConfigurator, provider);

export const getAddressesProvider = (
  provider: providers.Provider,
  ctx: BuildContext
): Contract =>
  new Contract(
    ctx.addresses.lendingPoolAddressesProvider,
    ILendingPoolAddressesProvider,
    provider
  );

export const getAaveOracle = (provider: providers.Provider, ctx: BuildContext): Contract =>
  new Contract(ctx.addresses.aaveOracle, IAaveOracle, provider);

export const getLendingRateOracle = (provider: providers.Provider, ctx: BuildContext): Contract =>
  new Contract(ctx.addresses.lendingRateOracle, ILendingRateOracle, provider);

export const getLendingPool = (provider: providers.Provider, ctx: BuildContext): Contract =>
  new Contract(ctx.addresses.lendingPool, ILendingPool, provider);

export const getAToken = (provider: providers.Provider, atoken: string): Contract =>
  new Contract(assertAddress('aToken', atoken), IAToken, provider);

export const readReserveConfig = async (
  provider: providers.Provider,
  ctx: BuildContext,
  asset: string
): Promise<Record<string, string>> => {
  const dp = getDataProvider(provider, ctx);
  const r = await dp.getReserveConfigurationData(assertAddress('asset', asset));
  return {
    decimals: r.decimals.toString(),
    ltv: r.ltv.toString(),
    liquidationThreshold: r.liquidationThreshold.toString(),
    liquidationBonus: r.liquidationBonus.toString(),
    reserveFactor: r.reserveFactor.toString(),
    usageAsCollateralEnabled: String(r.usageAsCollateralEnabled),
    borrowingEnabled: String(r.borrowingEnabled),
    stableBorrowRateEnabled: String(r.stableBorrowRateEnabled),
    isActive: String(r.isActive),
    isFrozen: String(r.isFrozen),
  };
};

export const readReserveCaps = async (
  provider: providers.Provider,
  ctx: BuildContext,
  asset: string
): Promise<{ borrowCap: string; supplyCap: string }> => {
  const dp = getDataProvider(provider, ctx);
  const r = await dp.getReserveCaps(assertAddress('asset', asset));
  return { borrowCap: r.borrowCap.toString(), supplyCap: r.supplyCap.toString() };
};
