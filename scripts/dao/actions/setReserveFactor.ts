import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveConfig } from './_helpers';

export interface SetReserveFactorArgs {
  asset: string;
  reserveFactor: number | string;
}

const MODULE: ActionModule<SetReserveFactorArgs> = {
  kind: 'setReserveFactor',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const reserveFactor = assertUint('reserveFactor', args.reserveFactor, 10_000);
    const data = ILendingPoolConfigurator.encodeFunctionData('setReserveFactor', [
      asset,
      reserveFactor,
    ]);
    return makeAction(
      'setReserveFactor',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setReserveFactor(${asset}, ${reserveFactor})`,
      ['ReserveFactorChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, reserveFactor: String(args.reserveFactor) } };
  },

  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.reserveFactor === String(args.reserveFactor);
  },
};

export default MODULE;
