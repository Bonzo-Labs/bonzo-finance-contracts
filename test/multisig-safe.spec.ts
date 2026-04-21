/**
 * Unit tests for the Gnosis Safe v1.4.1 pre-approved signature blob builder.
 * The blob format is specifically:
 *   per owner (sorted ascending by address): r(32) || s(32) || v(1)
 *   where r = address left-padded to 32 bytes, s = 0, v = 1 (pre-approved)
 */
import { expect } from 'chai';
import { utils, BigNumber } from 'ethers';
import {
  buildPreApprovedSignatures,
  buildValueTransferTx,
} from '../scripts/multisig/lib/safe';

describe('multisig/lib/safe — pre-approved signature blob', () => {
  it('produces a 65-byte blob per owner', () => {
    const owners = ['0x0000000000000000000000000000000000000001'];
    const blob = buildPreApprovedSignatures(owners);
    expect(blob).to.match(/^0x[0-9a-fA-F]+$/);
    expect((blob.length - 2) / 2).to.equal(65);
  });

  it('sorts owners ascending by address', () => {
    const owners = [
      '0x0000000000000000000000000000000000000003',
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
    ];
    const blob = buildPreApprovedSignatures(owners);
    const hex = blob.slice(2);
    // Each sig is 130 hex chars. Extract the 20-byte addresses from the end of each r-field.
    const addrs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const sig = hex.slice(i * 130, (i + 1) * 130);
      const rPadded = sig.slice(0, 64);
      addrs.push('0x' + rPadded.slice(24));
    }
    expect(addrs).to.deep.equal([
      '0x0000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000002',
      '0x0000000000000000000000000000000000000003',
    ]);
  });

  it('sets s=0 and v=1 for each owner', () => {
    const owners = ['0x00000000000000000000000000000000000000aa'];
    const blob = buildPreApprovedSignatures(owners);
    const hex = blob.slice(2);
    const s = hex.slice(64, 128);
    const v = hex.slice(128, 130);
    expect(s).to.equal('0'.repeat(64));
    expect(v).to.equal('01');
  });

  it('sort is case-insensitive by canonical address', () => {
    // Both refer to the same EIP-55 checksummed address; buildPreApprovedSignatures
    // normalizes before sorting. Input capitalization must not affect the blob.
    const a = '0x00000000000000000000000000000000000000AA';
    const b = '0x00000000000000000000000000000000000000bb';
    const blob1 = buildPreApprovedSignatures([a, b]);
    const blob2 = buildPreApprovedSignatures([b, a]);
    expect(blob1).to.equal(blob2);
  });
});

describe('multisig/lib/safe — buildValueTransferTx', () => {
  it('encodes an HBAR-only transfer with operation=CALL, data=0x, zero gas refund fields', () => {
    const tx = buildValueTransferTx(
      '0x00000000000000000000000000000000000000aa',
      BigNumber.from('1000000000000000000'),
      BigNumber.from(42)
    );
    expect(tx.to).to.equal(utils.getAddress('0x00000000000000000000000000000000000000aa'));
    expect(tx.value.toString()).to.equal('1000000000000000000');
    expect(tx.data).to.equal('0x');
    expect(tx.operation).to.equal(0);
    expect(tx.safeTxGas.toString()).to.equal('0');
    expect(tx.baseGas.toString()).to.equal('0');
    expect(tx.gasPrice.toString()).to.equal('0');
    expect(tx.gasToken).to.equal('0x0000000000000000000000000000000000000000');
    expect(tx.refundReceiver).to.equal('0x0000000000000000000000000000000000000000');
    expect(tx.nonce.toString()).to.equal('42');
  });
});
