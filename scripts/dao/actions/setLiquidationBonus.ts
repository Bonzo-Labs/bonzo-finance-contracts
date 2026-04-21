import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveConfig } from './_helpers';

export interface SetLiquidationBonusArgs {
  asset: string;
  bonus: number | string;
}

const MODULE: ActionModule<SetLiquidationBonusArgs> = {
  kind: 'setLiquidationBonus',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const bonus = assertUint('bonus', args.bonus, 65_535);
    const data = ILendingPoolConfigurator.encodeFunctionData('setLiquidationBonus', [asset, bonus]);
    return makeAction(
      'setLiquidationBonus',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setLiquidationBonus(${asset}, ${bonus})`,
      ['CollateralConfigurationChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const before = await readReserveConfig(provider, ctx, args.asset);
    return { before, after: { ...before, liquidationBonus: String(args.bonus) } };
  },

  async verify(provider, args, ctx) {
    const cfg = await readReserveConfig(provider, ctx, args.asset);
    return cfg.liquidationBonus === String(args.bonus);
  },
};

export default MODULE;
