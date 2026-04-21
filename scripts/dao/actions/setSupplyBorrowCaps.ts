/**
 * Convenience action that encodes setSupplyCap + setBorrowCap as a single
 * EncodedAction via MultiSendCallOnly. Operator may prefer to use two separate
 * actions in a bundle if they want them auditable individually — this module
 * is for the case where "set both caps" is meaningfully atomic.
 */
import { utils } from 'ethers';
import type { ActionModule } from '../types';
import { ILendingPoolConfigurator, IMultiSendCallOnly } from './_interfaces';
import { assertAddress, assertUint, makeAction, readReserveCaps } from './_helpers';

export interface SetSupplyBorrowCapsArgs {
  asset: string;
  supplyCap: number | string;
  borrowCap: number | string;
}

// MultiSend packed operations: 1 byte op, 20 bytes to, 32 bytes value, 32 bytes dataLen, data
const packCall = (to: string, data: string): string => {
  const dataBytes = utils.arrayify(data);
  return utils.solidityPack(
    ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
    [0, to, 0, dataBytes.length, dataBytes]
  );
};

const MODULE: ActionModule<SetSupplyBorrowCapsArgs> = {
  kind: 'setSupplyBorrowCaps',
  defaultTargetSafe: 'executor',
  build(args, ctx) {
    const asset = assertAddress('asset', args.asset);
    const sc = assertUint('supplyCap', args.supplyCap);
    const bc = assertUint('borrowCap', args.borrowCap);
    const supplyData = ILendingPoolConfigurator.encodeFunctionData('setSupplyCap', [asset, sc]);
    const borrowData = ILendingPoolConfigurator.encodeFunctionData('setBorrowCap', [asset, bc]);
    const configurator = ctx.addresses.lendingPoolConfigurator;
    const packed =
      '0x' +
      packCall(configurator, supplyData).slice(2) +
      packCall(configurator, borrowData).slice(2);
    const multiSendData = IMultiSendCallOnly.encodeFunctionData('multiSend', [packed]);
    if (!ctx.addresses.multiSendCallOnly) {
      throw new Error(
        'setSupplyBorrowCaps requires MULTI_SEND_ADDRESSES to be populated in scripts/dao/config.ts'
      );
    }
    return makeAction(
      'setSupplyBorrowCaps',
      ctx.addresses.multiSendCallOnly,
      multiSendData,
      `setSupplyCap(${asset}, ${sc}) + setBorrowCap(${asset}, ${bc}) via MultiSendCallOnly`,
      ['SupplyCapChanged', 'BorrowCapChanged'],
      'executor'
    );
  },
  async preview(provider, args, ctx) {
    const before = await readReserveCaps(provider, ctx, args.asset);
    return {
      before,
      after: { supplyCap: String(args.supplyCap), borrowCap: String(args.borrowCap) },
    };
  },
  async verify(provider, args, ctx) {
    const caps = await readReserveCaps(provider, ctx, args.asset);
    return (
      caps.supplyCap === String(args.supplyCap) && caps.borrowCap === String(args.borrowCap)
    );
  },
};
export default MODULE;
