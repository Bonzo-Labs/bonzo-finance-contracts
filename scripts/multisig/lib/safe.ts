/**
 * Gnosis Safe v1.4.1 ABI + helpers used by the multisig smoke scripts.
 *
 * Standard Safe, not a Palmera fork. All writes go through approveHash() +
 * execTransaction() with a pre-approved signature blob — no EIP-712 off-chain
 * signing required.
 */
import { utils, BigNumber, Contract, providers } from 'ethers';

export const SafeAbi = [
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
  'function nonce() view returns (uint256)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function approveHash(bytes32 hashToApprove)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
];

export const getSafe = (addr: string, signerOrProvider: providers.Provider | any): Contract =>
  new Contract(utils.getAddress(addr), SafeAbi, signerOrProvider);

export interface SafeTx {
  to: string;
  value: BigNumber;
  data: string;
  operation: 0 | 1;
  safeTxGas: BigNumber;
  baseGas: BigNumber;
  gasPrice: BigNumber;
  gasToken: string;
  refundReceiver: string;
  nonce: BigNumber;
}

const ZERO = '0x0000000000000000000000000000000000000000';

// NOTE — Hedera unit quirk. `amountTinybar` is forwarded verbatim to Safe's
// execTransaction `value` arg, which in turn is forwarded to the inner
// `to.call{value: ...}("")`. On Hedera EVM the CALL opcode's value parameter
// is in TINYBAR (1 HBAR = 1e8), NOT 18-decimal wei. Passing a parseEther(x)
// value here will ask the Safe to forward ~1e10 more HBAR than intended and
// the inner CALL will fail → GS013. See scripts/multisig/config.ts.
export const buildValueTransferTx = (
  to: string,
  amountTinybar: BigNumber,
  nonce: BigNumber
): SafeTx => ({
  to: utils.getAddress(to),
  value: amountTinybar,
  data: '0x',
  operation: 0,
  safeTxGas: BigNumber.from(0),
  baseGas: BigNumber.from(0),
  gasPrice: BigNumber.from(0),
  gasToken: ZERO,
  refundReceiver: ZERO,
  nonce,
});

export const computeTxHash = async (safe: Contract, tx: SafeTx): Promise<string> =>
  safe.getTransactionHash(
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    tx.nonce
  );

/**
 * Build the pre-approved-signature blob expected by execTransaction.
 *
 * Each owner: 65 bytes = r (address left-padded to 32) || s (32 zero bytes) || v (0x01).
 * v=1 tells the Safe to look up approvedHashes[owner][txHash] and require 1.
 *
 * MUST be sorted ascending by signer address.
 */
export const buildPreApprovedSignatures = (owners: string[]): string => {
  const sorted = [...owners].map((a) => utils.getAddress(a)).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const sigs = sorted
    .map((addr) => {
      const r = utils.hexZeroPad(addr, 32);
      const s = utils.hexZeroPad('0x00', 32);
      const v = '01';
      return r.slice(2) + s.slice(2) + v;
    })
    .join('');
  return '0x' + sigs;
};

export const execTransaction = async (
  safe: Contract,
  tx: SafeTx,
  signatures: string,
  overrides: { gasLimit?: BigNumber } = {}
) =>
  safe.execTransaction(
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    signatures,
    { gasLimit: overrides.gasLimit || BigNumber.from(2_000_000) }
  );
