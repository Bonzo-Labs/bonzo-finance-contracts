import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveCaps } from './_helpers';

export interface SetSupplyCapArgs {
  asset: string;
  supplyCap: number | string;
}

const MODULE: ActionModule<SetSupplyCapArgs> = {
  kind: 'setSupplyCap',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const cap = assertUint('supplyCap', args.supplyCap);
    const data = ILendingPoolConfigurator.encodeFunctionData('setSupplyCap', [asset, cap]);
    return makeAction(
      'setSupplyCap',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setSupplyCap(${asset}, ${cap})`,
      ['SupplyCapChanged'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveCaps(provider, ctx, args.asset);
    return { before, after: { ...before, supplyCap: String(args.supplyCap) } };
  },
  async verify(provider, args, ctx) {
    const caps = await readReserveCaps(provider, ctx, args.asset);
    return caps.supplyCap === String(args.supplyCap);
  },
};
export default MODULE;
