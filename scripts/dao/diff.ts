/**
 * Calls each action's preview() and pretty-prints before/after for operator review.
 * Read-only. Uses live RPC but never sends a transaction.
 */
import path from 'path';
require('dotenv').config();

import { assertNoFork, getRuntime } from './config';
import { loadBundle } from './schema/validate';
import { getAction } from './actions/_registry';
import { diffTable } from './lib/formatter';

const main = async () => {
  assertNoFork();
  const { chain_type, provider, addresses } = getRuntime();

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json>');
  const bundle = loadBundle(path.resolve(bundlePath));

  console.log(`\n=== diff: ${bundle.bipId} (${chain_type}) ===\n`);
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i];
    const mod = getAction(a.kind);
    console.log(`--- actions[${i}] ${a.kind}`);
    try {
      const preview = await mod.preview(provider, a.args, { chain_type, addresses });
      console.log(diffTable(preview.before, preview.after));
    } catch (e: any) {
      console.log(`  preview unavailable: ${e.message || e}`);
    }
    console.log();
  }
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
