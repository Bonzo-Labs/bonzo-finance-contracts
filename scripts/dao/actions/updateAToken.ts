import { Contract } from 'ethers';
import type { ActionModule } from '../types';
import { IAaveProtocolDataProvider, IAToken, ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface UpdateATokenArgs {
  asset: string;
  treasury: string;
  incentivesController: string;
  name: string;
  symbol: string;
  implementation: string;
  params?: string;
}

const MODULE: ActionModule<UpdateATokenArgs> = {
  kind: 'updateAToken',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const input = {
      asset: assertAddress('asset', args.asset),
      treasury: assertAddress('treasury', args.treasury),
      incentivesController:
        args.incentivesController === '0x0000000000000000000000000000000000000000'
          ? args.incentivesController
          : assertAddress('incentivesController', args.incentivesController),
      name: args.name,
      symbol: args.symbol,
      implementation: assertAddress('implementation', args.implementation),
      params: args.params || '0x',
    };
    const data = ILendingPoolConfigurator.encodeFunctionData('updateAToken', [input]);
    return makeAction(
      'updateAToken',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `updateAToken(${input.asset}) → impl=${input.implementation}`,
      ['ATokenUpgraded'],
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
    const aToken = new Contract(t.aTokenAddress, IAToken, provider);
    let currentImpl = '(unknown)';
    try {
      currentImpl = await aToken.implementation();
    } catch {
      /* non-upgradeable or unknown */
    }
    return {
      before: { aTokenAddress: t.aTokenAddress, implementation: currentImpl },
      after: { aTokenAddress: t.aTokenAddress, implementation: args.implementation },
    };
  },
  async verify(provider, args, ctx) {
    const dp = new Contract(
      ctx.addresses.aaveProtocolDataProvider,
      IAaveProtocolDataProvider,
      provider
    );
    const t = await dp.getReserveTokensAddresses(assertAddress('asset', args.asset));
    const aToken = new Contract(t.aTokenAddress, IAToken, provider);
    try {
      const impl = await aToken.implementation();
      return impl.toLowerCase() === assertAddress('implementation', args.implementation).toLowerCase();
    } catch {
      return false;
    }
  },
};
export default MODULE;
