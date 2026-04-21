import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import {
  assertAddress,
  assertUint,
  getConfigurator,
  makeAction,
  readReserveConfig,
} from './_helpers';

export interface SetLtvArgs {
  asset: string;
  ltv: number | string;
}

const MODULE: ActionModule<SetLtvArgs> = {
  kind: 'setLtv',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const ltv = assertUint('ltv', args.ltv, 10_000);
    const data = ILendingPoolConfigurator.encodeFunctionData('setLtv', [asset, ltv]);
    return makeAction(
      'setLtv',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setLtv(${asset}, ${ltv})`,
      ['CollateralConfigurationChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, ltv: String(args.ltv) } };
  },

  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.ltv === String(args.ltv);
  },
};

export default MODULE;
