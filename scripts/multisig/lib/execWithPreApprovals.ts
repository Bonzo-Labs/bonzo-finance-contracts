/**
 * Shared path: approveHash from threshold owners → callStatic → execTransaction.
 * Used by smoke transfers and DAO-encoded Safe execution.
 */
import { BigNumber, Contract, Wallet, utils } from 'ethers';
import { computeTxHash, buildPreApprovedSignatures, execTransaction, SafeTx } from './safe';

export type ApprovalTx = { owner: string; txHash: string };

export interface RunPreApprovalsAndExecParams {
  safe: Contract;
  safeAddr: string;
  tx: SafeTx;
  approverWallets: Wallet[];
  threshold: number;
  executor: Wallet;
  dryRun: boolean;
  /** Gas limit for execTransaction + callStatic (default 2_000_000). */
  gasLimit?: BigNumber;
  /** Optional one-liner after dry-run sig preview (e.g. smoke execTransaction args). */
  dryRunExecSummary?: string;
}

export interface RunPreApprovalsAndExecResult {
  safeTxHash: string;
  approverAddrs: string[];
  sigs: string;
  approvalTxs: ApprovalTx[];
  execTx: { hash: string; wait: () => Promise<any> } | null;
  receipt: any | null;
}

const defaultGasLimit = () => {
  const raw = process.env.GAS_LIMIT;
  if (raw) {
    const n = BigNumber.from(raw);
    if (n.gt(0)) return n;
  }
  return BigNumber.from(2_000_000);
};

export const runPreApprovalsAndExec = async (
  params: RunPreApprovalsAndExecParams
): Promise<RunPreApprovalsAndExecResult> => {
  const { safe, safeAddr, tx, approverWallets, threshold, executor, dryRun, gasLimit } = params;
  const gl = gasLimit ?? defaultGasLimit();

  const approverAddrs = approverWallets.map((w) => w.address);
  const safeTxHash = await computeTxHash(safe, tx);
  console.log(`\nSafe nonce: ${tx.nonce.toString()}`);
  console.log(`safeTxHash: ${safeTxHash}`);

  const sigsPreview = buildPreApprovedSignatures(approverAddrs);
  if (dryRun) {
    console.log(`\n[DRY-RUN] Planned signature blob (${sigsPreview.length / 2 - 1} bytes):`);
    console.log(`  ${sigsPreview}`);
    if (params.dryRunExecSummary) {
      console.log(`\n[DRY-RUN] Planned call:`);
      console.log(`  ${params.dryRunExecSummary}`);
    }
    console.log(`\n[DRY-RUN] Exiting without sending transactions.\n`);
    return {
      safeTxHash,
      approverAddrs,
      sigs: sigsPreview,
      approvalTxs: [],
      execTx: null,
      receipt: null,
    };
  }

  console.log('\nCollecting on-chain approvals...');
  const approvalTxs: ApprovalTx[] = [];
  for (const approver of approverWallets) {
    const existing = await safe.approvedHashes(approver.address, safeTxHash);
    if (existing.toNumber() === 1) {
      console.log(`  ${approver.address} already approved — skipping`);
      continue;
    }
    const connected = safe.connect(approver);
    const t = await connected.approveHash(safeTxHash, { gasLimit: 500_000 });
    console.log(`  ${approver.address} → approveHash tx=${t.hash}`);
    await t.wait();
    approvalTxs.push({ owner: approver.address, txHash: t.hash });
  }

  let count = 0;
  for (const w of approverWallets) {
    const v = await safe.approvedHashes(w.address, safeTxHash);
    if (v.toNumber() === 1) count++;
  }
  if (count < threshold) {
    throw new Error(`Only ${count}/${threshold} approvals on-chain after approveHash loop`);
  }
  console.log(`  approvals: ${count}/${threshold} ✅`);

  console.log('\nExecuting transaction...');
  const sigs = buildPreApprovedSignatures(approverAddrs);
  const safeAsExecutor = safe.connect(executor);

  try {
    await safeAsExecutor.callStatic.execTransaction(
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      sigs,
      { gasLimit: gl }
    );
    console.log('  callStatic simulation: OK');
  } catch (e: any) {
    const reason =
      e?.errorArgs?.[0] ||
      e?.error?.reason ||
      e?.error?.data ||
      e?.reason ||
      e?.data ||
      e?.message ||
      String(e);
    console.error(
      '\n❌ callStatic.execTransaction reverted — refusing to broadcast the tx.\n' +
        `   Safe revert reason: ${reason}\n\n` +
        '   Safe v1.4.1 error codes (common):\n' +
        '     GS013  — inner call returned false\n' +
        '     GS020  — signatures data too short\n' +
        '     GS025  — hash not approved by this signer\n' +
        '     GS026  — invalid owner or signatures not sorted ascending\n' +
        '   Diagnostics:\n' +
        `     safeTxHash:         ${safeTxHash}\n` +
        `     approvers (sorted): ${[...approverAddrs]
          .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1))
          .join(', ')}\n` +
        `     msg.sender (gas):   ${executor.address}\n` +
        `     to / value / op:    ${tx.to} / ${tx.value.toString()} / ${tx.operation}\n` +
        `     sigs blob:          ${sigs}\n`
    );
    throw e;
  }

  const execTx = await execTransaction(safeAsExecutor, tx, sigs, { gasLimit: gl });
  console.log(`  execTransaction tx=${execTx.hash}`);
  const receipt = await execTx.wait();
  console.log(`  status: ${receipt.status === 1 ? 'OK' : 'FAILED'}`);

  const EXEC_SUCCESS_TOPIC = utils.id('ExecutionSuccess(bytes32,uint256)');
  const EXEC_FAILURE_TOPIC = utils.id('ExecutionFailure(bytes32,uint256)');
  const safeEvent = receipt.logs.find(
    (l: any) =>
      l.address.toLowerCase() === safeAddr.toLowerCase() &&
      (l.topics[0] === EXEC_SUCCESS_TOPIC || l.topics[0] === EXEC_FAILURE_TOPIC)
  );
  const innerSucceeded = safeEvent?.topics[0] === EXEC_SUCCESS_TOPIC;
  console.log(
    `  Safe inner call: ${innerSucceeded ? '✅ ExecutionSuccess' : '❌ ExecutionFailure'} (event from Safe)`
  );

  if (!innerSucceeded) {
    throw new Error(
      'Safe emitted ExecutionFailure — outer execTransaction succeeded but the inner call returned false.'
    );
  }

  return {
    safeTxHash,
    approverAddrs,
    sigs,
    approvalTxs,
    execTx,
    receipt,
  };
};
