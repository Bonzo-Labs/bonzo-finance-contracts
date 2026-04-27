/**
 * Vertical integration: set a Hedera testnet reserve supply cap via the Guardian Safe.
 *
 * Before running, edit SUPPLY_CAP_INTEGRATION_CONFIG below. This mirrors
 * scripts/supplyBorrowCaps.ts: pick the reserve from outputReserveData.json and
 * set the supply cap number manually in the script.
 *
 * Run from repo root:
 *   CHAIN_TYPE=hedera_testnet npm run dao:integration:sauce-supply-cap -- --network hedera_testnet
 *
 * Dry-run without sending approval/execution transactions:
 *   DRY_RUN=true CHAIN_TYPE=hedera_testnet npm run dao:integration:sauce-supply-cap -- --network hedera_testnet
 *
 * End-to-end Guardian multisig smoke mode: still writes JSON/log artifacts, but
 * executes a plain 0.1 HBAR Guardian Safe transfer instead of the supply-cap call.
 *   GUARDIAN_HBAR_SMOKE=true CHAIN_TYPE=hedera_testnet npm run dao:integration:sauce-supply-cap -- --network hedera_testnet
 *
 * Required live-run env:
 *   PRIVATE_KEY or PRIVATE_KEY2          gas-paying wallet
 *   GUARDIAN_OWNER_KEY_1..3             at least 2 keys matching scripts/multisig/config.ts
 *
 * This script intentionally routes this integration through the Guardian Safe
 * even though the general DAO registry treats setSupplyCap as an executor action.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { utils } from 'ethers';
require('dotenv').config();

import reserveData from '../../outputReserveData.json';
import { ILendingPoolAddressesProvider } from '../actions/_interfaces';
import setSupplyCap from '../actions/setSupplyCap';
import { assertNetworkConsistent } from '../config';
import type { Bundle, BuildContext, EncodedAction } from '../types';
import {
  getProvider,
  SAFE_ADDRESSES as MULTISIG_SAFE_ADDRESSES,
  resolveChainType,
  TargetSafe,
} from '../../multisig/config';

const INTEGRATION_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_DIR = path.join(INTEGRATION_DIR, 'output');
const LOG_DIR = path.join(INTEGRATION_DIR, 'logs');
const TARGET_SAFE: TargetSafe = 'guardian';
const MAX_VALID_SUPPLY_CAP = 68_719_476_735;

export type SupplyCapIntegrationConfig = {
  chainType: 'hedera_testnet';
  reserveSymbol: string;
  supplyCap: number;
};

// === Manual operator config ==================================================
// Change these values before running, the same way scripts/supplyBorrowCaps.ts
// changes `reserves` and `supplyCaps`.
export const SUPPLY_CAP_INTEGRATION_CONFIG: SupplyCapIntegrationConfig = {
  chainType: 'hedera_testnet' as const,
  reserveSymbol: 'SAUCE',
  supplyCap: 1_000_000,
};

export const GUARDIAN_HBAR_SMOKE_CONFIG = {
  enabled: process.env.GUARDIAN_HBAR_SMOKE === 'true',
  receiver: '0xbe058ee0884696653e01cfc6f34678f2762d84db',
  amountTinybar: '10000000', // 0.1 HBAR. Safe value args on Hedera use tinybar, not wei.
};
// =============================================================================

type GuardianHbarSmokePayload = {
  bipId: string;
  targetSafe: TargetSafe;
  description: string;
  actions: {
    kind: 'guardianHbarTransferSmoke';
    args: {
      receiver: string;
      amountTinybar: string;
    };
  }[];
};

type IntegrationEncodedAction = Omit<EncodedAction, 'kind'> & { kind: string };

export type IntegrationEncodedArtifact = {
  bipId: string;
  chainType: string;
  encodedAt: string;
  targetSafe: TargetSafe;
  safeAddress: string;
  integration: {
    name: string;
    symbol: string;
    forcedGuardianSafe: true;
    note: string;
  };
  actions: IntegrationEncodedAction[];
  multiSend: null;
  safeExecution: {
    to: string;
    value: string;
    data: string;
    operation: 0;
  };
};

export type IntegrationBuildResult = {
  bundle: Bundle | GuardianHbarSmokePayload;
  encoded: IntegrationEncodedArtifact;
  files: {
    bundleFile: string;
    encodedFile: string;
    logFile: string;
  };
};

export type IntegrationLogger = {
  banner(message: string): void;
  step(title: string, detail?: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  raw(message: string): void;
  close(): void;
};

const pad = (n: number): string => String(n).padStart(2, '0');

const timestampSlug = (now: Date): string =>
  `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
    now.getUTCHours()
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

const capSlug = (cap: number): string => (cap % 1_000_000 === 0 ? `${cap / 1_000_000}M` : String(cap));

const integrationBipId = (config: SupplyCapIntegrationConfig): string =>
  `INTEGRATION-HEDERA-TESTNET-${config.reserveSymbol.toUpperCase()}-SUPPLY-CAP-${capSlug(config.supplyCap)}`;

const HBAR_SMOKE_BIP_ID = 'INTEGRATION-HEDERA-TESTNET-GUARDIAN-HBAR-SMOKE';

const resolveReserveTokenAddress = (config: SupplyCapIntegrationConfig): string => {
  const symbol = config.reserveSymbol.toUpperCase();
  const asset = (reserveData as any)[symbol]?.[config.chainType]?.token?.address;
  if (!asset || !utils.isAddress(asset)) {
    throw new Error(
      `Missing ${symbol}.${config.chainType}.token.address in scripts/outputReserveData.json`
    );
  }
  return asset;
};

const assertSupplyCapConfig = (config: SupplyCapIntegrationConfig): void => {
  if (config.chainType !== 'hedera_testnet') {
    throw new Error(`This integration is testnet-only. Got chainType=${config.chainType}.`);
  }
  if (!config.reserveSymbol.trim()) {
    throw new Error('SUPPLY_CAP_INTEGRATION_CONFIG.reserveSymbol must be set.');
  }
  if (!Number.isInteger(config.supplyCap) || config.supplyCap < 0) {
    throw new Error('SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap must be a non-negative integer.');
  }
  if (config.supplyCap > MAX_VALID_SUPPLY_CAP) {
    throw new Error(
      `SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap exceeds MAX_VALID_SUPPLY_CAP=${MAX_VALID_SUPPLY_CAP}.`
    );
  }
};

export const formatIntegrationPath = (file: string): string =>
  path.relative(REPO_ROOT, file).split(path.sep).join('/');

export const buildMultisigExecCommand = (): { bin: string; args: string[] } => ({
  bin: 'npx',
  args: ['ts-node', '--transpile-only', 'scripts/multisig/execDaoEncoded.ts'],
});

export const preflightSafeExecution = async (
  provider: { call: (tx: { from: string; to: string; data: string; value: string }) => Promise<string> },
  artifact: IntegrationEncodedArtifact
): Promise<{ ok: true; ret: string } | { ok: false; error: string }> => {
  try {
    const ret = await provider.call({
      from: artifact.safeAddress,
      to: artifact.safeExecution.to,
      data: artifact.safeExecution.data,
      value: artifact.safeExecution.value,
    });
    return { ok: true, ret };
  } catch (e: any) {
    const error = e?.errorArgs?.[0] || e?.error?.reason || e?.error?.message || e?.reason || e?.message || String(e);
    return { ok: false, error: String(error) };
  }
};

export const preflightGuardianPoolAdmin = async (
  provider: { call: (tx: { to: string; data: string }) => Promise<string> },
  guardianSafe: string
): Promise<
  | { ok: true; poolAdmin: string; guardianSafe: string }
  | { ok: false; poolAdmin: string; guardianSafe: string; error: string }
> => {
  const providerAddress = utils.getAddress(
    (reserveData as any).LendingPoolAddressesProvider.hedera_testnet.address
  );
  const ret = await provider.call({
    to: providerAddress,
    data: ILendingPoolAddressesProvider.encodeFunctionData('getPoolAdmin', []),
  });
  const [rawPoolAdmin] = ILendingPoolAddressesProvider.decodeFunctionResult('getPoolAdmin', ret);
  const poolAdmin = utils.getAddress(rawPoolAdmin);
  const expectedGuardian = utils.getAddress(guardianSafe);

  if (poolAdmin === expectedGuardian) {
    return { ok: true, poolAdmin, guardianSafe: expectedGuardian };
  }

  return {
    ok: false,
    poolAdmin,
    guardianSafe: expectedGuardian,
    error:
      `Guardian Safe is not the LendingPoolConfigurator Pool Admin. ` +
      `Current Pool Admin: ${poolAdmin}; Guardian Safe: ${expectedGuardian}.`,
  };
};

const sanitizeChildOutput = (value: string): string =>
  value.split(REPO_ROOT + path.sep).join('');

const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

export const createIntegrationLogger = (
  logFile: string,
  sink: (line: string) => void = console.log
): IntegrationLogger => {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
  const emit = (line: string) => {
    sink(line);
    fs.appendFileSync(logFile, `${line}\n`);
  };

  return {
    banner(message) {
      emit('');
      emit(`🚀 ${message}`);
      emit('='.repeat([...message].length + 3));
    },
    step(title, detail) {
      emit(`🧭 ${title}${detail ? ` — ${detail}` : ''}`);
    },
    info(message) {
      emit(`🔎 ${message}`);
    },
    success(message) {
      emit(`✅ ${message}`);
    },
    warn(message) {
      emit(`⚠️ ${message}`);
    },
    error(message) {
      emit(`❌ ${message}`);
    },
    raw(message) {
      emit(message);
    },
    close() {
      // Writes are synchronous; close is kept for a uniform logger interface.
    },
  };
};

export const buildSupplyCapIntegrationArtifacts = (params: {
  now?: Date;
  safeAddress: string;
  outputDir?: string;
  logDir?: string;
  config?: SupplyCapIntegrationConfig;
}): IntegrationBuildResult => {
  const now = params.now ?? new Date();
  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const encodedAt = now.toISOString();
  const slug = timestampSlug(now);
  const config = params.config ?? SUPPLY_CAP_INTEGRATION_CONFIG;
  assertSupplyCapConfig(config);
  const chainType = config.chainType;
  const symbol = config.reserveSymbol.toUpperCase();
  const supplyCap = config.supplyCap;
  const asset = resolveReserveTokenAddress(config);
  const bipId = integrationBipId({ ...config, reserveSymbol: symbol });

  const bundle: Bundle = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: `Integration-only Guardian Safe execution: set Hedera testnet ${symbol} supply cap to ${supplyCap}.`,
    actions: [
      {
        kind: 'setSupplyCap',
        args: { asset, supplyCap },
      },
    ],
  };

  const ctx: BuildContext = {
    chain_type: chainType,
    addresses: {
      lendingPool: '',
      lendingPoolConfigurator: (reserveData as any).LendingPoolConfigurator.hedera_testnet.address,
      lendingPoolAddressesProvider: (reserveData as any).LendingPoolAddressesProvider.hedera_testnet.address,
      aaveProtocolDataProvider: (reserveData as any).AaveProtocolDataProvider.hedera_testnet.address,
      aaveOracle: (reserveData as any).AaveOracle.hedera_testnet.address,
      lendingRateOracle: (reserveData as any).LendingRateOracle.hedera_testnet.address,
      lendingPoolCollateralManager: (reserveData as any).LendingPoolCollateralManager.hedera_testnet.address,
      executorSafe: '',
      guardianSafe: params.safeAddress,
      multiSendCallOnly: '',
    },
  };

  const action = setSupplyCap.build({ asset, supplyCap }, ctx);
  action.targetSafe = TARGET_SAFE;
  action.description = `${action.description} [guardian integration override]`;

  const encoded: IntegrationEncodedArtifact = {
    bipId,
    chainType,
    encodedAt,
    targetSafe: TARGET_SAFE,
    safeAddress: utils.getAddress(params.safeAddress),
    integration: {
      name: 'guardianSupplyCapIntegration',
      symbol,
      forcedGuardianSafe: true,
      note:
        'This artifact is generated by scripts/dao/integration and intentionally executes setSupplyCap via Guardian Safe for testnet integration coverage.',
    },
    actions: [action],
    multiSend: null,
    safeExecution: {
      to: utils.getAddress(action.to),
      value: action.value,
      data: action.data,
      operation: 0,
    },
  };

  return {
    bundle,
    encoded,
    files: {
      bundleFile: path.join(outputDir, `${bipId}.bundle.json`),
      encodedFile: path.join(outputDir, `${bipId}.${chainType}.encoded.json`),
      logFile: path.join(logDir, `${bipId}.${slug}.log`),
    },
  };
};

export const buildGuardianHbarSmokeIntegrationArtifacts = (params: {
  now?: Date;
  safeAddress: string;
  outputDir?: string;
  logDir?: string;
}): IntegrationBuildResult => {
  const now = params.now ?? new Date();
  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const encodedAt = now.toISOString();
  const slug = timestampSlug(now);
  const receiver = utils.getAddress(GUARDIAN_HBAR_SMOKE_CONFIG.receiver);
  const amountTinybar = GUARDIAN_HBAR_SMOKE_CONFIG.amountTinybar;

  const bundle: GuardianHbarSmokePayload = {
    bipId: HBAR_SMOKE_BIP_ID,
    targetSafe: TARGET_SAFE,
    description:
      'Integration smoke: Guardian Safe transfers 0.1 HBAR to prove end-to-end multisig execution.',
    actions: [
      {
        kind: 'guardianHbarTransferSmoke',
        args: {
          receiver: GUARDIAN_HBAR_SMOKE_CONFIG.receiver,
          amountTinybar,
        },
      },
    ],
  };

  const action: IntegrationEncodedAction = {
    kind: 'guardianHbarTransferSmoke',
    to: receiver,
    value: amountTinybar,
    data: '0x',
    description: `Guardian Safe HBAR smoke transfer: ${amountTinybar} tinybar to ${receiver}`,
    expectedEvents: ['ExecutionSuccess'],
    targetSafe: TARGET_SAFE,
  };

  const encoded: IntegrationEncodedArtifact = {
    bipId: HBAR_SMOKE_BIP_ID,
    chainType: SUPPLY_CAP_INTEGRATION_CONFIG.chainType,
    encodedAt,
    targetSafe: TARGET_SAFE,
    safeAddress: utils.getAddress(params.safeAddress),
    integration: {
      name: 'guardianHbarTransferSmoke',
      symbol: 'HBAR',
      forcedGuardianSafe: true,
      note:
        'This smoke artifact is generated by scripts/dao/integration and intentionally executes a plain HBAR transfer via Guardian Safe.',
    },
    actions: [action],
    multiSend: null,
    safeExecution: {
      to: receiver,
      value: amountTinybar,
      data: '0x',
      operation: 0,
    },
  };

  return {
    bundle,
    encoded,
    files: {
      bundleFile: path.join(outputDir, `${HBAR_SMOKE_BIP_ID}.bundle.json`),
      encodedFile: path.join(
        outputDir,
        `${HBAR_SMOKE_BIP_ID}.${SUPPLY_CAP_INTEGRATION_CONFIG.chainType}.encoded.json`
      ),
      logFile: path.join(logDir, `${HBAR_SMOKE_BIP_ID}.${slug}.log`),
    },
  };
};

const runMultisigExec = (
  encodedFile: string,
  logger: IntegrationLogger
): SpawnSyncReturns<Buffer> => {
  logger.step('Launch multisig executor', 'Collecting Guardian approvals and executing Safe tx');
  const env = {
    ...process.env,
    CHAIN_TYPE: SUPPLY_CAP_INTEGRATION_CONFIG.chainType,
    TARGET_SAFE,
    ENCODED_JSON: encodedFile,
  };
  const command = buildMultisigExecCommand();

  const result = spawnSync(
    command.bin,
    command.args,
    { env, cwd: REPO_ROOT }
  );

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
  return result;
};

const main = async () => {
  const chainType = resolveChainType();
  assertNetworkConsistent(chainType);
  if (chainType !== SUPPLY_CAP_INTEGRATION_CONFIG.chainType) {
    throw new Error(`This integration is testnet-only. Got CHAIN_TYPE=${chainType}.`);
  }

  const safeAddress = MULTISIG_SAFE_ADDRESSES[chainType][TARGET_SAFE];
  if (!safeAddress) {
    throw new Error(`Missing Guardian Safe address in scripts/multisig/config.ts for ${chainType}.`);
  }

  const smokeMode = GUARDIAN_HBAR_SMOKE_CONFIG.enabled;
  const built = smokeMode
    ? buildGuardianHbarSmokeIntegrationArtifacts({ safeAddress })
    : buildSupplyCapIntegrationArtifacts({ safeAddress });
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner(
      smokeMode
        ? 'Bonzo DAO Integration: Guardian HBAR Smoke Transfer → 0.1 HBAR'
        : `Bonzo DAO Integration: ${SUPPLY_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()} Supply Cap → ${SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap.toLocaleString()}`
    );
    logger.info(`Network: ${chainType}`);
    logger.info(`Guardian Safe: ${utils.getAddress(safeAddress)}`);
    if (smokeMode) {
      logger.info(`Smoke receiver: ${utils.getAddress(GUARDIAN_HBAR_SMOKE_CONFIG.receiver)}`);
      logger.info(`Smoke amount: 0.1 HBAR (${GUARDIAN_HBAR_SMOKE_CONFIG.amountTinybar} tinybar)`);
    } else {
      logger.info(`Reserve symbol: ${SUPPLY_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()}`);
      logger.info(`Asset: ${resolveReserveTokenAddress(SUPPLY_CAP_INTEGRATION_CONFIG)}`);
      logger.info(`Supply cap: ${SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap.toLocaleString()}`);
    }
    logger.info(`Mode: ${process.env.DRY_RUN === 'true' ? 'DRY_RUN=true (no tx broadcast)' : 'LIVE (will send approvals + exec)'}`);
    logger.info(`Payload type: ${smokeMode ? 'Guardian HBAR transfer smoke' : 'Supply cap update'}`);

    logger.step('Create JSON payload', `Writing bundle to ${formatIntegrationPath(built.files.bundleFile)}`);
    writeJson(built.files.bundleFile, built.bundle);
    logger.success('Bundle JSON written');

    logger.step('Encode Safe execution', `Writing artifact to ${formatIntegrationPath(built.files.encodedFile)}`);
    writeJson(built.files.encodedFile, built.encoded);
    logger.success('Encoded Safe execution artifact written');

    const provider = getProvider(chainType);
    if (!smokeMode) {
      logger.step('Check configurator admin', 'Reading LendingPoolAddressesProvider.getPoolAdmin()');
      const admin = await preflightGuardianPoolAdmin(provider, safeAddress);
      logger.info(`Current Pool Admin: ${admin.poolAdmin}`);
      logger.info(`Guardian Safe: ${admin.guardianSafe}`);
      if (!admin.ok) {
        logger.error(admin.error);
        logger.warn(
          'No owner approvals were requested by this run because the configurator call would fail authorization.'
        );
        logger.warn(
          'Use GUARDIAN_HBAR_SMOKE=true to prove the integration/multisig path end-to-end, or route supply-cap updates through the Pool Admin Safe.'
        );
        throw new Error(admin.error);
      }
      logger.success('Guardian Safe is current Pool Admin');
    }

    logger.step(
      'Preflight Safe execution',
      'Running eth_call from Guardian Safe before collecting approvals'
    );
    const preflight = await preflightSafeExecution(provider, built.encoded);
    if (!preflight.ok) {
      logger.error(`safeExecution preflight reverted: ${preflight.error}`);
      if (!smokeMode) {
        logger.warn(
          'Supply-cap payload failed as Guardian Safe. This usually means the Guardian Safe is not authorized as Pool Admin for LendingPoolConfigurator.'
        );
        logger.warn(
          'No owner approvals were requested by this run. Use GUARDIAN_HBAR_SMOKE=true to prove the integration/multisig path end-to-end.'
        );
      }
      throw new Error(`safeExecution preflight failed before approvals: ${preflight.error}`);
    }
    logger.success('Safe execution preflight passed');

    logger.warn(
      smokeMode
        ? 'Using Guardian Safe for this integration smoke HBAR transfer'
        : 'Using Guardian Safe for this integration-only setSupplyCap execution'
    );
    const result = runMultisigExec(built.files.encodedFile, logger);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`multisig executor exited with status ${result.status}`);
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

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
