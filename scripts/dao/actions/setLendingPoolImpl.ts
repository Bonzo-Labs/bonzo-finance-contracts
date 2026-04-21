import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface SetLendingPoolImplArgs {
  pool: string;
}

const MODULE: ActionModule<SetLendingPoolImplArgs> = {
  kind: 'setLendingPoolImpl',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const pool = assertAddress('pool', args.pool);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setLendingPoolImpl', [pool]);
    return makeAction(
      'setLendingPoolImpl',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setLendingPoolImpl(${pool})`,
      [],
      'executor'
    );
  },
  async preview() {
    return { before: {}, after: { lendingPoolImpl: '(see AddressesProvider.getLendingPool after upgrade)' } };
  },
  async verify() {
    return true;
  },
};
export default MODULE;
