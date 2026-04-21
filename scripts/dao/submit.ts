/**
 * Optional SDK-based submission via @safe-global/protocol-kit + api-kit.
 * Guarded behind SUBMIT=true — otherwise prints a Safe UI instruction block.
 *
 * Safety invariants (all enforced before any network call):
 *   - bundle.targetSafe must equal each action's defaultTargetSafe. Cross-safe
 *     bundles (e.g. guardian-only action routed to executor Safe) are rejected
 *     here via buildBundle, not only at preflight.
 *   - Action `target` overrides are honored (also via buildBundle).
 *   - When SUBMIT=true, the script must actually submit. It will NOT silently
 *     log "Submitting …" and exit — either the adapter submits, or the script
 *     exits non-zero so operators never see a successful command with no
 *     transaction in the Safe Tx Service.
 */
import path from 'path';
require('dotenv').config();

import { assertNoFork, getRuntime } from './config';
import { loadBundle } from './schema/validate';
import { encodeMultiSend } from './lib/multiSend';
import { asSafeUiBlock } from './lib/formatter';
import { buildBundle } from './lib/buildBundle';

const main = async () => {
  assertNoFork();
  const { chain_type, provider, owner, addresses } = getRuntime();

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json>');
  const bundle = loadBundle(path.resolve(bundlePath));
  const safe =
    bundle.targetSafe === 'executor' ? addresses.executorSafe : addresses.guardianSafe;
  if (!safe) throw new Error(`No ${bundle.targetSafe} Safe configured for ${chain_type}`);

  // buildBundle enforces cross-safe routing AND honors target overrides.
  const actions = buildBundle(bundle, { chain_type, addresses });

  if (process.env.SUBMIT !== 'true') {
    console.log(
      `\n[submit] SUBMIT=true not set — printing Safe UI instructions only.\n` +
        `Paste each action via multisig.hedera.foundation "Contract interaction":\n`
    );
    console.log(asSafeUiBlock(actions));
    return;
  }

  const serviceUrl = process.env.SAFE_TX_SERVICE_URL;
  if (!serviceUrl) {
    console.log(
      `\n[submit] SAFE_TX_SERVICE_URL not set.\n` +
        `Confirm the Hedera Safe Tx Service URL with Palmera, then re-run with SAFE_TX_SERVICE_URL=<url>.\n` +
        `Falling back to Safe UI paste block:\n`
    );
    console.log(asSafeUiBlock(actions));
    return;
  }

  // The exact wiring to the Hedera Safe Tx Service is pending confirmation
  // with Palmera (see docs/bonzo-dao-execution-layer-prd.md §5.6). Until it
  // lands, SUBMIT=true + service URL must NOT silently claim success. Refuse
  // the run with a clear error so operators never see a successful command
  // with no proposal in the Safe Tx Service.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@safe-global/protocol-kit');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@safe-global/api-kit');
  } catch (e) {
    throw new Error(
      '[submit] SUBMIT=true but @safe-global/protocol-kit / @safe-global/api-kit not installed. ' +
        'Install with `npm i @safe-global/protocol-kit @safe-global/api-kit`, or unset SUBMIT and use the Safe UI paste block.'
    );
  }

  if (actions.length > 1 && !addresses.multiSendCallOnly) {
    throw new Error(
      'submit.ts: multi-action bundle requires MULTI_SEND_ADDRESSES in scripts/dao/config.ts'
    );
  }
  const payload =
    actions.length === 1
      ? { to: actions[0].to, value: actions[0].value, data: actions[0].data }
      : { to: addresses.multiSendCallOnly, value: '0', data: encodeMultiSend(actions).data };
  console.log(
    `\n[submit] Prepared payload for Safe ${safe} via ${serviceUrl}:\n` +
      `  to:    ${payload.to}\n` +
      `  value: ${payload.value}\n` +
      `  data:  ${payload.data}\n`
  );
  void provider;
  void owner;
  throw new Error(
    '[submit] Hedera Safe Tx Service adapter not yet validated. Refusing to claim submission without actually submitting. ' +
      'Re-run without SUBMIT=true to use the Safe UI paste block, or wire the protocol-kit adapter before using SUBMIT=true.'
  );
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
