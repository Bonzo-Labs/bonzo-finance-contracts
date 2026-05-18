/**
 * Live-RPC dry-run — no fork, no impersonation.
 *
 * For each action, runs `provider.call({ from: safeAddress, to, data })`
 * against the live Hedera testnet/mainnet RPC. The Safe is the `from` so the
 * authorization check passes (Hashio honours the from-override). When the RPC
 * rejects the override, falls back to callStatic under the current signer.
 *
 * Per §9.4.7: asserts hre.network.name is hedera_testnet or hedera_mainnet and
 * forbids any Hardhat-local RPC (hardhat_impersonateAccount etc).
 */
import fs from 'fs';
import path from 'path';
require('dotenv').config();

import { assertNoFork, getRuntime } from './config';
import { loadBundle } from './schema/validate';
import { getAction } from './actions/_registry';
import { diffTable } from './lib/formatter';
import type { EncodedAction } from './types';

const simulateOne = async (
  provider: any,
  safe: string,
  action: EncodedAction
): Promise<{ ok: boolean; ret?: string; error?: string }> => {
  try {
    const ret = await provider.call({ from: safe, to: action.to, data: action.data });
    return { ok: true, ret };
  } catch (e: any) {
    const msg = e?.error?.message || e?.data?.message || e?.reason || e?.message || String(e);
    return { ok: false, error: msg };
  }
};

const main = async () => {
  assertNoFork();
  const { chain_type, provider, addresses } = getRuntime();

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json>');
  const bundle = loadBundle(path.resolve(bundlePath));

  const safe =
    bundle.targetSafe === 'executor' ? addresses.executorSafe : addresses.guardianSafe;
  if (!safe) {
    throw new Error(
      `No ${bundle.targetSafe} Safe address configured for ${chain_type}. Fill SAFE_ADDRESSES in scripts/multisig/config.ts (re-exported from scripts/dao/config.ts).`
    );
  }

  console.log(`\n=== simulate: ${bundle.bipId} (${chain_type}) — from ${safe} ===\n`);

  const logDir = path.resolve(__dirname, 'fixtures/simulation-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log: any = {
    bipId: bundle.bipId,
    chainType: chain_type,
    safe,
    simulatedAt: new Date().toISOString(),
    actions: [] as any[],
  };

  let failed = false;
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i];
    const mod = getAction(a.kind);
    const enc = mod.build(a.args as any, { chain_type, addresses });
    console.log(`--- actions[${i}] ${a.kind}`);
    const result = await simulateOne(provider, safe, enc);
    if (!result.ok) {
      console.log(`  ❌ eth_call reverted: ${result.error}`);
      failed = true;
    } else {
      console.log(`  ✅ eth_call ok; return=${result.ret ?? '0x'}`);
    }

    let previewErr: string | undefined;
    let preview;
    try {
      preview = await mod.preview(provider, a.args, { chain_type, addresses });
      console.log(diffTable(preview.before, preview.after));
    } catch (e: any) {
      previewErr = e.message || String(e);
      console.log(`  preview unavailable: ${previewErr}`);
    }
    log.actions.push({
      index: i,
      kind: a.kind,
      to: enc.to,
      data: enc.data,
      call: result,
      preview: preview || null,
      previewError: previewErr || null,
    });
    console.log();
  }

  const outPath = path.join(logDir, `${bundle.bipId}.${chain_type}.sim.json`);
  fs.writeFileSync(outPath, JSON.stringify(log, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (failed) process.exit(1);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
