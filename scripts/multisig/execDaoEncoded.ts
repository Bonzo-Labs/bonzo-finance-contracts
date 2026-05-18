/**
 * Load `scripts/dao/output/*.encoded.json` and execute `safeExecution` via the
 * same approveHash + execTransaction path as multisig smoke (no Safe Tx Service).
 *
 * Usage:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet TARGET_SAFE=guardian \
 *     ENCODED_JSON=scripts/dao/output/foo.hedera_testnet.encoded.json \
 *     npx hardhat run scripts/multisig/execDaoEncoded.ts --network hedera_testnet
 *
 * ⚠️ Human operator only — same execution policy as smoke scripts.
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
  TargetSafe,
  THRESHOLDS,
} from './config';
import { runPreflight } from './lib/preflight';
import { runPreApprovalsAndExec } from './lib/execWithPreApprovals';
import { buildSafeTx } from './lib/safe';

type EncodedArtifact = {
  bipId?: string;
  chainType?: string;
  targetSafe?: TargetSafe;
  safeAddress?: string;
  safeExecution?: { to: string; value: string; data: string; operation?: number };
  actions?: { to: string; value: string; data: string }[];
  multiSend?: { to: string; data: string } | null;
};

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

const parseArtifact = (raw: string): EncodedArtifact => {
  try {
    return JSON.parse(raw) as EncodedArtifact;
  } catch {
    throw new Error('ENCODED_JSON file is not valid JSON');
  }
};

const resolveSafeExecution = (artifact: EncodedArtifact) => {
  if (artifact.safeExecution) {
    const op = artifact.safeExecution.operation ?? 0;
    if (op !== 0 && op !== 1) {
      throw new Error(`safeExecution.operation must be 0 or 1 (got ${op})`);
    }
    return {
      to: artifact.safeExecution.to,
      value: artifact.safeExecution.value,
      data: artifact.safeExecution.data,
      operation: op as 0 | 1,
    };
  }
  const actions = artifact.actions;
  if (!actions?.length) {
    throw new Error('Artifact has no safeExecution and no actions[]');
  }
  if (actions.length === 1) {
    return {
      to: actions[0].to,
      value: actions[0].value,
      data: actions[0].data,
      operation: 0 as const,
    };
  }
  const ms = artifact.multiSend;
  if (!ms?.to || !ms?.data) {
    throw new Error(
      'Legacy multi-action artifact requires multiSend { to, data } or re-run dao:encode for safeExecution'
    );
  }
  return { to: ms.to, value: '0', data: ms.data, operation: 0 as const };
};

const main = async () => {
  assertNoFork();
  const chain_type = resolveChainType();
  assertNetworkConsistent(chain_type);
  const targetSafe = resolveTargetSafe();

  const encodedPath = process.env.ENCODED_JSON;
  if (!encodedPath) {
    throw new Error('Set ENCODED_JSON=<path-to-*.encoded.json> (output of npm run dao:encode)');
  }
  const abs = path.resolve(encodedPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`ENCODED_JSON not found: ${abs}`);
  }
  const artifact = parseArtifact(fs.readFileSync(abs, 'utf8'));

  if (artifact.chainType && artifact.chainType !== chain_type) {
    throw new Error(`Artifact chainType (${artifact.chainType}) !== CHAIN_TYPE (${chain_type})`);
  }
  if (!artifact.targetSafe) {
    throw new Error('Artifact missing targetSafe');
  }
  if (artifact.targetSafe !== targetSafe) {
    throw new Error(
      `TARGET_SAFE (${targetSafe}) must match artifact.targetSafe (${artifact.targetSafe})`
    );
  }

  const se = resolveSafeExecution(artifact);
  const opEnv = parseInt(process.env.SAFE_TX_OPERATION || String(se.operation), 10);
  if (opEnv !== 0 && opEnv !== 1) {
    throw new Error(`SAFE_TX_OPERATION must be 0 or 1 (got ${opEnv})`);
  }
  const operation = opEnv as 0 | 1;

  const cfgSafe = SAFE_ADDRESSES[chain_type][targetSafe];
  if (artifact.safeAddress && cfgSafe) {
    if (utils.getAddress(artifact.safeAddress) !== utils.getAddress(cfgSafe)) {
      throw new Error(
        `artifact.safeAddress (${artifact.safeAddress}) !== SAFE_ADDRESSES.${chain_type}.${targetSafe} (${cfgSafe}). ` +
          'Update scripts/multisig/config.ts (canonical SAFE_ADDRESSES).'
      );
    }
  }

  const dryRun = process.env.DRY_RUN === 'true';
  const provider = getProvider(chain_type);
  const executor = getExecutorWallet(chain_type, provider);
  const ownerKeys = keysFor(chain_type, targetSafe);
  const threshold = THRESHOLDS[chain_type][targetSafe];

  console.log(
    `\n=== multisig DAO encoded — ${dryRun ? 'DRY-RUN' : 'LIVE'} ${targetSafe} on ${chain_type} ` +
      `(${threshold}-of-${OWNERS[chain_type][targetSafe].length}) ===\n` +
      `  bipId: ${artifact.bipId ?? '(missing)'}\n` +
      `  file:  ${abs}\n`
  );

  const { safe, safeAddr } = await runPreflight({
    chain_type,
    targetSafe,
    provider,
    ownerKeys,
  });

  const nonce = await safe.nonce();
  const safeTxGasOverride = BigNumber.from(process.env.SAFE_TX_GAS || '0');
  const tx = buildSafeTx({
    to: se.to,
    value: BigNumber.from(se.value),
    data: se.data,
    operation,
    nonce,
    safeTxGas: safeTxGasOverride.gt(0) ? safeTxGasOverride : undefined,
  });
  if (safeTxGasOverride.gt(0)) {
    console.warn(
      `\n⚠️  SAFE_TX_GAS=${safeTxGasOverride.toString()} — diagnostic mode (inner failures may not revert the outer tx).\n`
    );
  }

  const approverWallets = ownerKeys.slice(0, threshold).map((pk) => new Wallet(pk, provider));
  const approverAddrs = approverWallets.map((w) => w.address);
  console.log(
    `Planned approvers (${approverWallets.length}/${threshold}):\n  - ${approverAddrs.join('\n  - ')}`
  );

  const gasLimit = BigNumber.from(process.env.GAS_LIMIT || '0').gt(0)
    ? BigNumber.from(process.env.GAS_LIMIT)
    : undefined;

  const dryRunExecSummary = `safe.execTransaction(${tx.to}, ${tx.value.toString()}, <data ${tx.data.length} chars>, ${tx.operation}, …)`;

  const result = await runPreApprovalsAndExec({
    safe,
    safeAddr,
    tx,
    approverWallets,
    threshold,
    executor,
    dryRun,
    gasLimit,
    dryRunExecSummary,
  });

  if (dryRun) {
    return;
  }

  const nonceAfter = await safe.nonce();
  if (!nonceAfter.eq(nonce.add(1))) {
    throw new Error(`Safe nonce did not increment: ${nonce.toString()} → ${nonceAfter.toString()}`);
  }

  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const slug = artifact.bipId || path.basename(abs, '.json');
  const outPath = path.join(outDir, `dao-encoded.${chain_type}.${targetSafe}.${slug}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        chainType: chain_type,
        targetSafe,
        bipId: artifact.bipId,
        encodedJsonPath: abs,
        threshold,
        safe: safeAddr,
        safeTxHash: result.safeTxHash,
        approvals: result.approvalTxs,
        executionTxId: result.execTx?.hash,
        executedAt: new Date().toISOString(),
        safeExecution: { ...se, operation },
        nonceBefore: nonce.toString(),
        nonceAfter: nonceAfter.toString(),
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
