import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface DeactivateReserveArgs {
  asset: string;
}

const MODULE: ActionModule<DeactivateReserveArgs> = {
  kind: 'deactivateReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('deactivateReserve', [asset]);
    return makeAction(
      'deactivateReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `deactivateReserve(${asset})`,
      ['ReserveDeactivated'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, isActive: 'false' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.isActive === 'false';
  },
};
export default MODULE;
