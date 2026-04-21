import { utils } from 'ethers';
import { IMultiSendCallOnly } from '../actions/_interfaces';
import type { EncodedAction } from '../types';

// 1 byte op || 20 bytes to || 32 bytes value || 32 bytes dataLen || data
const pack = (a: EncodedAction): string => {
  const bytes = utils.arrayify(a.data);
  return utils.solidityPack(
    ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
    [0, a.to, a.value, bytes.length, bytes]
  );
};

export const encodeMultiSend = (actions: EncodedAction[]): { to: null; data: string } | {
  to: string;
  data: string;
} => {
  if (actions.length === 0) throw new Error('encodeMultiSend: actions must be non-empty');
  const transactions = '0x' + actions.map((a) => pack(a).slice(2)).join('');
  const data = IMultiSendCallOnly.encodeFunctionData('multiSend', [transactions]);
  return { to: '', data };
};
