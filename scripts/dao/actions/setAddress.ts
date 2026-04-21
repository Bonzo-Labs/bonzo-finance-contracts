import { utils } from 'ethers';
import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, getAddressesProvider, makeAction } from './_helpers';

export interface SetAddressArgs {
  id: string; // 0x-prefixed bytes32
  newAddress: string;
}

const normalizeId = (id: string): string => {
  if (utils.isHexString(id, 32)) return id;
  if (id.length <= 32) return utils.formatBytes32String(id);
  throw new Error(`setAddress.id must be bytes32-hex or ≤32-char ASCII, got ${id}`);
};

const MODULE: ActionModule<SetAddressArgs> = {
  kind: 'setAddress',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const id = normalizeId(args.id);
    const newAddress = assertAddress('newAddress', args.newAddress);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setAddress', [id, newAddress]);
    return makeAction(
      'setAddress',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setAddress(${args.id}, ${newAddress})`,
      [],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const id = normalizeId(args.id);
    const ap = getAddressesProvider(provider, ctx);
    try {
      const before = await ap.getAddress(id);
      return {
        before: { [args.id]: before },
        after: { [args.id]: assertAddress('newAddress', args.newAddress) },
      };
    } catch {
      return { before: {}, after: { [args.id]: args.newAddress } };
    }
  },
  async verify(provider, args, ctx) {
    const id = normalizeId(args.id);
    const ap = getAddressesProvider(provider, ctx);
    const current = await ap.getAddress(id);
    return current.toLowerCase() === assertAddress('newAddress', args.newAddress).toLowerCase();
  },
};
export default MODULE;
