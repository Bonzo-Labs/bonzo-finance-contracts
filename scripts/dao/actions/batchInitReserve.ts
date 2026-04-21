import { Contract } from 'ethers';
import type { ActionModule } from '../types';
import { IAaveProtocolDataProvider, ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface InitReserveInput {
  aTokenImpl: string;
  stableDebtTokenImpl: string;
  variableDebtTokenImpl: string;
  underlyingAssetDecimals: number;
  interestRateStrategyAddress: string;
  underlyingAsset: string;
  treasury: string;
  incentivesController: string;
  underlyingAssetName: string;
  aTokenName: string;
  aTokenSymbol: string;
  variableDebtTokenName: string;
  variableDebtTokenSymbol: string;
  stableDebtTokenName: string;
  stableDebtTokenSymbol: string;
  params: string;
}

export interface BatchInitReserveArgs {
  inputs: InitReserveInput[];
}

const normalize = (i: InitReserveInput): InitReserveInput => ({
  aTokenImpl: assertAddress('aTokenImpl', i.aTokenImpl),
  stableDebtTokenImpl: assertAddress('stableDebtTokenImpl', i.stableDebtTokenImpl),
  variableDebtTokenImpl: assertAddress('variableDebtTokenImpl', i.variableDebtTokenImpl),
  underlyingAssetDecimals: i.underlyingAssetDecimals,
  interestRateStrategyAddress: assertAddress(
    'interestRateStrategyAddress',
    i.interestRateStrategyAddress
  ),
  underlyingAsset: assertAddress('underlyingAsset', i.underlyingAsset),
  treasury: assertAddress('treasury', i.treasury),
  incentivesController:
    i.incentivesController === '0x0000000000000000000000000000000000000000'
      ? i.incentivesController
      : assertAddress('incentivesController', i.incentivesController),
  underlyingAssetName: i.underlyingAssetName,
  aTokenName: i.aTokenName,
  aTokenSymbol: i.aTokenSymbol,
  variableDebtTokenName: i.variableDebtTokenName,
  variableDebtTokenSymbol: i.variableDebtTokenSymbol,
  stableDebtTokenName: i.stableDebtTokenName,
  stableDebtTokenSymbol: i.stableDebtTokenSymbol,
  params: i.params || '0x',
});

const MODULE: ActionModule<BatchInitReserveArgs> = {
  kind: 'batchInitReserve',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const normalized = args.inputs.map(normalize);
    const data = ILendingPoolConfigurator.encodeFunctionData('batchInitReserve', [normalized]);
    const assets = normalized.map((i) => i.underlyingAsset).join(', ');
    return makeAction(
      'batchInitReserve',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `batchInitReserve([${assets}])`,
      ['ReserveInitialized'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const dp = new Contract(
      ctx.addresses.aaveProtocolDataProvider,
      IAaveProtocolDataProvider,
      provider
    );
    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (const i of args.inputs) {
      const asset = assertAddress('underlyingAsset', i.underlyingAsset);
      try {
        const t = await dp.getReserveTokensAddresses(asset);
        before[asset] = `aToken=${t.aTokenAddress}`;
      } catch {
        before[asset] = '(not-listed)';
      }
      after[asset] = `aTokenImpl=${i.aTokenImpl}`;
    }
    return { before, after };
  },
  async verify(provider, args, ctx) {
    const dp = new Contract(
      ctx.addresses.aaveProtocolDataProvider,
      IAaveProtocolDataProvider,
      provider
    );
    for (const i of args.inputs) {
      const t = await dp.getReserveTokensAddresses(assertAddress('underlyingAsset', i.underlyingAsset));
      if (!t.aTokenAddress || /^0x0+$/i.test(t.aTokenAddress)) return false;
    }
    return true;
  },
};
export default MODULE;
