import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, getAddressesProvider, makeAction } from './_helpers';

export interface SetPriceOracleArgs {
  priceOracle: string;
}

const MODULE: ActionModule<SetPriceOracleArgs> = {
  kind: 'setPriceOracle',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const o = assertAddress('priceOracle', args.priceOracle);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setPriceOracle', [o]);
    return makeAction(
      'setPriceOracle',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setPriceOracle(${o})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    try {
      const before = await ap.getPriceOracle();
      return {
        before: { priceOracle: before },
        after: { priceOracle: assertAddress('priceOracle', args.priceOracle) },
      };
    } catch {
      return { before: {}, after: { priceOracle: args.priceOracle } };
    }
  },
  async verify(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    const current: string = await ap.getPriceOracle();
    return current.toLowerCase() === assertAddress('priceOracle', args.priceOracle).toLowerCase();
  },
};
export default MODULE;
