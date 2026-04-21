import { Contract } from 'ethers';
import type { ActionModule } from '../types';
import { IAaveProtocolDataProvider, ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface UpdateStableDebtTokenArgs {
  asset: string;
  incentivesController: string;
  name: string;
  symbol: string;
  implementation: string;
  params?: string;
}

const MODULE: ActionModule<UpdateStableDebtTokenArgs> = {
  kind: 'updateStableDebtToken',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const input = {
      asset: assertAddress('asset', args.asset),
      incentivesController:
        args.incentivesController === '0x0000000000000000000000000000000000000000'
          ? args.incentivesController
          : assertAddress('incentivesController', args.incentivesController),
      name: args.name,
      symbol: args.symbol,
      implementation: assertAddress('implementation', args.implementation),
      params: args.params || '0x',
    };
    const data = ILendingPoolConfigurator.encodeFunctionData('updateStableDebtToken', [input]);
    return makeAction(
      'updateStableDebtToken',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `updateStableDebtToken(${input.asset}) → impl=${input.implementation}`,
      ['StableDebtTokenUpgraded'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const dp = new Contract(
      ctx.addresses.aaveProtocolDataProvider,
      IAaveProtocolDataProvider,
      provider
    );
    const t = await dp.getReserveTokensAddresses(assertAddress('asset', args.asset));
    return {
      before: { stableDebtToken: t.stableDebtTokenAddress },
      after: { stableDebtToken: t.stableDebtTokenAddress, implementation: args.implementation },
    };
  },
  async verify() {
    return true;
  },
};
export default MODULE;
