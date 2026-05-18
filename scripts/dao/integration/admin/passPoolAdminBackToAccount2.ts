/**
 * Pool Admin return: Guardian Safe -> prior direct owner (ACCOUNT2 on testnet).
 *
 * Why direct (not via Guardian multisig):
 *   LendingPoolAddressesProvider.setPoolAdmin(...) is gated by `onlyOwner`,
 *   not by `getPoolAdmin()`. The AddressesProvider owner can directly call
 *   setPoolAdmin(...) to take the role back from Guardian.
 *
 *   A Guardian-multisig path would require first calling
 *   AddressesProvider.transferOwnership(GuardianSafe), which is intentionally
 *   out of scope for this integration test — see passPoolAdminToGuardian.ts
 *   for the inverse direct flow.
 *
 * Network selection matches `scripts/supra-prices.ts`: `resolveHederaNetwork(hre)` uses
 * Hardhat `--network` when not `hardhat`, else `CHAIN_TYPE` (default `hedera_testnet`).
 * Guardian Safe is `SAFE_ADDRESSES[chain].guardian` from `scripts/multisig/config.ts`.
 *
 * Testnet: owner is ACCOUNT2 (`PRIVATE_KEY2`). Mainnet: set `POOL_ADMIN_OWNER_EVM` and
 * `PRIVATE_KEY_MAINNET` (see poolAdminHandoff.ts).
 *
 * Dry-run:
 *   DRY_RUN=true npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
 *
 * Live:
 *   npm run dao:integration:pool-admin-back-to-account2 -- --network hedera_testnet
 *
 * Required env (testnet):
 *   PRIVATE_KEY2  private key for ACCOUNT_ID2 / 0xbe058ee...
 */
require('dotenv').config();

import hre from 'hardhat';
import { resolveHederaNetwork } from '../../../lib/resolveHederaNetwork';
import {
  assertNoFork,
  assertNetworkConsistent,
  getProvider,
  SAFE_ADDRESSES,
} from '../../../multisig/config';
import { createIntegrationLogger } from '../config/integrationTooling';
import {
  buildDirectPoolAdminReturn,
  getDirectPoolAdminOwner,
  runDirectAccount2PoolAdminIntegration,
} from './poolAdminHandoff';

const main = async () => {
  assertNoFork();
  const chain_type = resolveHederaNetwork(hre);
  assertNetworkConsistent(chain_type);

  let guardianSafe: string;
  if (chain_type === 'hedera_testnet') {
    guardianSafe = SAFE_ADDRESSES.hedera_testnet.guardian;
  } else if (chain_type === 'hedera_mainnet') {
    guardianSafe = SAFE_ADDRESSES.hedera_mainnet.guardian;
  } else {
    throw new Error(
      `Unsupported chain_type: ${chain_type}. Must be 'hedera_testnet' or 'hedera_mainnet'.`
    );
  }
  if (!guardianSafe) throw new Error(`Missing SAFE_ADDRESSES.${chain_type}.guardian`);

  const built = buildDirectPoolAdminReturn({ chainType: chain_type });
  const logger = createIntegrationLogger(built.files.logFile);
  const owner = getDirectPoolAdminOwner(chain_type);

  try {
    logger.banner('Bonzo DAO Integration: Pool Admin Back → direct owner (ACCOUNT2 on testnet)');
    logger.info(`Network: ${chain_type}`);
    logger.info(`Current expected Pool Admin: Guardian Safe ${guardianSafe}`);
    if (owner.accountId) {
      logger.info(`Return account: ${owner.accountId}`);
    }
    logger.info(`Return EVM: ${owner.evmAddress}`);
    logger.info(
      `Mode: ${
        process.env.DRY_RUN === 'true'
          ? 'DRY_RUN=true (no tx broadcast)'
          : 'LIVE (will send setPoolAdmin)'
      }`
    );

    const provider = getProvider(chain_type);
    await runDirectAccount2PoolAdminIntegration({
      logger,
      provider,
      chainType: chain_type,
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
