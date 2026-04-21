import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, getAddressesProvider, makeAction } from './_helpers';

export interface SetEmergencyAdminArgs {
  admin: string;
}

const MODULE: ActionModule<SetEmergencyAdminArgs> = {
  kind: 'setEmergencyAdmin',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const admin = assertAddress('admin', args.admin);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setEmergencyAdmin', [admin]);
    return makeAction(
      'setEmergencyAdmin',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setEmergencyAdmin(${admin})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    const before = await ap.getEmergencyAdmin();
    return {
      before: { emergencyAdmin: before },
      after: { emergencyAdmin: assertAddress('admin', args.admin) },
    };
  },
  async verify(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    return (
      (await ap.getEmergencyAdmin()).toLowerCase() ===
      assertAddress('admin', args.admin).toLowerCase()
    );
  },
};
export default MODULE;
