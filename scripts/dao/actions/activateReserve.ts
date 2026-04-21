import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction, readReserveConfig } from './_helpers';

export interface ActivateReserveArgs {
  asset: string;
}

const MODULE: ActionModule<ActivateReserveArgs> = {
  kind: 'activateReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const data = ILendingPoolConfigurator.encodeFunctionData('activateReserve', [asset]);
    return makeAction(
      'activateReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `activateReserve(${asset})`,
      ['ReserveActivated'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, isActive: 'true' } };
  },
  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.isActive === 'true';
  },
};
export default MODULE;
