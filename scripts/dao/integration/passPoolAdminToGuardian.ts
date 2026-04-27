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
import { BigNumber, Wallet } from 'ethers';
require('dotenv').config();

import { assertNoFork, assertNetworkConsistent, getProvider, resolveChainType, SAFE_ADDRESSES } from '../../multisig/config';
import { createIntegrationLogger, formatIntegrationPath } from './sauceSupplyCapToOneMillion';
import {
  ACCOUNT2_ADMIN,
  buildDirectPoolAdminHandoff,
  preflightPoolAdmin,
  writeJson,
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
    logger.info(`Mode: ${process.env.DRY_RUN === 'true' ? 'DRY_RUN=true (no tx broadcast)' : 'LIVE (will send setPoolAdmin)'}`);

    logger.step('Create JSON payload', `Writing payload to ${formatIntegrationPath(built.files.payloadFile)}`);
    writeJson(built.files.payloadFile, built.payload);
    logger.success('Payload JSON written');

    const provider = getProvider(chainType);
    logger.step('Check current Pool Admin', `Expecting ${ACCOUNT2_ADMIN.evmAddress}`);
    const admin = await preflightPoolAdmin(provider, ACCOUNT2_ADMIN.evmAddress, 'ACCOUNT2');
    logger.info(`Current Pool Admin: ${admin.poolAdmin}`);
    if (!admin.ok) throw new Error(admin.error);
    logger.success('ACCOUNT2 is current Pool Admin');

    const pk = process.env.PRIVATE_KEY2 || '';
    if (!pk) throw new Error('Missing PRIVATE_KEY2 for ACCOUNT2 admin handoff.');
    const wallet = new Wallet(pk, provider);
    if (wallet.address.toLowerCase() !== ACCOUNT2_ADMIN.evmAddress.toLowerCase()) {
      throw new Error(
        `PRIVATE_KEY2 resolves to ${wallet.address}, expected ${ACCOUNT2_ADMIN.evmAddress}.`
      );
    }
    logger.success(`PRIVATE_KEY2 resolves to ACCOUNT2 EVM address ${wallet.address}`);

    logger.step('Preflight direct call', 'eth_call setPoolAdmin from ACCOUNT2');
    await provider.call({
      from: ACCOUNT2_ADMIN.evmAddress,
      to: built.payload.to,
      data: built.payload.data,
      value: built.payload.value,
    });
    logger.success('Direct setPoolAdmin preflight passed');

    if (process.env.DRY_RUN === 'true') {
      logger.warn('Dry-run complete. Re-run without DRY_RUN=true to broadcast.');
      return;
    }

    logger.step('Send setPoolAdmin transaction', `New Pool Admin: ${guardianSafe}`);
    const tx = await wallet.sendTransaction({
      to: built.payload.to,
      data: built.payload.data,
      value: BigNumber.from(0),
      gasLimit: BigNumber.from(process.env.GAS_LIMIT || '2000000'),
    });
    logger.info(`Tx hash: ${tx.hash}`);
    const receipt = await tx.wait();
    logger.success(`Transaction mined with status ${receipt.status}`);

    const after = await preflightPoolAdmin(provider, guardianSafe, 'Guardian Safe');
    logger.info(`Post Pool Admin: ${after.poolAdmin}`);
    if (!after.ok) throw new Error(after.error);
    logger.success('Pool Admin is now Guardian Safe');
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
