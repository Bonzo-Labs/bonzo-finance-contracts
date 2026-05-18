/**
 * Vertical integration: set a Hedera reserve supply cap via the Guardian Safe (testnet or mainnet).
 *
 * Network selection matches `scripts/supra-prices.ts` / `scripts/supra-deploy.ts`:
 * `resolveHederaNetwork(hre)` uses Hardhat `--network` when not `hardhat`, else `CHAIN_TYPE`
 * (default `hedera_testnet`). Guardian Safe is `SAFE_ADDRESSES[chain].guardian` from
 * `scripts/multisig/config.ts`.
 *
 * Edit `SUPPLY_CAP_INTEGRATION_CONFIG` for reserve symbol and supply cap only (no chain field).
 *
 * Testnet run from repo root:
 *   npm run dao:integration:sauce-supply-cap -- --network hedera_testnet
 *
 * Mainnet run:
 *   npm run dao:integration:sauce-supply-cap -- --network hedera_mainnet
 *
 * Dry-run without sending approval/execution transactions:
 *   DRY_RUN=true CHAIN_TYPE=hedera_mainnet npm run dao:integration:sauce-supply-cap -- --network hedera_mainnet
 *
 * End-to-end Guardian multisig smoke mode: still writes JSON/log artifacts, but
 * executes a plain HBAR Guardian Safe transfer instead of the supply-cap call.
 *   Testnet: GUARDIAN_HBAR_SMOKE_CONFIG in this file (receiver / tinybar amount).
 *   Mainnet: uses SMOKE_TRANSFER from scripts/multisig/config.ts (keep aligned with multisig smoke).
 *   GUARDIAN_HBAR_SMOKE=true CHAIN_TYPE=hedera_testnet npm run dao:integration:sauce-supply-cap -- --network hedera_testnet
 *
 * Payload only (no RPC, no multisig executor): writes bundle + encoded JSON and
 * logs Safe UI fields for copy-paste. Use multisig.hedera.foundation (or your Safe
 * app) as the sending Safe at safeAddress in the encoded file.
 *   INTEGRATION_SAFE_UI_PAYLOAD_ONLY=true CHAIN_TYPE=hedera_mainnet npm run dao:integration:sauce-supply-cap -- --network hedera_mainnet
 *
 * Required live-run env:
 *   PRIVATE_KEY or PRIVATE_KEY2 (testnet) / PRIVATE_KEY_MAINNET (mainnet) — gas-paying wallet
 *   GUARDIAN_OWNER_KEY_1..3 (testnet) / GUARDIAN_OWNER_KEY_MAINNET_1..3 (mainnet) — see scripts/multisig/config.ts
 *
 * This script intentionally routes this integration through the Guardian Safe
 * even though the general DAO registry treats setSupplyCap as an executor action.
 */
import path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { utils } from 'ethers';
import hre from 'hardhat';
require('dotenv').config();

import { resolveHederaNetwork } from '../../lib/resolveHederaNetwork';
import reserveData from '../../outputReserveData.json';
import setSupplyCap from '../actions/setSupplyCap';
import { assertNetworkConsistent } from '../config';
import type { Bundle, BuildContext, ChainType, EncodedAction } from '../types';
import {
  getProvider,
  SAFE_ADDRESSES as MULTISIG_SAFE_ADDRESSES,
  SMOKE_TRANSFER,
  TargetSafe,
} from '../../multisig/config';
import { integrationArtifactBase } from './config/integrationFileNames';
import {
  createIntegrationLogger,
  formatIntegrationPath,
  type IntegrationLogger,
  writeJson,
} from './config/integrationTooling';
import { preflightGuardianPoolAdmin } from './admin/poolAdminHandoff';

const INTEGRATION_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_DIR = path.join(INTEGRATION_DIR, 'output');
const LOG_DIR = path.join(INTEGRATION_DIR, 'logs');
const TARGET_SAFE: TargetSafe = 'guardian';
const MAX_VALID_SUPPLY_CAP = 68_719_476_735;

