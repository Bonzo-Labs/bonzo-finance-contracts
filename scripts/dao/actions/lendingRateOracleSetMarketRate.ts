import type { ActionModule } from '../types';
import { ILendingRateOracle } from './_interfaces';
import { assertAddress, assertUint, getLendingRateOracle, makeAction } from './_helpers';

export interface LendingRateOracleSetMarketRateArgs {
  asset: string;
  rate: string | number;
}

const MODULE: ActionModule<LendingRateOracleSetMarketRateArgs> = {
  kind: 'lendingRateOracleSetMarketRate',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const rate = assertUint('rate', args.rate);
    const data = ILendingRateOracle.encodeFunctionData('setMarketBorrowRate', [asset, rate]);
    return makeAction(
      'lendingRateOracleSetMarketRate',
      ctx.addresses.lendingRateOracle,
      data,
      `LendingRateOracle.setMarketBorrowRate(${asset}, ${rate})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const lro = getLendingRateOracle(provider, ctx);
    let before = '(unreadable)';
    try {
      before = (await lro.getMarketBorrowRate(assertAddress('asset', args.asset))).toString();
    } catch {}
    return {
      before: { borrowRate: before },
      after: { borrowRate: String(args.rate) },
    };
  },
  async verify(provider, args, ctx) {
    const lro = getLendingRateOracle(provider, ctx);
    const got = await lro.getMarketBorrowRate(assertAddress('asset', args.asset));
    return got.toString() === String(args.rate);
  },
};
export default MODULE;
