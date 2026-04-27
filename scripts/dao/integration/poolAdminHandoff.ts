import fs from 'fs';
import path from 'path';
import { utils } from 'ethers';

import reserveData from '../../outputReserveData.json';
import { ILendingPoolAddressesProvider } from '../actions/_interfaces';
import type { TargetSafe } from '../../multisig/config';

const INTEGRATION_DIR = __dirname;
const OUTPUT_DIR = path.join(INTEGRATION_DIR, 'output');
const LOG_DIR = path.join(INTEGRATION_DIR, 'logs');
const CHAIN_TYPE = 'hedera_testnet';
const TARGET_SAFE: TargetSafe = 'guardian';

export const ACCOUNT2_ADMIN = {
  accountId: '0.0.3642525',
  evmAddress: '0xbe058ee0884696653E01cfC6F34678f2762d84db',
};

export type PoolAdminPayload = {
  bipId: string;
  chainType: typeof CHAIN_TYPE;
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
  chainType: typeof CHAIN_TYPE;
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

const pad = (n: number): string => String(n).padStart(2, '0');

const timestampSlug = (now: Date): string =>
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
    now.getUTCHours()
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

const addressesProvider = (): string =>
  utils.getAddress((reserveData as any).LendingPoolAddressesProvider.hedera_testnet.address);

const setPoolAdminData = (admin: string): string =>
  ILendingPoolAddressesProvider.encodeFunctionData('setPoolAdmin', [utils.getAddress(admin)]);

export const buildDirectPoolAdminHandoff = (params: {
  now?: Date;
  guardianSafe: string;
  outputDir?: string;
  logDir?: string;
}) => {
  const now = params.now ?? new Date();
  const bipId = 'INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-TO-GUARDIAN';
  const payload: PoolAdminPayload = {
    bipId,
    chainType: CHAIN_TYPE,
    accountId: ACCOUNT2_ADMIN.accountId,
    from: ACCOUNT2_ADMIN.evmAddress,
    to: addressesProvider(),
    value: '0',
    data: setPoolAdminData(params.guardianSafe),
    description: `Direct ACCOUNT2 Pool Admin handoff: setPoolAdmin(${utils.getAddress(
      params.guardianSafe
    )})`,
    encodedAt: now.toISOString(),
  };

  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  return {
    payload,
    files: {
      payloadFile: path.join(outputDir, `${bipId}.payload.json`),
      logFile: path.join(logDir, `${bipId}.${timestampSlug(now)}.log`),
    },
  };
};

export const buildGuardianPoolAdminReturnArtifact = (params: {
  now?: Date;
  guardianSafe: string;
  outputDir?: string;
  logDir?: string;
}) => {
  const now = params.now ?? new Date();
  const bipId = 'INTEGRATION-HEDERA-TESTNET-POOL-ADMIN-BACK-TO-ACCOUNT2';
  const data = setPoolAdminData(ACCOUNT2_ADMIN.evmAddress);
  const provider = addressesProvider();
  const safeAddress = utils.getAddress(params.guardianSafe);

  const bundle = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: `Guardian Safe returns Pool Admin to ACCOUNT2 (${ACCOUNT2_ADMIN.accountId}).`,
    actions: [
      {
        kind: 'guardianSetPoolAdmin',
        args: { admin: ACCOUNT2_ADMIN.evmAddress, accountId: ACCOUNT2_ADMIN.accountId },
      },
    ],
  };

  const encoded: PoolAdminEncodedArtifact = {
    bipId,
    chainType: CHAIN_TYPE,
    encodedAt: now.toISOString(),
    targetSafe: TARGET_SAFE,
    safeAddress,
    integration: {
      name: 'guardianPoolAdminReturnToAccount2',
      note: 'This artifact executes LendingPoolAddressesProvider.setPoolAdmin(ACCOUNT2) via Guardian Safe.',
    },
    actions: [
      {
        kind: 'guardianSetPoolAdmin',
        to: provider,
        value: '0',
        data,
        description: `setPoolAdmin(${ACCOUNT2_ADMIN.evmAddress})`,
        expectedEvents: [],
        targetSafe: TARGET_SAFE,
      },
    ],
    multiSend: null,
    safeExecution: {
      to: provider,
      value: '0',
      data,
      operation: 0,
    },
  };

  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  return {
    bundle,
    encoded,
    files: {
      bundleFile: path.join(outputDir, `${bipId}.bundle.json`),
      encodedFile: path.join(outputDir, `${bipId}.${CHAIN_TYPE}.encoded.json`),
      logFile: path.join(logDir, `${bipId}.${timestampSlug(now)}.log`),
    },
  };
};

export const preflightPoolAdmin = async (
  provider: { call: (tx: { to: string; data: string }) => Promise<string> },
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
    to: addressesProvider(),
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

export const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
