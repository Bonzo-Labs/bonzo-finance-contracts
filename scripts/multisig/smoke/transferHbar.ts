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
import { runPreApprovalsAndExec } from '../lib/execWithPreApprovals';
import { buildValueTransferTx } from '../lib/safe';

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
  // Resolve approver wallets
  const approverWallets = ownerKeys.slice(0, threshold).map((pk) => new Wallet(pk, provider));
  const approverAddrs = approverWallets.map((w) => w.address);
  console.log(
    `Planned approvers (${approverWallets.length}/${threshold}):\n  - ${approverAddrs.join('\n  - ')}`
  );

  const gasLimit = BigNumber.from(process.env.GAS_LIMIT || '0').gt(0)
    ? BigNumber.from(process.env.GAS_LIMIT)
    : undefined;

  let safeTxHash: string;
  let approvalTxs: { owner: string; txHash: string }[] = [];
  let execTx: { hash: string } | null = null;

  try {
    const result = await runPreApprovalsAndExec({
      safe,
      safeAddr,
      tx,
      approverWallets,
      threshold,
      executor,
      dryRun,
      gasLimit,
      dryRunExecSummary: `safe.execTransaction(${receiverAddr}, ${amount.toString()}, 0x, 0, 0, 0, 0, 0x0, 0x0, <sigs>)`,
    });
    safeTxHash = result.safeTxHash;
    approvalTxs = result.approvalTxs;
    execTx = result.execTx;
  } catch (e: any) {
    const reason =
      e?.errorArgs?.[0] ||
      e?.error?.reason ||
      e?.error?.data ||
      e?.reason ||
      e?.data ||
      e?.message ||
      String(e);
    const reasonStr = String(reason);
    if (reasonStr === 'GS013' || reasonStr.includes('GS013')) {
      console.error(
        '   GS013 (HBAR smoke): inner CALL returned false. On Hedera, common causes:\n' +
          `     1. Unit mismatch — value must be tinybar (1 HBAR = 1e8): ${amount.toString()} tinybar (${utils.formatUnits(amount, 8)} HBAR).\n` +
          `     2. receiver_sig_required: ${mirrorBase}/api/v1/accounts/${receiverAddr.toLowerCase()}\n` +
          '     3. Safe funded via Hedera-native CryptoTransfer — re-fund via plain EVM tx.\n' +
          '     4. Receiver contract receive()/fallback reverts.\n'
      );
    }
    throw e;
  }

  if (dryRun) {
    return;
  }

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
        executionTxId: execTx!.hash,
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
