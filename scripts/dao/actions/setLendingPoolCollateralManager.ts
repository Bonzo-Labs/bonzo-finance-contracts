import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface SetLendingPoolCollateralManagerArgs {
  manager: string;
}

const MODULE: ActionModule<SetLendingPoolCollateralManagerArgs> = {
  kind: 'setLendingPoolCollateralManager',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const m = assertAddress('manager', args.manager);
    const data = ILendingPoolAddressesProvider.encodeFunctionData(
      'setLendingPoolCollateralManager',
      [m]
    );
    return makeAction(
      'setLendingPoolCollateralManager',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setLendingPoolCollateralManager(${m})`,
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
