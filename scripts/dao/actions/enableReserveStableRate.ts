import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface EnableReserveStableRateArgs {
  asset: string;
}

const MODULE: ActionModule<EnableReserveStableRateArgs> = {
  kind: 'enableReserveStableRate',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('enableReserveStableRate', [asset]);
    return makeAction(
      'enableReserveStableRate',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `enableReserveStableRate(${asset})`,
      ['StableRateEnabledOnReserve'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, stableBorrowRateEnabled: 'true' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.stableBorrowRateEnabled === 'true';
  },
};
export default MODULE;
