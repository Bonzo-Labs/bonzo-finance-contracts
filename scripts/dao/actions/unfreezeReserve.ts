import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface UnfreezeReserveArgs {
  asset: string;
}

const MODULE: ActionModule<UnfreezeReserveArgs> = {
  kind: 'unfreezeReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('unfreezeReserve', [asset]);
    return makeAction(
      'unfreezeReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `unfreezeReserve(${asset})`,
      ['ReserveUnfrozen'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, isFrozen: 'false' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.isFrozen === 'false';
  },
};
export default MODULE;
