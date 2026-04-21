import { utils } from 'ethers';
import type { ActionModule } from '../types';
import { ILendingPoolAddressesProvider } from './_interfaces';
import { assertAddress, makeAction } from './_helpers';

export interface SetAddressAsProxyArgs {
  id: string;
  impl: string;
}

const normalizeId = (id: string): string => {
  if (utils.isHexString(id, 32)) return id;
  if (id.length <= 32) return utils.formatBytes32String(id);
  throw new Error(`setAddressAsProxy.id must be bytes32-hex or ≤32-char ASCII, got ${id}`);
};

const MODULE: ActionModule<SetAddressAsProxyArgs> = {
  kind: 'setAddressAsProxy',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const id = normalizeId(args.id);
    const impl = assertAddress('impl', args.impl);
    const data = ILendingPoolAddressesProvider.encodeFunctionData('setAddressAsProxy', [id, impl]);
    return makeAction(
      'setAddressAsProxy',
      ctx.addresses.lendingPoolAddressesProvider,
      data,
      `setAddressAsProxy(${args.id}, ${impl})`,
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
