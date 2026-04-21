/**
 * Builds InitReserveInput for batchInitReserve from a symbol lookup in
 * markets/hedera/reservesConfigs.ts. Defers to batchInitReserve for encoding
 * so the calldata path is a single tested surface.
 *
 * Operator supplies resolved implementation + treasury addresses; this module
 * only exists to remove the per-market boilerplate.
 */
import type { ActionModule } from '../types';
import batchInitReserve, { InitReserveInput } from './batchInitReserve';

export interface InitReserveFromMarketConfigArgs {
  symbol: string; // e.g. 'USDC'
  underlyingAsset: string;
  underlyingAssetDecimals: number;
  aTokenImpl: string;
  stableDebtTokenImpl: string;
  variableDebtTokenImpl: string;
  interestRateStrategyAddress: string;
  treasury: string;
  incentivesController: string;
  // Optional overrides — defaults derived from symbol
  aTokenNamePrefix?: string;
  symbolPrefix?: string;
  stableDebtPrefix?: string;
  variableDebtPrefix?: string;
  params?: string;
}

const MODULE: ActionModule<InitReserveFromMarketConfigArgs> = {
  kind: 'initReserveFromMarketConfig',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const aNamePrefix = args.aTokenNamePrefix || 'Bonzo aToken';
    const symPrefix = args.symbolPrefix || 'm';
    const sdbPrefix = args.stableDebtPrefix || 'Bonzo Stable Debt ';
    const vdbPrefix = args.variableDebtPrefix || 'Bonzo variableDebt ';
    const input: InitReserveInput = {
      aTokenImpl: args.aTokenImpl,
      stableDebtTokenImpl: args.stableDebtTokenImpl,
      variableDebtTokenImpl: args.variableDebtTokenImpl,
      underlyingAssetDecimals: args.underlyingAssetDecimals,
      interestRateStrategyAddress: args.interestRateStrategyAddress,
      underlyingAsset: args.underlyingAsset,
      treasury: args.treasury,
      incentivesController: args.incentivesController,
      underlyingAssetName: args.symbol,
      aTokenName: `${aNamePrefix} ${args.symbol}`,
      aTokenSymbol: `${symPrefix}${args.symbol}`,
      variableDebtTokenName: `${vdbPrefix}${args.symbol}`,
      variableDebtTokenSymbol: `variableDebt${args.symbol}`,
      stableDebtTokenName: `${sdbPrefix}${args.symbol}`,
      stableDebtTokenSymbol: `stableDebt${args.symbol}`,
      params: args.params || '0x',
    };
    const action = batchInitReserve.build({ inputs: [input] }, ctx);
    return { ...action, kind: 'initReserveFromMarketConfig', description: `initReserveFromMarketConfig(${args.symbol})` };
  },
  async preview(provider, args, ctx) {
    return batchInitReserve.preview(
      provider,
      { inputs: [{ ...(MODULE.build(args, ctx) as any), underlyingAsset: args.underlyingAsset } as any] } as any,
      ctx
    );
  },
  async verify(provider, args, ctx) {
    return batchInitReserve.verify(
      provider,
      { inputs: [{ underlyingAsset: args.underlyingAsset } as any] } as any,
      ctx
    );
  },
};
export default MODULE;
