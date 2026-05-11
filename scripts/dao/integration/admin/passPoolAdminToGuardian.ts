/**
 * Pool Admin handoff: ACCOUNT2 / PRIVATE_KEY2 -> Guardian Safe.
 *
 * This changes LendingPoolAddressesProvider.getPoolAdmin(), which is the admin
 * checked by LendingPoolConfigurator for setSupplyCap and similar writes.
 *
 * Dry-run:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-to-guardian -- --network hedera_testnet
 *
 * Live:
 *   CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-to-guardian -- --network hedera_testnet
 *
 * Required env:
 *   PRIVATE_KEY2  private key for ACCOUNT_ID2 / 0xbe058ee...
 */
require('dotenv').config();

import {
  assertNoFork,
  assertNetworkConsistent,
  getProvider,
  resolveChainType,
  SAFE_ADDRESSES,
} from '../../../multisig/config';
import { createIntegrationLogger } from '../config/integrationTooling';
import {
  ACCOUNT2_ADMIN,
  buildDirectPoolAdminHandoff,
  runDirectAccount2PoolAdminIntegration,
} from './poolAdminHandoff';

const main = async () => {
  assertNoFork();
  const chainType = resolveChainType();
  assertNetworkConsistent(chainType);
  if (chainType !== 'hedera_testnet') {
    throw new Error(`This integration is testnet-only. Got CHAIN_TYPE=${chainType}.`);
  }

  const guardianSafe = SAFE_ADDRESSES[chainType].guardian;
  if (!guardianSafe) throw new Error(`Missing SAFE_ADDRESSES.${chainType}.guardian`);

  const built = buildDirectPoolAdminHandoff({ guardianSafe });
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner('Bonzo DAO Integration: Pool Admin → Guardian Safe');
    logger.info(`Network: ${chainType}`);
    logger.info(`Current admin account: ${ACCOUNT2_ADMIN.accountId}`);
    logger.info(`Current admin EVM: ${ACCOUNT2_ADMIN.evmAddress}`);
    logger.info(`Guardian Safe: ${guardianSafe}`);
    logger.info(
      `Mode: ${
        process.env.DRY_RUN === 'true'
          ? 'DRY_RUN=true (no tx broadcast)'
          : 'LIVE (will send setPoolAdmin)'
      }`
    );

    const provider = getProvider(chainType);
    await runDirectAccount2PoolAdminIntegration({
      logger,
      provider,
      built,
      guardianSafe,
      direction: 'account2-to-guardian',
    });
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
