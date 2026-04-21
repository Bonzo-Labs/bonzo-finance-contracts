import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface EnableBorrowingOnReserveArgs {
  asset: string;
  stableBorrowRateEnabled: boolean;
}

const MODULE: ActionModule<EnableBorrowingOnReserveArgs> = {
  kind: 'enableBorrowingOnReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('enableBorrowingOnReserve', [
      asset,
      Boolean(args.stableBorrowRateEnabled),
    ]);
    return makeAction(
      'enableBorrowingOnReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `enableBorrowingOnReserve(${asset}, stable=${args.stableBorrowRateEnabled})`,
      ['BorrowingEnabledOnReserve'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return {
      before,
      after: {
        ...before,
        borrowingEnabled: 'true',
        stableBorrowRateEnabled: String(Boolean(args.stableBorrowRateEnabled)),
      },
    };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return (
      cfg.borrowingEnabled === 'true' &&
      cfg.stableBorrowRateEnabled === String(Boolean(args.stableBorrowRateEnabled))
    );
  },
};
export default MODULE;
