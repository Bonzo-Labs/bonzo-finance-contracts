/**
 * End-to-end multisig smoke test — HBAR transfer.
 *
 * Exercises a Palmera-deployed Gnosis Safe v1.4.1 by sending a real HBAR
 * transfer from the Safe to a signer EOA. Works for both thresholds:
 *   TARGET_SAFE=guardian  → 2-of-3
 *   TARGET_SAFE=executor  → 3-of-5
 *
 * Flow (all on-chain, no EIP-712 off-chain signing):
 *   1. Build tx { to=receiver, value=amount, data=0x, op=0, ... }
 *   2. Compute safeTxHash = safe.getTransactionHash(...)
 *   3. For each of `threshold` owner keys: safe.approveHash(safeTxHash)
 *   4. Build pre-approved signature blob (sorted ascending by address)
 *   5. safe.execTransaction(..., signatures) signed by any gas-paying account
 *   6. Assert balances moved
 *
 * Usage:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet TARGET_SAFE=guardian \
 *     npx hardhat run scripts/multisig/smoke/transferHbar.ts --network hedera_testnet
 *
 *   CHAIN_TYPE=hedera_testnet TARGET_SAFE=executor \
 *     npx hardhat run scripts/multisig/smoke/transferHbar.ts --network hedera_testnet
 *
 * ⚠️ Execution policy: the AI assistant does NOT run this script. Human operator only.
 */
import fs from 'fs';
import path from 'path';
import { BigNumber, utils, Wallet } from 'ethers';
require('dotenv').config();

import {
  assertNoFork,
  assertNetworkConsistent,
  ChainType,
  getExecutorWallet,
  getProvider,
  OWNERS,
  resolveChainType,
  resolveTargetSafe,
  SAFE_ADDRESSES,
  SMOKE_TRANSFER,
  TargetSafe,
  THRESHOLDS,
} from '../config';
import { runPreflight } from '../lib/preflight';
import {
  buildPreApprovedSignatures,
  buildValueTransferTx,
  computeTxHash,
  execTransaction,
} from '../lib/safe';

// Owner private keys are read from the environment, NOT from this file.
// This keeps secrets out of git diffs and honours the repo-wide "never commit
// private keys" rule.
//
// Required env vars (only the first `threshold` of each list need to be set):
//   Testnet executor (3-of-5):   EXECUTOR_OWNER_KEY_1 … EXECUTOR_OWNER_KEY_5
//   Testnet guardian (2-of-3):   GUARDIAN_OWNER_KEY_1 … GUARDIAN_OWNER_KEY_3
//   Mainnet executor:            EXECUTOR_OWNER_KEY_MAINNET_1 … _5
//   Mainnet guardian:            GUARDIAN_OWNER_KEY_MAINNET_1 … _3
//
// See .env.example for the full list. Any key that doesn't resolve to an
// on-chain owner fails preflight before a transaction is sent.
const envKey = (base: string, idx: number, mainnet: boolean): string =>
  process.env[mainnet ? `${base}_MAINNET_${idx}` : `${base}_${idx}`] || '';

const keysFor = (chain_type: ChainType, target: TargetSafe): string[] => {
  const mainnet = chain_type === 'hedera_mainnet';
  const base = target === 'executor' ? 'EXECUTOR_OWNER_KEY' : 'GUARDIAN_OWNER_KEY';
  const len = target === 'executor' ? 5 : 3;
  const keys: string[] = [];
  for (let i = 1; i <= len; i++) {
    const k = envKey(base, i, mainnet);
    if (k) keys.push(k);
  }
  return keys;
};

