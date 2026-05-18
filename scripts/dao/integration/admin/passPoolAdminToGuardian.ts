/**
 * Pool Admin handoff: AddressesProvider owner (ACCOUNT2 on testnet) -> Guardian Safe.
 *
 * This changes LendingPoolAddressesProvider.getPoolAdmin(), which is the admin
 * checked by LendingPoolConfigurator for setSupplyCap and similar writes.
 *
 * Network selection matches `scripts/supra-prices.ts`: `resolveHederaNetwork(hre)` uses
 * Hardhat `--network` when not `hardhat`, else `CHAIN_TYPE` (default `hedera_testnet`).
 * Guardian Safe is `SAFE_ADDRESSES[chain].guardian` from `scripts/multisig/config.ts`.
 *
 * Testnet: owner is ACCOUNT2 (`PRIVATE_KEY2`). Mainnet: set `POOL_ADMIN_OWNER_EVM` and
 * `PRIVATE_KEY_MAINNET` to the LendingPoolAddressesProvider owner (see poolAdminHandoff.ts).
 *
 * Dry-run:
 *   DRY_RUN=true npm run dao:integration:pool-admin-to-guardian -- --network hedera_mainnet
 *
 * Live:
 *   npm run dao:integration:pool-admin-to-guardian -- --network hedera_testnet
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
  buildDirectPoolAdminHandoff,
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

  const built = buildDirectPoolAdminHandoff({ chainType: chain_type, guardianSafe });
  const logger = createIntegrationLogger(built.files.logFile);
  const owner = getDirectPoolAdminOwner(chain_type);

  try {
    logger.banner('Bonzo DAO Integration: Pool Admin → Guardian Safe');
    logger.info(`Network: ${chain_type}`);
    if (owner.accountId) {
      logger.info(`Current admin account: ${owner.accountId}`);
    }
    logger.info(`Current admin EVM: ${owner.evmAddress}`);
    logger.info(`Guardian Safe: ${guardianSafe}`);
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
