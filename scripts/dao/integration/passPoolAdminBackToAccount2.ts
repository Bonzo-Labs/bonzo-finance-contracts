/**
 * Pool Admin return: Guardian Safe -> ACCOUNT2.
 *
 * This creates a Guardian Safe encoded artifact for
 * LendingPoolAddressesProvider.setPoolAdmin(ACCOUNT2_EVM), then calls the
 * existing multisig executor to collect 2-of-3 approvals and execute it.
 *
 * Dry-run:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
 *
 * Live:
 *   CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
 *
 * Required env:
 *   PRIVATE_KEY or PRIVATE_KEY2          gas-paying wallet
 *   GUARDIAN_OWNER_KEY_1..3             at least 2 Guardian owner keys
 */
import { spawnSync } from 'child_process';
import path from 'path';
require('dotenv').config();

import { assertNoFork, assertNetworkConsistent, getProvider, resolveChainType, SAFE_ADDRESSES } from '../../multisig/config';
import {
  buildMultisigExecCommand,
  createIntegrationLogger,
  formatIntegrationPath,
  preflightSafeExecution,
} from './sauceSupplyCapToOneMillion';
import {
  ACCOUNT2_ADMIN,
  buildGuardianPoolAdminReturnArtifact,
  preflightPoolAdmin,
  writeJson,
} from './poolAdminHandoff';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const sanitizeChildOutput = (value: string): string => value.split(REPO_ROOT + path.sep).join('');

const main = async () => {
  assertNoFork();
  const chainType = resolveChainType();
  assertNetworkConsistent(chainType);
  if (chainType !== 'hedera_testnet') {
    throw new Error(`This integration is testnet-only. Got CHAIN_TYPE=${chainType}.`);
  }

  const guardianSafe = SAFE_ADDRESSES[chainType].guardian;
  if (!guardianSafe) throw new Error(`Missing SAFE_ADDRESSES.${chainType}.guardian`);

  const built = buildGuardianPoolAdminReturnArtifact({ guardianSafe });
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner('Bonzo DAO Integration: Pool Admin Back → ACCOUNT2');
    logger.info(`Network: ${chainType}`);
    logger.info(`Guardian Safe: ${guardianSafe}`);
    logger.info(`Return account: ${ACCOUNT2_ADMIN.accountId}`);
    logger.info(`Return EVM: ${ACCOUNT2_ADMIN.evmAddress}`);
    logger.info(`Mode: ${process.env.DRY_RUN === 'true' ? 'DRY_RUN=true (no tx broadcast)' : 'LIVE (will send approvals + exec)'}`);

    logger.step('Create JSON payload', `Writing bundle to ${formatIntegrationPath(built.files.bundleFile)}`);
    writeJson(built.files.bundleFile, built.bundle);
    logger.success('Bundle JSON written');

    logger.step('Encode Safe execution', `Writing artifact to ${formatIntegrationPath(built.files.encodedFile)}`);
    writeJson(built.files.encodedFile, built.encoded);
    logger.success('Encoded Safe execution artifact written');

    const provider = getProvider(chainType);
    logger.step('Check current Pool Admin', 'Expecting Guardian Safe before return');
    const admin = await preflightPoolAdmin(provider, guardianSafe, 'Guardian Safe');
    logger.info(`Current Pool Admin: ${admin.poolAdmin}`);
    if (!admin.ok) throw new Error(admin.error);
    logger.success('Guardian Safe is current Pool Admin');

    logger.step('Preflight Safe execution', 'eth_call from Guardian Safe');
    const preflight = await preflightSafeExecution(provider, built.encoded as any);
    if (!preflight.ok) throw new Error(`safeExecution preflight failed: ${preflight.error}`);
    logger.success('Safe execution preflight passed');

    logger.step('Launch multisig executor', 'Collecting Guardian approvals and executing return');
    const command = buildMultisigExecCommand();
    const result = spawnSync(command.bin, command.args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CHAIN_TYPE: chainType,
        TARGET_SAFE: 'guardian',
        ENCODED_JSON: built.files.encodedFile,
      },
    });

    const stdout = sanitizeChildOutput(result.stdout?.toString('utf8') || '');
    const stderr = sanitizeChildOutput(result.stderr?.toString('utf8') || '');
    if (stdout.trim()) {
      logger.raw('');
      logger.raw('📤 multisig stdout');
      logger.raw(stdout.trimEnd());
    }
    if (stderr.trim()) {
      logger.raw('');
      logger.raw('📥 multisig stderr');
      logger.raw(stderr.trimEnd());
    }
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`multisig executor exited with status ${result.status}`);

    if (process.env.DRY_RUN !== 'true') {
      const after = await preflightPoolAdmin(provider, ACCOUNT2_ADMIN.evmAddress, 'ACCOUNT2');
      logger.info(`Post Pool Admin: ${after.poolAdmin}`);
      if (!after.ok) throw new Error(after.error);
      logger.success('Pool Admin is back to ACCOUNT2');
    }

    logger.success('Integration script finished');
    logger.info(`Log file: ${formatIntegrationPath(built.files.logFile)}`);
  } catch (e: any) {
    logger.error(e?.message || String(e));
    throw e;
  } finally {
    logger.close();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