/** Reserve + cap only; chain comes from `resolveHederaNetwork(hre)` at runtime. */
export type SupplyCapIntegrationConfig = {
  reserveSymbol: string;
  supplyCap: number;
};

// === Manual operator config ==================================================
// Change these values before running, the same way scripts/supplyBorrowCaps.ts
// changes `reserves` and `supplyCaps`.
export const SUPPLY_CAP_INTEGRATION_CONFIG: SupplyCapIntegrationConfig = {
  reserveSymbol: 'SAUCE',
  supplyCap: 1_900_000,
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

const capSlug = (cap: number): string =>
  cap % 1_000_000 === 0 ? `${cap / 1_000_000}M` : String(cap);

const bipNetworkLabel = (chainType: ChainType): string =>
  chainType === 'hedera_mainnet' ? 'HEDERA-MAINNET' : 'HEDERA-TESTNET';

const integrationBipId = (chainType: ChainType, config: SupplyCapIntegrationConfig): string =>
  `INTEGRATION-${bipNetworkLabel(
    chainType
  )}-${config.reserveSymbol.toUpperCase()}-SUPPLY-CAP-${capSlug(config.supplyCap)}`;

const humanNetworkLabel = (chainType: ChainType): string =>
  chainType === 'hedera_mainnet' ? 'mainnet' : 'testnet';

const smokeBipId = (chainType: ChainType): string =>
  `INTEGRATION-${bipNetworkLabel(chainType)}-GUARDIAN-HBAR-SMOKE`;

const resolveReserveTokenAddress = (
  chainType: ChainType,
  config: SupplyCapIntegrationConfig
): string => {
  const symbol = config.reserveSymbol.toUpperCase();
  const asset = (reserveData as any)[symbol]?.[chainType]?.token?.address;
  if (!asset || !utils.isAddress(asset)) {
    throw new Error(
      `Missing ${symbol}.${chainType}.token.address in scripts/outputReserveData.json`
    );
  }
  return asset;
};

const assertSupplyCapConfig = (config: SupplyCapIntegrationConfig): void => {
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

export const buildMultisigExecCommand = (): { bin: string; args: string[] } => ({
  bin: 'npx',
  args: ['ts-node', '--transpile-only', 'scripts/multisig/execDaoEncoded.ts'],
});

export const preflightSafeExecution = async (
  provider: {
    call: (tx: { from: string; to: string; data: string; value: string }) => Promise<string>;
  },
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
    const error =
      e?.errorArgs?.[0] ||
      e?.error?.reason ||
      e?.error?.message ||
      e?.reason ||
      e?.message ||
      String(e);
    return { ok: false, error: String(error) };
  }
};

const sanitizeChildOutput = (value: string): string => value.split(REPO_ROOT + path.sep).join('');

export const buildSupplyCapIntegrationArtifacts = (params: {
  chainType: ChainType;
  now?: Date;
  safeAddress: string;
  outputDir?: string;
  logDir?: string;
  operatorConfig?: SupplyCapIntegrationConfig;
}): IntegrationBuildResult => {
  const now = params.now ?? new Date();
  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const encodedAt = now.toISOString();
  const config = params.operatorConfig ?? SUPPLY_CAP_INTEGRATION_CONFIG;
  assertSupplyCapConfig(config);
  const chainType = params.chainType;
  const symbol = config.reserveSymbol.toUpperCase();
  const supplyCap = config.supplyCap;
  const asset = resolveReserveTokenAddress(chainType, config);
  const bipId = integrationBipId(chainType, { ...config, reserveSymbol: symbol });
  const fileStem = `${symbol}-SUPPLY-CAP-${capSlug(supplyCap)}`;
  const fileBase = integrationArtifactBase(fileStem, chainType, now);

  const bundle: Bundle = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: `Integration-only Guardian Safe execution: set Hedera ${humanNetworkLabel(
      chainType
    )} ${symbol} supply cap to ${supplyCap}.`,
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
      lendingPoolConfigurator: (reserveData as any).LendingPoolConfigurator[chainType].address,
      lendingPoolAddressesProvider: (reserveData as any).LendingPoolAddressesProvider[chainType]
        .address,
      aaveProtocolDataProvider: (reserveData as any).AaveProtocolDataProvider[chainType].address,
      aaveOracle: (reserveData as any).AaveOracle[chainType].address,
      lendingRateOracle: (reserveData as any).LendingRateOracle[chainType].address,
      lendingPoolCollateralManager: (reserveData as any).LendingPoolCollateralManager[chainType]
        .address,
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
      note: 'This artifact is generated by scripts/dao/integration and intentionally executes setSupplyCap via Guardian Safe for integration coverage.',
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
      bundleFile: path.join(outputDir, `${fileBase}.bundle.json`),
      encodedFile: path.join(outputDir, `${fileBase}.encoded.json`),
      logFile: path.join(logDir, `${fileBase}.log`),
    },
  };
};

