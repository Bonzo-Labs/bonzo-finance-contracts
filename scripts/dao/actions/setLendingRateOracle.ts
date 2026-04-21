import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface SetLendingRateOracleArgs {
  lendingRateOracle: string;
}

const MODULE: ActionModule<SetLendingRateOracleArgs> = {
  kind: 'setLendingRateOracle',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const o = assertAddress('lendingRateOracle', args.lendingRateOracle);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setLendingRateOracle', [o]);
    return makeAction(
      'setLendingRateOracle',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setLendingRateOracle(${o})`,
      [],
      'executor'
    );
  },
  async preview() {
    return { before: {}, after: {} };
  },
  async verify() {
    return true;
  },
};
export default MODULE;
