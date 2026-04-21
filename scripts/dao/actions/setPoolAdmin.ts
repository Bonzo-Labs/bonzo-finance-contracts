import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, getAddressesProvider, makeAction } from './_helpers';

export interface SetPoolAdminArgs {
  admin: string;
}

const MODULE: ActionModule<SetPoolAdminArgs> = {
  kind: 'setPoolAdmin',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const admin = assertAddress('admin', args.admin);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setPoolAdmin', [admin]);
    return makeAction(
      'setPoolAdmin',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setPoolAdmin(${admin})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    const before = await ap.getPoolAdmin();
    return { before: { poolAdmin: before }, after: { poolAdmin: assertAddress('admin', args.admin) } };
  },
  async verify(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    return (await ap.getPoolAdmin()).toLowerCase() === assertAddress('admin', args.admin).toLowerCase();
  },
};
export default MODULE;
