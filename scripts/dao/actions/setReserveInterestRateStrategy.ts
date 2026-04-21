import { Contract } from 'ethers';
import type { ActionModule } from '../types';
import { ILendingPoolConfigurator } from './_interfaces';
import { assertAddress, getDataProvider, makeAction } from './_helpers';
import { utils } from 'ethers';

export interface SetReserveInterestRateStrategyArgs {
  asset: string;
  strategy: string;
}

const RESERVE_DATA_FULL = new utils.Interface([
  'function getReserveData(address asset) view returns (tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id)',
]);

const MODULE: ActionModule<SetReserveInterestRateStrategyArgs> = {
  kind: 'setReserveInterestRateStrategy',
  defaultTargetSafe: 'executor',

  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const strategy = assertAddress('strategy', args.strategy);
    const data = ILendingPoolConfigurator.encodeFunctionData(
      'setReserveInterestRateStrategyAddress',
      [asset, strategy]
    );
    return makeAction(
      'setReserveInterestRateStrategy',
      ctx.addresses.lendingPoolConfigurator,
      data,
      `setReserveInterestRateStrategyAddress(${asset}, ${strategy})`,
      ['ReserveInterestRateStrategyChanged'],
      'executor'
    );
  },

  async preview(provider, args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const lendingPool = new Contract(ctx.addresses.lendingPool, RESERVE_DATA_FULL, provider);
    try {
      const r = await lendingPool.getReserveData(asset);
      return {
        before: { strategy: r.interestRateStrategyAddress },
        after: { strategy: assertAddress('strategy', args.strategy) },
      };
    } catch {
      return { before: { strategy: '(unreadable)' }, after: { strategy: args.strategy } };
    }
  },

  async verify(provider, args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const lendingPool = new Contract(ctx.addresses.lendingPool, RESERVE_DATA_FULL, provider);
    const r = await lendingPool.getReserveData(asset);
    return (
      r.interestRateStrategyAddress.toLowerCase() ===
      assertAddress('strategy', args.strategy).toLowerCase()
    );
  },
};

export default MODULE;
