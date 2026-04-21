import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface DisableBorrowingOnReserveArgs {
  asset: string;
}

const MODULE: ActionModule<DisableBorrowingOnReserveArgs> = {
  kind: 'disableBorrowingOnReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('disableBorrowingOnReserve', [asset]);
    return makeAction(
      'disableBorrowingOnReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `disableBorrowingOnReserve(${asset})`,
      ['BorrowingDisabledOnReserve'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, borrowingEnabled: 'false' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.borrowingEnabled === 'false';
  },
};
export default MODULE;
