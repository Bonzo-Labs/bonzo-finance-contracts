/**
 * Asserts:
 *  - chain id matches CHAIN_TYPE
 *  - hre.network.name matches CHAIN_TYPE (handled by config)
 *  - Safe address exists for bundle.targetSafe
 *  - Safe threshold + owner set are non-empty
 *  - current poolAdmin (executor bundle) or emergencyAdmin (guardian bundle)
 *    matches the intended Safe
 *  - every governed target address is valid
 */
import { Contract } from 'ethers';
import path from 'path';
require('dotenv').config();

import {
  assertNetworkConsistent,
  assertNoFork,
  CHAIN_IDS,
  getAddresses,
  resolveChainType,
  getRuntime,
} from './config';
import { loadBundle } from './schema/validate';
import { getAction } from './actions/_registry';
import {
  IGnosisSafe,
  ILendingPoolAddressesProvider,
} from './actions/_interfaces';
import { assertAddress } from './actions/_helpers';

const check = (label: string, ok: boolean, detail = '') => {
  const status = ok ? '✅' : '❌';
  console.log(`${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`preflight failed: ${label} ${detail}`);
};

const main = async () => {
  assertNoFork();
  const chain_type = resolveChainType();
  assertNetworkConsistent(chain_type);
  const { provider } = getRuntime();
  const addresses = getAddresses(chain_type);

  const bundlePath = process.env.BUNDLE;
  if (!bundlePath) throw new Error('Set BUNDLE=<path-to-bundle.json>');
  const bundle = loadBundle(path.resolve(bundlePath));

  console.log(`\n=== preflight: ${bundle.bipId} → ${bundle.targetSafe} Safe (${chain_type}) ===\n`);

  const net = await provider.getNetwork();
  check('chainId matches', net.chainId === CHAIN_IDS[chain_type], `expected ${CHAIN_IDS[chain_type]}, got ${net.chainId}`);

  const safeAddr = bundle.targetSafe === 'executor' ? addresses.executorSafe : addresses.guardianSafe;
  check(`${bundle.targetSafe} Safe address is set`, !!safeAddr, safeAddr);

  const safe = new Contract(safeAddr, IGnosisSafe, provider);
  const threshold = (await safe.getThreshold()).toNumber();
  check('Safe threshold > 0', threshold > 0, `threshold=${threshold}`);

  const owners: string[] = await safe.getOwners();
  check('Safe owners non-empty', owners.length > 0, `owners=${owners.length}`);

  const ap = new Contract(addresses.lendingPoolAddressesProvider, ILendingPoolAddressesProvider, provider);
  if (bundle.targetSafe === 'executor') {
    const poolAdmin = await ap.getPoolAdmin();
    check(
      'poolAdmin == executor Safe',
      poolAdmin.toLowerCase() === safeAddr.toLowerCase(),
      `on-chain poolAdmin=${poolAdmin}`
    );
  } else {
    const emergencyAdmin = await ap.getEmergencyAdmin();
    check(
      'emergencyAdmin == guardian Safe',
      emergencyAdmin.toLowerCase() === safeAddr.toLowerCase(),
      `on-chain emergencyAdmin=${emergencyAdmin}`
    );
  }

  // Each action's target must be a valid address.
  for (let i = 0; i < bundle.actions.length; i++) {
    const a = bundle.actions[i];
    const mod = getAction(a.kind);
    const enc = mod.build(a.args as any, { chain_type, addresses });
    assertAddress(`actions[${i}].to`, enc.to);
    check(
      `actions[${i}] targetSafe matches bundle`,
      enc.targetSafe === bundle.targetSafe,
      `${enc.kind}: ${enc.targetSafe} vs bundle ${bundle.targetSafe}`
    );
  }

  console.log('\npreflight: OK\n');
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
