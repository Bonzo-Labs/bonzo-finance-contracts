/**
 * Post-execution verification. Takes a bundle + Hedera tx IDs, calls each
 * action's verify() against live state, and emits the markdown report from
 * docs/bonzo-dao-prd.md §2.11.
 *
 * Usage:
 *   CHAIN_TYPE=hedera_testnet BUNDLE=bundle.json TX_IDS="0.0.X@1,0.0.X@2" \
 *     npx hardhat run scripts/dao/verify.ts --network hedera_testnet
 */
import fs from 'fs';
import path from 'path';
require('dotenv').config();

import { assertNoFork, getRuntime } from './config';
import { loadBundle } from './schema/validate';
import { getAction } from './actions/_registry';
import { hashscanLink } from './lib/formatter';

const main = async () => {
  assertNoFork();
  const { chain_type, provider, addresses } = getRuntime();

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json>');
  const bundle = loadBundle(path.resolve(bundlePath));
  const txIds = (process.env.TX_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

  const rows: string[] = [];
  let allOk = true;
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i];
    const mod = getAction(a.kind);
    let ok = false;
    let err: string | null = null;
    try {
      ok = await mod.verify(provider, a.args, { chain_type, addresses });
    } catch (e: any) {
      err = e.message || String(e);
    }
    if (!ok) allOk = false;
    rows.push(
      `| ${i} | ${a.kind} | ${ok ? '✅' : '❌'} | ${
        err || mod.build(a.args as any, { chain_type, addresses }).description
      } |`
    );
  }

  const safeAddr = bundle.targetSafe === 'executor' ? addresses.executorSafe : addresses.guardianSafe;
  const lines: string[] = [
    `## ${allOk ? '✅' : '❌'} Execution Report — ${bundle.bipId}`,
    '',
    `**Chain:** ${chain_type}`,
    `**Executed by:** ${bundle.targetSafe} (${safeAddr})`,
    `**Hedera TX IDs:** ${txIds.length ? txIds.join(' | ') : '(none supplied)'}`,
    `**HashScan links:** ${txIds.map((t) => hashscanLink(chain_type, t)).join(' | ') || '(none)'}`,
    `**Decoded actions confirmed:** ${allOk ? 'YES' : 'NO'}`,
    '',
    '| # | action | verified | detail |',
    '| - | ------ | -------- | ------ |',
    ...rows,
    '',
  ];

  const report = lines.join('\n');
  console.log('\n' + report);

  const outDir = path.resolve(__dirname, 'fixtures/testnet-reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${bundle.bipId}.${chain_type}.report.md`);
  fs.writeFileSync(outPath, report);
  console.log(`Wrote ${outPath}`);

  if (!allOk) process.exit(1);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