export const buildGuardianHbarSmokeIntegrationArtifacts = (params: {
  now?: Date;
  safeAddress: string;
  chainType: ChainType;
  outputDir?: string;
  logDir?: string;
}): IntegrationBuildResult => {
  const now = params.now ?? new Date();
  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const encodedAt = now.toISOString();
  const chainType = params.chainType;
  const fileBase = integrationArtifactBase('GUARDIAN-HBAR-SMOKE', chainType, now);
  const smoke =
    chainType === 'hedera_mainnet'
      ? {
          receiver: SMOKE_TRANSFER.hedera_mainnet.receiver,
          amountTinybar: SMOKE_TRANSFER.hedera_mainnet.amountTinybar,
        }
      : {
          receiver: GUARDIAN_HBAR_SMOKE_CONFIG.receiver,
          amountTinybar: GUARDIAN_HBAR_SMOKE_CONFIG.amountTinybar,
        };
  const receiver = utils.getAddress(smoke.receiver);
  const amountTinybar = smoke.amountTinybar;
  const bipId = smokeBipId(chainType);

  const bundle: GuardianHbarSmokePayload = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: `Integration smoke: Guardian Safe HBAR transfer on Hedera ${humanNetworkLabel(
      chainType
    )} (${amountTinybar} tinybar) to prove end-to-end multisig execution.`,
    actions: [
      {
        kind: 'guardianHbarTransferSmoke',
        args: {
          receiver: smoke.receiver,
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
    bipId,
    chainType,
    encodedAt,
    targetSafe: TARGET_SAFE,
    safeAddress: utils.getAddress(params.safeAddress),
    integration: {
      name: 'guardianHbarTransferSmoke',
      symbol: 'HBAR',
      forcedGuardianSafe: true,
      note: 'This smoke artifact is generated by scripts/dao/integration and intentionally executes a plain HBAR transfer via Guardian Safe.',
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
      bundleFile: path.join(outputDir, `${fileBase}.bundle.json`),
      encodedFile: path.join(outputDir, `${fileBase}.encoded.json`),
      logFile: path.join(logDir, `${fileBase}.log`),
    },
  };
};

const runMultisigExec = (
  encodedFile: string,
  logger: IntegrationLogger,
  chainType: ChainType
): SpawnSyncReturns<Buffer> => {
  logger.step('Launch multisig executor', 'Collecting Guardian approvals and executing Safe tx');
  const env = {
    ...process.env,
    CHAIN_TYPE: chainType,
    TARGET_SAFE,
    ENCODED_JSON: encodedFile,
  };
  const command = buildMultisigExecCommand();

  const result = spawnSync(command.bin, command.args, { env, cwd: REPO_ROOT });

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
  const chain_type = resolveHederaNetwork(hre);
  assertNetworkConsistent(chain_type);

  let safeAddress: string;
  if (chain_type === 'hedera_testnet') {
    safeAddress = MULTISIG_SAFE_ADDRESSES.hedera_testnet[TARGET_SAFE];
  } else if (chain_type === 'hedera_mainnet') {
    safeAddress = MULTISIG_SAFE_ADDRESSES.hedera_mainnet[TARGET_SAFE];
  } else {
    throw new Error(
      `Unsupported chain_type: ${chain_type}. Must be 'hedera_testnet' or 'hedera_mainnet'.`
    );
  }
  if (!safeAddress) {
    throw new Error(
      `Missing Guardian Safe address in scripts/multisig/config.ts for ${chain_type}.`
    );
  }

  const smokeMode = GUARDIAN_HBAR_SMOKE_CONFIG.enabled;
  const safeUiPayloadOnly = process.env.INTEGRATION_SAFE_UI_PAYLOAD_ONLY === 'true';
  const built = smokeMode
    ? buildGuardianHbarSmokeIntegrationArtifacts({ safeAddress, chainType: chain_type })
    : buildSupplyCapIntegrationArtifacts({ safeAddress, chainType: chain_type });
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner(
      smokeMode
        ? `Bonzo DAO Integration: Guardian HBAR smoke → ${utils.formatUnits(
            built.encoded.safeExecution.value,
            8
          )} HBAR`
        : `Bonzo DAO Integration: ${SUPPLY_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()} Supply Cap → ${SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap.toLocaleString()}`
    );
    logger.info(`Network: ${chain_type}`);
    logger.info(`Guardian Safe: ${utils.getAddress(safeAddress)}`);
    if (smokeMode) {
      logger.info(`Smoke receiver: ${utils.getAddress(built.encoded.safeExecution.to)}`);
      logger.info(
        `Smoke amount: ${utils.formatUnits(built.encoded.safeExecution.value, 8)} HBAR (${
          built.encoded.safeExecution.value
        } tinybar)`
      );
    } else {
      logger.info(`Reserve symbol: ${SUPPLY_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()}`);
      logger.info(
        `Asset: ${resolveReserveTokenAddress(chain_type, SUPPLY_CAP_INTEGRATION_CONFIG)}`
      );
      logger.info(`Supply cap: ${SUPPLY_CAP_INTEGRATION_CONFIG.supplyCap.toLocaleString()}`);
    }
    logger.info(
      `Mode: ${
        safeUiPayloadOnly
          ? 'INTEGRATION_SAFE_UI_PAYLOAD_ONLY=true (files + Safe UI fields only; no RPC preflight, no executor)'
          : process.env.DRY_RUN === 'true'
          ? 'DRY_RUN=true (no tx broadcast)'
          : 'LIVE (will send approvals + exec)'
      }`
    );
    logger.info(
      `Payload type: ${smokeMode ? 'Guardian HBAR transfer smoke' : 'Supply cap update'}`
    );

    logger.step(
      'Create JSON payload',
      `Writing bundle to ${formatIntegrationPath(built.files.bundleFile)}`
    );
    writeJson(built.files.bundleFile, built.bundle);
    logger.success('Bundle JSON written');

    logger.step(
      'Encode Safe execution',
      `Writing artifact to ${formatIntegrationPath(built.files.encodedFile)}`
    );
    writeJson(built.files.encodedFile, built.encoded);
    logger.success('Encoded Safe execution artifact written');

    if (safeUiPayloadOnly) {
      const se = built.encoded.safeExecution;
      logger.step(
        'Safe UI (manual transaction)',
        'Create a new transaction from the Safe below; paste to / value / data / operation'
      );
      logger.info(`Sending Safe (must be connected in the UI): ${built.encoded.safeAddress}`);
      logger.info(`  to:        ${se.to}`);
      logger.info(`  value:     ${se.value}`);
      logger.info(`  data:      ${se.data}`);
      logger.info(`  operation: ${se.operation} (CALL)`);
      logger.info(`Encoded artifact: ${formatIntegrationPath(built.files.encodedFile)}`);
      logger.success('Payload-only run finished');
      logger.info(`Log file: ${formatIntegrationPath(built.files.logFile)}`);
      return;
    }

    const provider = getProvider(chain_type);
    if (!smokeMode) {
      logger.step(
        'Check configurator admin',
        'Reading LendingPoolAddressesProvider.getPoolAdmin()'
      );
      const admin = await preflightGuardianPoolAdmin(provider, chain_type, safeAddress);
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
    const result = runMultisigExec(built.files.encodedFile, logger, chain_type);
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
