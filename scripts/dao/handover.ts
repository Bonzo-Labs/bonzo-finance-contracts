/**
 * One-time admin handover EOA → Safes.
 *  setPoolAdmin(daoExecutorSafe) → setEmergencyAdmin(guardianSafe) → transferOwnership(daoExecutorSafe)
 *
 * Dry-run by default (DRY_RUN=true or EXECUTE=false). Set EXECUTE=true to send.
 */
import { Contract } from 'ethers';
require('dotenv').config();

import { assertNoFork, getRuntime } from './config';
import { ILendingPoolAddressesProvider } from './actions/_interfaces';
import { assertAddress } from './actions/_helpers';

const main = async () => {
  assertNoFork();
  const { chain_type, provider, owner, addresses } = getRuntime();
  const execute = process.env.EXECUTE === 'true' && process.env.DRY_RUN !== 'true';

  const executorSafe = assertAddress('executorSafe', addresses.executorSafe);
  const guardianSafe = assertAddress('guardianSafe', addresses.guardianSafe);

  const ap = new Contract(
    addresses.lendingPoolAddressesProvider,
    ILendingPoolAddressesProvider,
    execute ? owner : provider
  );

  const before = {
    poolAdmin: await ap.getPoolAdmin(),
    emergencyAdmin: await ap.getEmergencyAdmin(),
    owner: await ap.owner(),
  };

  console.log(`\n=== handover (${chain_type}) ${execute ? 'EXECUTE' : 'DRY-RUN'} ===\n`);
  console.log('Current state:');
  console.log(`  poolAdmin:      ${before.poolAdmin}`);
  console.log(`  emergencyAdmin: ${before.emergencyAdmin}`);
  console.log(`  owner:          ${before.owner}`);
  console.log(`\nPlanned:`);
  console.log(`  setPoolAdmin(${executorSafe})`);
  console.log(`  setEmergencyAdmin(${guardianSafe})`);
  console.log(`  transferOwnership(${executorSafe})`);

  if (!execute) {
    console.log('\nDry-run — set EXECUTE=true to send transactions. Exiting.\n');
    return;
  }

  console.log('\nSending setPoolAdmin...');
  const t1 = await ap.setPoolAdmin(executorSafe, { gasLimit: 2_000_000 });
  await t1.wait();
  console.log(`  tx: ${t1.hash}`);

  console.log('Sending setEmergencyAdmin...');
  const t2 = await ap.setEmergencyAdmin(guardianSafe, { gasLimit: 2_000_000 });
  await t2.wait();
  console.log(`  tx: ${t2.hash}`);

  console.log('Sending transferOwnership...');
  const t3 = await ap.transferOwnership(executorSafe, { gasLimit: 2_000_000 });
  await t3.wait();
  console.log(`  tx: ${t3.hash}`);

  const after = {
    poolAdmin: await ap.getPoolAdmin(),
    emergencyAdmin: await ap.getEmergencyAdmin(),
    owner: await ap.owner(),
  };

  console.log('\nPost-execution state:');
  console.log(`  poolAdmin:      ${after.poolAdmin}`);
  console.log(`  emergencyAdmin: ${after.emergencyAdmin}`);
  console.log(`  owner:          ${after.owner}`);

  if (after.poolAdmin.toLowerCase() !== executorSafe.toLowerCase()) {
    throw new Error(`poolAdmin != executorSafe after handover`);
  }
  if (after.emergencyAdmin.toLowerCase() !== guardianSafe.toLowerCase()) {
    throw new Error(`emergencyAdmin != guardianSafe after handover`);
  }
  if (after.owner.toLowerCase() !== executorSafe.toLowerCase()) {
    throw new Error(`owner != executorSafe after handover`);
  }
  console.log('\nhandover: OK\n');
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
