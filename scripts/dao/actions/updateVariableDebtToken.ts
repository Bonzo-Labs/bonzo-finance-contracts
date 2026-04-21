import { Contract } from 'ethers';
import type { ActionModule } from '../types';
import { IAaveProtocolDataProvider, ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface UpdateVariableDebtTokenArgs {
  asset: string;
  incentivesController: string;
  name: string;
  symbol: string;
  implementation: string;
  params?: string;
}

const MODULE: ActionModule<UpdateVariableDebtTokenArgs> = {
  kind: 'updateVariableDebtToken',
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
    const data = ILendingPoolConfigurator.encodeFunctionData('updateVariableDebtToken', [input]);
    return makeAction(
      'updateVariableDebtToken',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `updateVariableDebtToken(${input.asset}) → impl=${input.implementation}`,
      ['VariableDebtTokenUpgraded'],
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
      before: { variableDebtToken: t.variableDebtTokenAddress },
      after: { variableDebtToken: t.variableDebtTokenAddress, implementation: args.implementation },
    };
  },
  async verify() {
    // No public `implementation()` getter guaranteed on debt tokens; full post-exec
    // verification is deferred to the execution report.
    return true;
  },
};
export default MODULE;
