/**
 * Pool Admin return: Guardian Safe -> ACCOUNT2 (direct, no multisig).
 *
 * Why direct (not via Guardian multisig):
 *   LendingPoolAddressesProvider.setPoolAdmin(...) is gated by `onlyOwner`,
 *   not by `getPoolAdmin()`. ACCOUNT2 is still the AddressesProvider owner
 *   (we only handed off the Pool Admin role, not ownership), so ACCOUNT2 can
 *   directly call setPoolAdmin(ACCOUNT2) to take the role back.
 *
 *   A Guardian-multisig path would require first calling
 *   AddressesProvider.transferOwnership(GuardianSafe), which is intentionally
 *   out of scope for this integration test — see passPoolAdminToGuardian.ts
 *   for the inverse direct flow.
 *
 * Dry-run:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
 *
 * Live:
 *   CHAIN_TYPE=hedera_testnet npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
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
  buildDirectPoolAdminReturn,
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

  const built = buildDirectPoolAdminReturn({});
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner('Bonzo DAO Integration: Pool Admin Back → ACCOUNT2 (direct)');
    logger.info(`Network: ${chainType}`);
    logger.info(`Current expected Pool Admin: Guardian Safe ${guardianSafe}`);
    logger.info(`Return account: ${ACCOUNT2_ADMIN.accountId}`);
    logger.info(`Return EVM: ${ACCOUNT2_ADMIN.evmAddress}`);
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
      direction: 'guardian-to-account2',
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
