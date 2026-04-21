import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface DisableReserveStableRateArgs {
  asset: string;
}

const MODULE: ActionModule<DisableReserveStableRateArgs> = {
  kind: 'disableReserveStableRate',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('disableReserveStableRate', [asset]);
    return makeAction(
      'disableReserveStableRate',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `disableReserveStableRate(${asset})`,
      ['StableRateDisabledOnReserve'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, stableBorrowRateEnabled: 'false' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.stableBorrowRateEnabled === 'false';
  },
};
export default MODULE;
