import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface SetLendingPoolConfiguratorImplArgs {
  configurator: string;
}

const MODULE: ActionModule<SetLendingPoolConfiguratorImplArgs> = {
  kind: 'setLendingPoolConfiguratorImpl',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const impl = assertAddress('configurator', args.configurator);
    const data = ILendingPoolAddressesProvider.encodeFunctionData(
      'setLendingPoolConfiguratorImpl',
      [impl]
    );
    return makeAction(
      'setLendingPoolConfiguratorImpl',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setLendingPoolConfiguratorImpl(${impl})`,
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
