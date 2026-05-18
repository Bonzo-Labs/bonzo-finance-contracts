import fs from 'fs';
import path from 'path';
import { BigNumber, Wallet, providers, utils } from 'ethers';

import { ILendingPoolAddressesProvider } from '../../actions/_interfaces';
import { getAddresses } from '../../config';
import type { ChainType } from '../../types';
import type { TargetSafe } from '../../../multisig/config';
import { integrationArtifactBase } from '../config/integrationFileNames';
import type { IntegrationLogger } from '../config/integrationTooling';
import { formatIntegrationPath, writeJson } from '../config/integrationTooling';

/** Repo root: scripts/dao/integration/admin -> four parents up. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

let _repoDotenvLoaded = false;

/** Loads `.env` / `.env.local` from the repo (Hardhat cwd is not always the repo root). */
const loadRepoDotenv = (): void => {
  if (_repoDotenvLoaded) return;
  _repoDotenvLoaded = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv') as typeof import('dotenv');
  dotenv.config({ path: path.join(REPO_ROOT, '.env') });
  const localPath = path.join(REPO_ROOT, '.env.local');
  if (fs.existsSync(localPath)) {
    const parsed = dotenv.parse(fs.readFileSync(localPath));
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
};

const INTEGRATION_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(INTEGRATION_DIR, 'output');
const LOG_DIR = path.join(INTEGRATION_DIR, 'logs');
const TARGET_SAFE: TargetSafe = 'guardian';

export const ACCOUNT2_ADMIN = {
  accountId: '0.0.3642525',
  evmAddress: '0xbe058ee0884696653E01cfC6F34678f2762d84db',
};

const bipNetworkSegment = (chainType: ChainType): string =>
  chainType === 'hedera_mainnet' ? 'HEDERA-MAINNET' : 'HEDERA-TESTNET';

/**
 * EVM that may call setPoolAdmin as LendingPoolAddressesProvider owner.
 * Testnet: fixed ACCOUNT2. Mainnet: POOL_ADMIN_OWNER_EVM + PRIVATE_KEY_MAINNET.
 */
export const getDirectPoolAdminOwner = (
  chainType: ChainType
): { evmAddress: string; accountId?: string } => {
  if (chainType === 'hedera_testnet') {
    return { evmAddress: utils.getAddress(ACCOUNT2_ADMIN.evmAddress), accountId: ACCOUNT2_ADMIN.accountId };
  }
  loadRepoDotenv();
  const rawSource = process.env.POOL_ADMIN_OWNER_EVM ?? process.env.POOL_ADMIN_OWNER;
  const raw =
    typeof rawSource === 'string'
      ? rawSource.trim().replace(/^['"]+|['"]+$/g, '')
      : '';
  if (!raw || !utils.isAddress(raw)) {
    const hint =
      typeof rawSource === 'string' && rawSource.trim()
        ? ` Value is set but is not a valid EVM address (${raw.length} chars after trim).`
        : ' Variable is unset or empty after loading .env from repo root.';
    throw new Error(
      'hedera_mainnet: set POOL_ADMIN_OWNER_EVM to the EVM address that owns LendingPoolAddressesProvider ' +
        '(same key as PRIVATE_KEY_MAINNET for direct handoff).' +
        hint
    );
  }
  return { evmAddress: utils.getAddress(raw) };
};

export type PoolAdminPayload = {
  bipId: string;
  chainType: ChainType;
  accountId?: string;
  from: string;
  to: string;
  value: string;
  data: string;
  description: string;
  encodedAt: string;
};

export type PoolAdminEncodedArtifact = {
  bipId: string;
  chainType: ChainType;
  encodedAt: string;
  targetSafe: TargetSafe;
  safeAddress: string;
  integration: {
    name: string;
    note: string;
  };
  actions: {
    kind: string;
    to: string;
    value: string;
    data: string;
    description: string;
    expectedEvents: string[];
    targetSafe: TargetSafe;
  }[];
  multiSend: null;
  safeExecution: {
    to: string;
    value: string;
    data: string;
    operation: 0;
  };
};

const poolAddressesProvider = (chainType: ChainType): string =>
  utils.getAddress(getAddresses(chainType).lendingPoolAddressesProvider);

const setPoolAdminData = (admin: string): string =>
  ILendingPoolAddressesProvider.encodeFunctionData('setPoolAdmin', [utils.getAddress(admin)]);

export const buildDirectPoolAdminHandoff = (params: {
  chainType: ChainType;
  now?: Date;
  guardianSafe: string;
  outputDir?: string;
  logDir?: string;
}) => {
  const now = params.now ?? new Date();
  const { chainType } = params;
  const owner = getDirectPoolAdminOwner(chainType);
  const bipId = `INTEGRATION-${bipNetworkSegment(chainType)}-POOL-ADMIN-TO-GUARDIAN`;
  const payload: PoolAdminPayload = {
    bipId,
    chainType,
    accountId: owner.accountId,
    from: owner.evmAddress,
    to: poolAddressesProvider(chainType),
    value: '0',
    data: setPoolAdminData(params.guardianSafe),
    description: `Direct Pool Admin owner handoff: setPoolAdmin(${utils.getAddress(
      params.guardianSafe
    )})`,
    encodedAt: now.toISOString(),
  };

  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const fileBase = integrationArtifactBase('POOL-ADMIN-TO-GUARDIAN', chainType, now);
  return {
    payload,
    files: {
      payloadFile: path.join(outputDir, `${fileBase}.payload.json`),
      logFile: path.join(logDir, `${fileBase}.log`),
    },
  };
};

export const buildDirectPoolAdminReturn = (params: {
  chainType: ChainType;
  now?: Date;
  outputDir?: string;
  logDir?: string;
}) => {
  const now = params.now ?? new Date();
  const { chainType } = params;
  const owner = getDirectPoolAdminOwner(chainType);
  const bipId = `INTEGRATION-${bipNetworkSegment(chainType)}-POOL-ADMIN-BACK-TO-ACCOUNT2-DIRECT`;
  const payload: PoolAdminPayload = {
    bipId,
    chainType,
    accountId: owner.accountId,
    from: owner.evmAddress,
    to: poolAddressesProvider(chainType),
    value: '0',
    data: setPoolAdminData(owner.evmAddress),
    description: `Direct Pool Admin return: setPoolAdmin(${owner.evmAddress}) signed by AddressesProvider owner`,
    encodedAt: now.toISOString(),
  };

  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const fileBase = integrationArtifactBase('POOL-ADMIN-BACK-TO-ACCOUNT2-DIRECT', chainType, now);
  return {
    payload,
    files: {
      payloadFile: path.join(outputDir, `${fileBase}.payload.json`),
      logFile: path.join(logDir, `${fileBase}.log`),
    },
  };
};

export const buildGuardianPoolAdminReturnArtifact = (params: {
  chainType: ChainType;
  now?: Date;
  guardianSafe: string;
  outputDir?: string;
  logDir?: string;
}) => {
  const now = params.now ?? new Date();
  const { chainType } = params;
  const owner = getDirectPoolAdminOwner(chainType);
  const bipId = `INTEGRATION-${bipNetworkSegment(chainType)}-POOL-ADMIN-BACK-TO-ACCOUNT2`;
  const data = setPoolAdminData(owner.evmAddress);
  const lpp = poolAddressesProvider(chainType);
  const safeAddress = utils.getAddress(params.guardianSafe);

  const bundle = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: owner.accountId
      ? `Guardian Safe returns Pool Admin to prior owner (${owner.accountId}).`
      : `Guardian Safe returns Pool Admin to prior owner (${owner.evmAddress}).`,
    actions: [
      {
        kind: 'guardianSetPoolAdmin',
        args: {
          admin: owner.evmAddress,
          ...(owner.accountId ? { accountId: owner.accountId } : {}),
        },
      },
    ],
  };

  const encoded: PoolAdminEncodedArtifact = {
    bipId,
    chainType,
    encodedAt: now.toISOString(),
    targetSafe: TARGET_SAFE,
    safeAddress,
    integration: {
      name: 'guardianPoolAdminReturnToAccount2',
      note: 'This artifact executes LendingPoolAddressesProvider.setPoolAdmin(prior direct owner) via Guardian Safe.',
    },
    actions: [
      {
        kind: 'guardianSetPoolAdmin',
        to: lpp,
        value: '0',
        data,
        description: `setPoolAdmin(${owner.evmAddress})`,
        expectedEvents: [],
        targetSafe: TARGET_SAFE,
      },
    ],
    multiSend: null,
    safeExecution: {
      to: lpp,
      value: '0',
      data,
      operation: 0,
    },
  };

  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const fileBase = integrationArtifactBase('POOL-ADMIN-BACK-TO-ACCOUNT2', chainType, now);
  return {
    bundle,
    encoded,
    files: {
      bundleFile: path.join(outputDir, `${fileBase}.bundle.json`),
      encodedFile: path.join(outputDir, `${fileBase}.encoded.json`),
      logFile: path.join(logDir, `${fileBase}.log`),
    },
  };
};

export const preflightPoolAdmin = async (
  provider: { call: (tx: { to: string; data: string }) => Promise<string> },
  chainType: ChainType,
  expectedAdmin: string,
  expectedLabel: string
): Promise<
  | { ok: true; poolAdmin: string; expectedAdmin: string; expectedLabel: string }
  | {
      ok: false;
      poolAdmin: string;
      expectedAdmin: string;
      expectedLabel: string;
      error: string;
    }
> => {
  const ret = await provider.call({
    to: poolAddressesProvider(chainType),
    data: ILendingPoolAddressesProvider.encodeFunctionData('getPoolAdmin', []),
  });
  const [rawPoolAdmin] = ILendingPoolAddressesProvider.decodeFunctionResult('getPoolAdmin', ret);
  const poolAdmin = utils.getAddress(rawPoolAdmin);
  const expected = utils.getAddress(expectedAdmin);

  if (poolAdmin === expected) {
    return { ok: true, poolAdmin, expectedAdmin: expected, expectedLabel };
  }

  return {
    ok: false,
    poolAdmin,
    expectedAdmin: expected,
    expectedLabel,
    error:
      `Current Pool Admin is not ${expectedLabel}. ` +
      `Current Pool Admin: ${poolAdmin}; expected ${expectedLabel}: ${expected}.`,
  };
};

/** Same checks as `preflightPoolAdmin` with the return shape used by supply-cap integration. */
export const preflightGuardianPoolAdmin = async (
  provider: { call: (tx: { to: string; data: string }) => Promise<string> },
  chainType: ChainType,
  guardianSafe: string
): Promise<
  | { ok: true; poolAdmin: string; guardianSafe: string }
  | { ok: false; poolAdmin: string; guardianSafe: string; error: string }
> => {
  const r = await preflightPoolAdmin(provider, chainType, guardianSafe, 'Guardian Safe');
  if (r.ok) {
    return { ok: true, poolAdmin: r.poolAdmin, guardianSafe: r.expectedAdmin };
  }
  return {
    ok: false,
    poolAdmin: r.poolAdmin,
    guardianSafe: r.expectedAdmin,
    error:
      `Guardian Safe is not the LendingPoolConfigurator Pool Admin. ` +
      `Current Pool Admin: ${r.poolAdmin}; Guardian Safe: ${r.expectedAdmin}.`,
  };
};

export type DirectPoolAdminIntegrationDirection = 'account2-to-guardian' | 'guardian-to-account2';

export const loadAccount2IntegrationWallet = (
  provider: providers.Provider,
  chainType: ChainType
): Wallet => {
  loadRepoDotenv();
  const owner = getDirectPoolAdminOwner(chainType);
  const pk =
    chainType === 'hedera_testnet'
      ? process.env.PRIVATE_KEY2 || ''
      : process.env.PRIVATE_KEY_MAINNET || '';
  const envName = chainType === 'hedera_testnet' ? 'PRIVATE_KEY2' : 'PRIVATE_KEY_MAINNET';
  if (!pk) throw new Error(`Missing ${envName} for direct Pool Admin owner handoff on ${chainType}.`);
  const wallet = new Wallet(pk, provider);
  if (wallet.address.toLowerCase() !== owner.evmAddress.toLowerCase()) {
    throw new Error(`${envName} resolves to ${wallet.address}, expected ${owner.evmAddress}.`);
  }
  return wallet;
};

/**
 * Shared LIVE/DRY_RUN flow: write payload, assert current Pool Admin, eth_call preflight,
 * optional broadcast, assert post state. Caller sets up logger banner and context lines.
 */
export const runDirectAccount2PoolAdminIntegration = async (params: {
  logger: IntegrationLogger;
  provider: providers.Provider;
  chainType: ChainType;
  built: {
    payload: PoolAdminPayload;
    files: { payloadFile: string; logFile: string };
  };
  guardianSafe: string;
  direction: DirectPoolAdminIntegrationDirection;
}): Promise<void> => {
  const { logger, provider, built, guardianSafe, direction, chainType } = params;
  const toGuardian = direction === 'account2-to-guardian';
  const owner = getDirectPoolAdminOwner(chainType);

  const beforeExpected = toGuardian ? owner.evmAddress : guardianSafe;
  const beforeLabel = toGuardian ? 'direct Pool Admin owner' : 'Guardian Safe';
  const beforeStepDetail = toGuardian
    ? `Expecting ${owner.evmAddress}`
    : 'Expecting Guardian Safe before return';
  const beforeOkMsg = toGuardian
    ? 'Direct Pool Admin owner is current Pool Admin'
    : 'Guardian Safe is current Pool Admin';

  const preflightCallDetail = toGuardian
    ? 'eth_call setPoolAdmin from AddressesProvider owner'
    : 'eth_call setPoolAdmin from AddressesProvider owner';

  const afterExpected = toGuardian ? guardianSafe : owner.evmAddress;
  const afterLabel = toGuardian ? 'Guardian Safe' : 'direct Pool Admin owner';
  const afterOkMsg = toGuardian
    ? 'Pool Admin is now Guardian Safe'
    : 'Pool Admin is back to direct owner';

  const broadcastDetail = toGuardian
    ? `New Pool Admin: ${guardianSafe}`
    : `New Pool Admin: ${owner.evmAddress}`;

  logger.step(
    'Create JSON payload',
    `Writing payload to ${formatIntegrationPath(built.files.payloadFile)}`
  );
  writeJson(built.files.payloadFile, built.payload);
  logger.success('Payload JSON written');

  logger.step('Check current Pool Admin', beforeStepDetail);
  const admin = await preflightPoolAdmin(provider, chainType, beforeExpected, beforeLabel);
  logger.info(`Current Pool Admin: ${admin.poolAdmin}`);
  if (!admin.ok) throw new Error(admin.error);
  logger.success(beforeOkMsg);

  const wallet = loadAccount2IntegrationWallet(provider, chainType);
  logger.success(
    `Signer key resolves to Pool Admin owner EVM address ${wallet.address} (${chainType})`
  );

  logger.step('Preflight direct call', preflightCallDetail);
  await provider.call({
    from: owner.evmAddress,
    to: built.payload.to,
    data: built.payload.data,
    value: built.payload.value,
  });
  logger.success('Direct setPoolAdmin preflight passed');

  if (process.env.DRY_RUN === 'true') {
    logger.warn('Dry-run complete. Re-run without DRY_RUN=true to broadcast.');
    return;
  }

  logger.step('Send setPoolAdmin transaction', broadcastDetail);
  const tx = await wallet.sendTransaction({
    to: built.payload.to,
    data: built.payload.data,
    value: BigNumber.from(0),
    gasLimit: BigNumber.from(process.env.GAS_LIMIT || '2000000'),
  });
  logger.info(`Tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  logger.success(`Transaction mined with status ${receipt.status}`);

  const after = await preflightPoolAdmin(provider, chainType, afterExpected, afterLabel);
  logger.info(`Post Pool Admin: ${after.poolAdmin}`);
  if (!after.ok) throw new Error(after.error);
  logger.success(afterOkMsg);
  logger.info(`Log file: ${formatIntegrationPath(built.files.logFile)}`);
};

export { writeJson };