const main = async () => {
  assertNoFork();
  const chain_type = resolveChainType();
  assertNetworkConsistent(chain_type);
  const targetSafe = resolveTargetSafe();

  const dryRun = process.env.DRY_RUN === 'true';
  const provider = getProvider(chain_type);
  const executor = getExecutorWallet(chain_type, provider);

  const ownerKeys = keysFor(chain_type, targetSafe);
  const threshold = THRESHOLDS[chain_type][targetSafe];

  console.log(
    `\n=== multisig smoke — ${dryRun ? 'DRY-RUN' : 'LIVE'} ` +
      `${targetSafe} Safe on ${chain_type} (${threshold}-of-${OWNERS[chain_type][targetSafe].length}) ===\n`
  );

  const { safe, safeAddr } = await runPreflight({
    chain_type,
    targetSafe,
    provider,
    ownerKeys,
  });

  // Target + amount
  const { receiver, amountTinybar } = SMOKE_TRANSFER[chain_type];
  if (!receiver) {
    throw new Error(
      `SMOKE_TRANSFER.${chain_type}.receiver is empty. Fill it in scripts/multisig/config.ts.`
    );
  }
  const receiverAddr = utils.getAddress(receiver);
  // AMOUNT_TINYBAR env override, lets operators run `AMOUNT_TINYBAR=0 ...` without
  // editing config.ts — useful for isolating "Safe flow works" vs "HBAR
  // transfer to this receiver works". Units are tinybar (1 HBAR = 1e8), same
  // as the SMOKE_TRANSFER config value — see scripts/multisig/config.ts.
  const amount = BigNumber.from(process.env.AMOUNT_TINYBAR || amountTinybar);
  // SAFE_TX_GAS env override. When > 0, Safe does NOT require the inner call
  // to succeed — failures surface as `status=1` with event `ExecutionFailure`
  // instead of GS013. Diagnostic only; leave unset for real smoke runs.
  const safeTxGasOverride = BigNumber.from(process.env.SAFE_TX_GAS || '0');

  // Hedera unit bridge. getBalance returns weibar (18-dec) for JSON-RPC
  // compatibility, but `amount` above is tinybar (8-dec) because that's what
  // Safe's inner CALL opcode consumes. Convert the Safe balance to tinybar
  // so the comparison below is apples-to-apples; display HBAR using each
  // value's native scale.
  const WEIBAR_PER_TINYBAR = BigNumber.from(10).pow(10);
  const safeBalBefore = await provider.getBalance(safeAddr);
  const safeBalBeforeTinybar = safeBalBefore.div(WEIBAR_PER_TINYBAR);
  const receiverBalBefore = await provider.getBalance(receiverAddr);
  console.log(
    `\nSafe balance: ${utils.formatEther(safeBalBefore)} HBAR (${safeAddr})`
  );
  console.log(`Receiver balance: ${utils.formatEther(receiverBalBefore)} HBAR (${receiverAddr})`);
  console.log(`Transfer amount: ${utils.formatUnits(amount, 8)} HBAR (${amount.toString()} tinybar)`);
  if (safeBalBeforeTinybar.lt(amount)) {
    throw new Error(
      `Safe balance (${utils.formatEther(safeBalBefore)} HBAR = ${safeBalBeforeTinybar.toString()} tinybar) ` +
        `is less than transfer amount (${utils.formatUnits(amount, 8)} HBAR = ${amount.toString()} tinybar). ` +
        `Fund the Safe. Note: Hedera's EVM uses tinybar (8 decimals), not wei (18 decimals), for CALL value — ` +
        `if you recently changed SMOKE_TRANSFER, make sure you used parseUnits(x, 8), not parseEther(x).`
    );
  }

  // Receiver sanity — a contract receiver may reject the transfer, causing
  // the Safe's inner call to return false and revert with GS013. HBAR
  // transfers can also fail if the Hedera account behind the address has
  // `receiver_sig_required=true`. Print diagnostics before anything signs.
  const receiverCode = await provider.getCode(receiverAddr);
  if (receiverCode && receiverCode !== '0x') {
    console.warn(
      `\n⚠️  Receiver ${receiverAddr} is a CONTRACT (code size ${(receiverCode.length - 2) / 2} bytes).\n` +
        `    If its receive()/fallback() reverts on plain-value calls, Safe will revert with GS013.\n`
    );
  }
  if (receiverAddr.toLowerCase() === safeAddr.toLowerCase()) {
    console.warn(
      `\n⚠️  Receiver equals the Safe address — this is a self-transfer. Unusual; double-check SMOKE_TRANSFER.receiver.\n`
    );
  }
  const mirrorBase =
    chain_type === 'hedera_mainnet'
      ? 'https://mainnet-public.mirrornode.hedera.com'
      : 'https://testnet.mirrornode.hedera.com';
  console.log(
    `\nNote: if execTransaction reverts with GS013, check Hedera mirror node for receiver_sig_required\n` +
      `  ${mirrorBase}/api/v1/accounts/${receiverAddr.toLowerCase()}\n` +
      `  If receiver_sig_required=true, contract-initiated HBAR transfers to this account always fail.\n`
  );

  // Build tx + hash
  const nonce = await safe.nonce();
  const tx = buildValueTransferTx(receiverAddr, amount, nonce);
  if (safeTxGasOverride.gt(0)) {
    tx.safeTxGas = safeTxGasOverride;
    console.warn(
      `\n⚠️  SAFE_TX_GAS=${safeTxGasOverride.toString()} — diagnostic mode. Inner-call failures will NOT revert with GS013; they will surface as an ExecutionFailure event with status=1. Use this to decouple signature/auth issues from value-transfer issues.\n`
    );
  }
  const safeTxHash = await computeTxHash(safe, tx);
  console.log(`\nSafe nonce: ${nonce.toString()}`);
  console.log(`safeTxHash: ${safeTxHash}`);

  // Resolve approver wallets
  const approverWallets = ownerKeys.slice(0, threshold).map((pk) => new Wallet(pk, provider));
  const approverAddrs = approverWallets.map((w) => w.address);
  console.log(
    `Planned approvers (${approverWallets.length}/${threshold}):\n  - ${approverAddrs.join('\n  - ')}`
  );

  if (dryRun) {
    const sigsPreview = buildPreApprovedSignatures(approverAddrs);
    console.log(`\n[DRY-RUN] Planned signature blob (${sigsPreview.length / 2 - 1} bytes):`);
    console.log(`  ${sigsPreview}`);
    console.log(`\n[DRY-RUN] Planned call:`);
    console.log(`  safe.execTransaction(${receiverAddr}, ${amount.toString()}, 0x, 0, 0, 0, 0, 0x0, 0x0, <sigs>)`);
    console.log(`\n[DRY-RUN] Exiting without sending transactions.\n`);
    return;
  }

  // Collect approveHash on-chain
  console.log('\nCollecting on-chain approvals...');
  const approvalTxs: { owner: string; txHash: string }[] = [];
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

  // Re-check approvals meet threshold
  let count = 0;
  for (const w of approverWallets) {
    const v = await safe.approvedHashes(w.address, safeTxHash);
    if (v.toNumber() === 1) count++;
  }
  if (count < threshold) {
    throw new Error(`Only ${count}/${threshold} approvals on-chain after approveHash loop`);
  }
  console.log(`  approvals: ${count}/${threshold} ✅`);

  // Execute
  console.log('\nExecuting transaction...');
  const sigs = buildPreApprovedSignatures(approverAddrs);
  const safeAsExecutor = safe.connect(executor);

  // Simulate first via callStatic so any Safe revert code (GS0xx) is decoded
  // and surfaced BEFORE we spend gas on a failing transaction.
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
      { gasLimit: 2_000_000 }
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
        '     GS013  — inner call returned false (receiver rejected HBAR, OR\n' +
        '              Hedera receiver_sig_required=true, OR receiver is a\n' +
        '              contract whose receive/fallback reverts)\n' +
        '     GS020  — signatures data too short\n' +
        '     GS025  — hash not approved by this signer (msg.sender mismatch?)\n' +
        '     GS026  — invalid owner or signatures not sorted ascending\n' +
        '   Diagnostics:\n' +
        `     safeTxHash:        ${safeTxHash}\n` +
        `     approvers (sorted): ${[...approverAddrs].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)).join(', ')}\n` +
        `     msg.sender (gas):  ${executor.address}\n` +
        `     receiver:          ${receiverAddr}\n` +
        `     amountTinybar:     ${amount.toString()} (${utils.formatUnits(amount, 8)} HBAR)\n` +
        `     sigs blob:         ${sigs}\n`
    );
    if (reason === 'GS013') {
      console.error(
        '   GS013 means the inner CALL returned false. On Hedera, the most\n' +
          '   likely causes, in order:\n' +
          `     1. Unit mismatch. Hedera EVM CALL value is in tinybar (1 HBAR = 1e8), NOT 18-dec wei.\n` +
          `        Current amount: ${amount.toString()} tinybar (${utils.formatUnits(amount, 8)} HBAR).\n` +
          `        If this looks ~1e10 too large, you likely used parseEther instead of parseUnits(x, 8)\n` +
          `        in scripts/multisig/config.ts SMOKE_TRANSFER.\n` +
          `     2. Receiver has receiver_sig_required=true on mainnet:\n` +
          `        ${mirrorBase}/api/v1/accounts/${receiverAddr.toLowerCase()}\n` +
          `        If true, pick a different receiver or clear the flag via HashPack.\n` +
          '     3. Safe HBAR was credited via a Hedera-native CryptoTransfer (HashPack, exchange withdrawal).\n' +
          '        The balance shows up but EVM CALL cannot spend it. Re-fund the Safe via a plain EVM tx.\n' +
          '     4. Receiver is a contract whose receive()/fallback() reverts.\n'
      );
    }
    throw e;
  }

  const execTx = await execTransaction(safeAsExecutor, tx, sigs);
  console.log(`  execTransaction tx=${execTx.hash}`);
  const receipt = await execTx.wait();
  console.log(`  status: ${receipt.status === 1 ? 'OK' : 'FAILED'}`);

  // Look for Safe's ExecutionSuccess / ExecutionFailure events. When
  // safeTxGas > 0, the Safe does NOT revert on inner-call failure — it just
  // emits ExecutionFailure and the outer tx reports status=1. Surface this
  // so operators never mistake "outer tx ok" for "value actually moved".
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

  // Assertions. Note the unit bridge: getBalance returns weibar (18-dec) but
  // `amount` is tinybar (8-dec). Convert the Safe delta to tinybar for the
  // outflow check below, otherwise the assertion would always fail.
  const safeBalAfter = await provider.getBalance(safeAddr);
  const receiverBalAfter = await provider.getBalance(receiverAddr);
  const nonceAfter = await safe.nonce();
  const safeDelta = safeBalBefore.sub(safeBalAfter); // positive = outflow, in weibar
  const safeDeltaTinybar = safeDelta.div(WEIBAR_PER_TINYBAR);

  console.log(
    `\nSafe balance after: ${utils.formatEther(safeBalAfter)} HBAR (Δ -${utils.formatEther(safeDelta)})`
  );
  console.log(
    `Receiver balance after: ${utils.formatEther(receiverBalAfter)} HBAR (Δ ${utils.formatEther(
      receiverBalAfter.sub(receiverBalBefore)
    )})`
  );
  console.log(`Safe nonce after: ${nonceAfter.toString()}`);

  if (!nonceAfter.eq(nonce.add(1))) {
    throw new Error(`Safe nonce did not increment: ${nonce.toString()} → ${nonceAfter.toString()}`);
  }
  if (!innerSucceeded) {
    throw new Error(
      'Safe emitted ExecutionFailure — the outer execTransaction succeeded but the inner call returned false. ' +
        'Common Hedera causes:\n' +
        '  1. Unit mismatch: `value` arg is wei-scaled (1e18) instead of tinybar-scaled (1e8). ' +
        'Safe forwards value verbatim to CALL, which on Hedera EVM expects tinybar. ' +
        'Check that SMOKE_TRANSFER uses parseUnits(x, 8), not parseEther(x).\n' +
        '  2. Bucket: Safe was funded via a Hedera-native CryptoTransfer (e.g. HashPack). ' +
        'Re-fund via a plain EVM transaction (send HBAR to the Safe from an EOA using Hardhat / MetaMask) and retry.\n' +
        '  3. Receiver has receiver_sig_required=true on the Hedera mirror node.'
    );
  }
  // Check Safe's outflow directly — independent of gas costs on the receiver
  // side (receiver may also be a signer paying for approveHash). Compared in
  // tinybar because `amount` is tinybar; `safeDelta` is weibar from getBalance.
  if (!safeDeltaTinybar.eq(amount)) {
    throw new Error(
      `Safe balance delta (-${safeDeltaTinybar.toString()} tinybar) != expected amount (-${amount.toString()} tinybar). ` +
        'Value transfer did not execute as intended.'
    );
  }

  // Write artifact
  const outDir = path.resolve(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `transfer-hbar.${chain_type}.${targetSafe}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        chainType: chain_type,
        targetSafe,
        threshold,
        safe: safeAddr,
        receiver: receiverAddr,
        amountTinybar: amount.toString(),
        safeTxHash,
        approvals: approvalTxs,
        executionTxId: execTx.hash,
        executedAt: new Date().toISOString(),
        before: {
          safeBalance: safeBalBefore.toString(),
          receiverBalance: receiverBalBefore.toString(),
          nonce: nonce.toString(),
        },
        after: {
          safeBalance: safeBalAfter.toString(),
          receiverBalance: receiverBalAfter.toString(),
          nonce: nonceAfter.toString(),
        },
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);
  console.log(
    `\nNext: re-run with TARGET_SAFE=${targetSafe === 'guardian' ? 'executor' : 'guardian'} to exercise the other threshold.\n`
  );
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
