import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveCaps } from './_helpers';

export interface SetBorrowCapArgs {
  asset: string;
  borrowCap: number | string;
}

const MODULE: ActionModule<SetBorrowCapArgs> = {
  kind: 'setBorrowCap',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const cap = assertUint('borrowCap', args.borrowCap);
    const data = ILendingPoolConfigurator.encodeFunctionData('setBorrowCap', [asset, cap]);
    return makeAction(
      'setBorrowCap',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setBorrowCap(${asset}, ${cap})`,
      ['BorrowCapChanged'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveCaps(provider, ctx, args.asset);
    return { before, after: { ...before, borrowCap: String(args.borrowCap) } };
  },
  async verify(provider, args, ctx) {
    const caps = await readReserveCaps(provider, ctx, args.asset);
    return caps.borrowCap === String(args.borrowCap);
  },
};
export default MODULE;
