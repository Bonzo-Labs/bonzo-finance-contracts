import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveConfig } from './_helpers';

export interface ConfigureReserveAsCollateralArgs {
  asset: string;
  ltv: number | string;
  liquidationThreshold: number | string;
  liquidationBonus: number | string;
}

const MODULE: ActionModule<ConfigureReserveAsCollateralArgs> = {
  kind: 'configureReserveAsCollateral',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const ltv = assertUint('ltv', args.ltv, 10_000);
    const threshold = assertUint('liquidationThreshold', args.liquidationThreshold, 10_000);
    const bonus = assertUint('liquidationBonus', args.liquidationBonus, 65_535);
    const data = ILendingPoolConfigurator.encodeFunctionData('configureReserveAsCollateral', [
      asset,
      ltv,
      threshold,
      bonus,
    ]);
    return makeAction(
      'configureReserveAsCollateral',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `configureReserveAsCollateral(${asset}, ltv=${ltv}, liqThreshold=${threshold}, liqBonus=${bonus})`,
      ['CollateralConfigurationChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return {
      before,
      after: {
        ...before,
        ltv: String(args.ltv),
        liquidationThreshold: String(args.liquidationThreshold),
        liquidationBonus: String(args.liquidationBonus),
      },
    };
  },

  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return (
      cfg.ltv === String(args.ltv) &&
      cfg.liquidationThreshold === String(args.liquidationThreshold) &&
      cfg.liquidationBonus === String(args.liquidationBonus)
    );
  },
};

export default MODULE;
