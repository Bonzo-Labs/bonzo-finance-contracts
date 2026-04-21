import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import {
  assertAddress,
  assertUint,
  makeAction,
  readReserveConfig,
} from './_helpers';

export interface SetLiquidationThresholdArgs {
  asset: string;
  threshold: number | string;
}

const MODULE: ActionModule<SetLiquidationThresholdArgs> = {
  kind: 'setLiquidationThreshold',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const threshold = assertUint('threshold', args.threshold, 10_000);
    const data = ILendingPoolConfigurator.encodeFunctionData('setLiquidationThreshold', [
      asset,
      threshold,
    ]);
    return makeAction(
      'setLiquidationThreshold',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setLiquidationThreshold(${asset}, ${threshold})`,
      ['CollateralConfigurationChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, liquidationThreshold: String(args.threshold) } };
  },

  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.liquidationThreshold === String(args.threshold);
  },
};

export default MODULE;
