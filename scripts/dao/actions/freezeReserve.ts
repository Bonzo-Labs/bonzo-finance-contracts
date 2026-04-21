import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface FreezeReserveArgs {
  asset: string;
}

const MODULE: ActionModule<FreezeReserveArgs> = {
  kind: 'freezeReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('freezeReserve', [asset]);
    return makeAction(
      'freezeReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `freezeReserve(${asset})`,
      ['ReserveFrozen'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, isFrozen: 'true' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.isFrozen === 'true';
  },
};
export default MODULE;
