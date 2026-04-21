import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, getAddressesProvider, makeAction } from './_helpers';

export interface TransferProviderOwnershipArgs {
  newOwner: string;
}

const MODULE: ActionModule<TransferProviderOwnershipArgs> = {
  kind: 'transferProviderOwnership',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const newOwner = assertAddress('newOwner', args.newOwner);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('transferOwnership', [newOwner]);
    return makeAction(
      'transferProviderOwnership',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `LendingPoolAddressesProvider.transferOwnership(${newOwner})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    const before = await ap.owner();
    return { before: { owner: before }, after: { owner: assertAddress('newOwner', args.newOwner) } };
  },
  async verify(provider, args, ctx) {
    const ap = getAddressesProvider(provider, ctx);
    return (await ap.owner()).toLowerCase() === assertAddress('newOwner', args.newOwner).toLowerCase();
  },
};
export default MODULE;
