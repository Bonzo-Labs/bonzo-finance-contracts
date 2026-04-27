/**
 * Load a bundle JSON, validate against schema, route each action through the
 * registry, and emit a paste-ready block for the Safe UI + a MultiSend-encoded
 * single payload for batched bundles.
 *
 * Usage:
 *   CHAIN_TYPE=hedera_testnet BUNDLE=scripts/dao/fixtures/bundles/smoke-reserve-factor.json \
 *     npx hardhat run scripts/dao/encode.ts --network hedera_testnet
 */
import fs from 'fs';
import path from 'path';
import { utils } from 'ethers';
require('dotenv').config();

import { resolveChainType, getAddresses, assertNoFork, assertNetworkConsistent } from './config';
import { loadBundle } from './schema/validate';
import { encodeMultiSend } from './lib/multiSend';
import { asStdoutBlock, asSafeUiBlock } from './lib/formatter';
import { buildBundle } from './lib/buildBundle';
import type { BuildContext, EncodedAction } from './types';

const main = async () => {
  assertNoFork();
  const chain_type = resolveChainType();
  assertNetworkConsistent(chain_type);
  const addresses = getAddresses(chain_type);
  const ctx: BuildContext = { chain_type, addresses };

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json> in env');
  const abs = path.resolve(bundlePath);
  const bundle = loadBundle(abs);

  const actions: EncodedAction[] = buildBundle(bundle, ctx);

  console.log(`\n=== Encoded bundle ${bundle.bipId} (${chain_type}) ===\n`);
  console.log(asStdoutBlock(actions));

  const multiSendPayload =
    actions.length > 1 && addresses.multiSendCallOnly
      ? { to: addresses.multiSendCallOnly, data: encodeMultiSend(actions).data }
      : null;

  if (actions.length > 1) {
    const needsMultiSend = !addresses.multiSendCallOnly;
    if (needsMultiSend) {
      console.log(
        '\n[!] Bundle has multiple actions but MULTI_SEND_ADDRESSES is empty in scripts/dao/config.ts.'
      );
      console.log(
        '    Paste each action individually via the Safe UI, or populate MULTI_SEND_ADDRESSES to use a single MultiSend tx.'
      );
    } else if (multiSendPayload) {
      console.log('\n=== MultiSend payload ===');
      console.log(`  to:   ${multiSendPayload.to}`);
      console.log(`  data: ${multiSendPayload.data}`);
    }
  }

  console.log('\n=== Safe UI copy-paste block ===');
  console.log(asSafeUiBlock(actions));

  const rawSafeAddr =
    bundle.targetSafe === 'executor' ? addresses.executorSafe : addresses.guardianSafe;
  const safeAddress = rawSafeAddr ? utils.getAddress(rawSafeAddr) : '';

  let safeExecution: {
    to: string;
    value: string;
    data: string;
    operation: number;
  } | null = null;
  if (actions.length === 1) {
    safeExecution = {
      to: utils.getAddress(actions[0].to),
      value: actions[0].value,
      data: actions[0].data,
      operation: 0,
    };
  } else if (multiSendPayload) {
    safeExecution = {
      to: utils.getAddress(multiSendPayload.to),
      value: '0',
      data: multiSendPayload.data,
      operation: 0,
    };
  }

  // Write artifact
  const outDir = path.resolve(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const artifact = {
    bipId: bundle.bipId,
    chainType: chain_type,
    encodedAt: new Date().toISOString(),
    targetSafe: bundle.targetSafe,
    safeAddress,
    actions,
    multiSend: multiSendPayload,
    safeExecution,
  };
  const outPath = path.join(outDir, `${bundle.bipId}.${chain_type}.encoded.json`);
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));
  console.log(`\nWrote ${outPath}`);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
