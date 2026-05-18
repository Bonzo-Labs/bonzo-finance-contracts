/**
 * Vertical integration: set a Hedera reserve borrow cap via the Guardian Safe (testnet or mainnet).
 *
 * Network selection matches `scripts/supra-prices.ts` / `scripts/supra-deploy.ts`:
 * `resolveHederaNetwork(hre)` uses Hardhat `--network` when not `hardhat`, else `CHAIN_TYPE`
 * (default `hedera_testnet`). Guardian Safe is `SAFE_ADDRESSES[chain].guardian` from
 * `scripts/multisig/config.ts`.
 *
 * Edit `BORROW_CAP_INTEGRATION_CONFIG` for reserve symbol and borrow cap only (no chain field).
 *
 * Testnet run from repo root:
 *   npm run dao:integration:sauce-borrow-cap -- --network hedera_testnet
 *
 * Mainnet run:
 *   npm run dao:integration:sauce-borrow-cap -- --network hedera_mainnet
 *
 * Dry-run without sending approval/execution transactions:
 *   DRY_RUN=true npm run dao:integration:sauce-borrow-cap -- --network hedera_testnet
 *
 * End-to-end Guardian multisig smoke mode: still writes JSON/log artifacts, but
 * executes a plain HBAR Guardian Safe transfer instead of the borrow-cap call.
 *   Testnet: GUARDIAN_HBAR_SMOKE_CONFIG in sauceSupplyCapToOneMillion.ts (receiver / tinybar amount).
 *   Mainnet: uses SMOKE_TRANSFER from scripts/multisig/config.ts.
 *   GUARDIAN_HBAR_SMOKE=true npm run dao:integration:sauce-borrow-cap -- --network hedera_testnet
 *
 * Payload only (no RPC, no multisig executor): writes bundle + encoded JSON and
 * logs Safe UI fields for copy-paste. Use multisig.hedera.foundation (or your Safe
 * app) as the sending Safe at safeAddress in the encoded file.
 *   INTEGRATION_SAFE_UI_PAYLOAD_ONLY=true npm run dao:integration:sauce-borrow-cap -- --network hedera_mainnet
 *
 * Required live-run env:
 *   PRIVATE_KEY or PRIVATE_KEY2 (testnet) / PRIVATE_KEY_MAINNET (mainnet) — gas-paying wallet
 *   GUARDIAN_OWNER_KEY_1..3 (testnet) / GUARDIAN_OWNER_KEY_MAINNET_1..3 (mainnet) — see scripts/multisig/config.ts
 *
 * This script intentionally routes this integration through the Guardian Safe
 * even though the general DAO registry treats setBorrowCap as an executor action.
 */
import path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { utils } from 'ethers';
import hre from 'hardhat';
require('dotenv').config();

import { resolveHederaNetwork } from '../../lib/resolveHederaNetwork';
import reserveData from '../../outputReserveData.json';
import setBorrowCap from '../actions/setBorrowCap';
import { assertNetworkConsistent } from '../config';
import type { Bundle, BuildContext, ChainType } from '../types';
import {
  getProvider,
  SAFE_ADDRESSES as MULTISIG_SAFE_ADDRESSES,
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
import {
  buildGuardianHbarSmokeIntegrationArtifacts,
  buildMultisigExecCommand,
  GUARDIAN_HBAR_SMOKE_CONFIG,
  preflightSafeExecution,
} from './sauceSupplyCapToOneMillion';
import type {
  IntegrationBuildResult,
  IntegrationEncodedArtifact,
} from './sauceSupplyCapToOneMillion';

const INTEGRATION_DIR = __dirname;
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUTPUT_DIR = path.join(INTEGRATION_DIR, 'output');
const LOG_DIR = path.join(INTEGRATION_DIR, 'logs');
const TARGET_SAFE: TargetSafe = 'guardian';
const MAX_VALID_BORROW_CAP = 68_719_476_735;

/** Reserve + cap only; chain comes from `resolveHederaNetwork(hre)` at runtime. */
export type BorrowCapIntegrationConfig = {
  reserveSymbol: string;
  borrowCap: number;
};

// === Manual operator config ==================================================
// Change these values before running, the same way scripts/supplyBorrowCaps.ts
// changes `reserves` and `borrowCaps`.
export const BORROW_CAP_INTEGRATION_CONFIG: BorrowCapIntegrationConfig = {
  reserveSymbol: 'SAUCE',
  borrowCap: 500_000,
};
// =============================================================================

const capSlug = (cap: number): string => {
  if (cap % 1_000_000 === 0) return `${cap / 1_000_000}M`;
  if (cap % 1_000 === 0) return `${cap / 1_000}K`;
  return String(cap);
};

const bipNetworkLabel = (chainType: ChainType): string =>
  chainType === 'hedera_mainnet' ? 'HEDERA-MAINNET' : 'HEDERA-TESTNET';

const integrationBipId = (chainType: ChainType, config: BorrowCapIntegrationConfig): string =>
  `INTEGRATION-${bipNetworkLabel(chainType)}-${config.reserveSymbol.toUpperCase()}-BORROW-CAP-${capSlug(
    config.borrowCap
  )}`;

const humanNetworkLabel = (chainType: ChainType): string =>
  chainType === 'hedera_mainnet' ? 'mainnet' : 'testnet';

const resolveReserveTokenAddress = (
  chainType: ChainType,
  config: BorrowCapIntegrationConfig
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

const assertBorrowCapConfig = (config: BorrowCapIntegrationConfig): void => {
  if (!config.reserveSymbol.trim()) {
    throw new Error('BORROW_CAP_INTEGRATION_CONFIG.reserveSymbol must be set.');
  }
  if (!Number.isInteger(config.borrowCap) || config.borrowCap < 0) {
    throw new Error('BORROW_CAP_INTEGRATION_CONFIG.borrowCap must be a non-negative integer.');
  }
  if (config.borrowCap > MAX_VALID_BORROW_CAP) {
    throw new Error(
      `BORROW_CAP_INTEGRATION_CONFIG.borrowCap exceeds MAX_VALID_BORROW_CAP=${MAX_VALID_BORROW_CAP}.`
    );
  }
};

export const buildBorrowCapIntegrationArtifacts = (params: {
  chainType: ChainType;
  now?: Date;
  safeAddress: string;
  outputDir?: string;
  logDir?: string;
  operatorConfig?: BorrowCapIntegrationConfig;
}): IntegrationBuildResult => {
  const now = params.now ?? new Date();
  const outputDir = params.outputDir ?? OUTPUT_DIR;
  const logDir = params.logDir ?? LOG_DIR;
  const encodedAt = now.toISOString();
  const config = params.operatorConfig ?? BORROW_CAP_INTEGRATION_CONFIG;
  assertBorrowCapConfig(config);
  const chainType = params.chainType;
  const symbol = config.reserveSymbol.toUpperCase();
  const borrowCap = config.borrowCap;
  const asset = resolveReserveTokenAddress(chainType, config);
  const bipId = integrationBipId(chainType, { ...config, reserveSymbol: symbol });
  const fileStem = `${symbol}-BORROW-CAP-${capSlug(borrowCap)}`;
  const fileBase = integrationArtifactBase(fileStem, chainType, now);

  const bundle: Bundle = {
    bipId,
    targetSafe: TARGET_SAFE,
    description: `Integration-only Guardian Safe execution: set Hedera ${humanNetworkLabel(
      chainType
    )} ${symbol} borrow cap to ${borrowCap}.`,
    actions: [
      {
        kind: 'setBorrowCap',
        args: { asset, borrowCap },
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

  const action = setBorrowCap.build({ asset, borrowCap }, ctx);
  action.targetSafe = TARGET_SAFE;
  action.description = `${action.description} [guardian integration override]`;

  const encoded: IntegrationEncodedArtifact = {
    bipId,
    chainType,
    encodedAt,
    targetSafe: TARGET_SAFE,
    safeAddress: utils.getAddress(params.safeAddress),
    integration: {
      name: 'guardianBorrowCapIntegration',
      symbol,
      forcedGuardianSafe: true,
      note: 'This artifact is generated by scripts/dao/integration and intentionally executes setBorrowCap via Guardian Safe for integration coverage.',
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

const sanitizeChildOutput = (value: string): string => value.split(REPO_ROOT + path.sep).join('');

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
    : buildBorrowCapIntegrationArtifacts({ safeAddress, chainType: chain_type });
  const logger = createIntegrationLogger(built.files.logFile);

  try {
    logger.banner(
      smokeMode
        ? `Bonzo DAO Integration: Guardian HBAR smoke → ${utils.formatUnits(
            built.encoded.safeExecution.value,
            8
          )} HBAR`
        : `Bonzo DAO Integration: ${BORROW_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()} Borrow Cap → ${BORROW_CAP_INTEGRATION_CONFIG.borrowCap.toLocaleString()}`
    );
    logger.info(`Network: ${chain_type}`);
    logger.info(`Guardian Safe: ${utils.getAddress(safeAddress)}`);
    if (smokeMode) {
      logger.info(`Smoke receiver: ${utils.getAddress(built.encoded.safeExecution.to)}`);
      logger.info(
        `Smoke amount: ${utils.formatUnits(built.encoded.safeExecution.value, 8)} HBAR (${built.encoded.safeExecution.value} tinybar)`
      );
    } else {
      logger.info(`Reserve symbol: ${BORROW_CAP_INTEGRATION_CONFIG.reserveSymbol.toUpperCase()}`);
      logger.info(`Asset: ${resolveReserveTokenAddress(chain_type, BORROW_CAP_INTEGRATION_CONFIG)}`);
      logger.info(`Borrow cap: ${BORROW_CAP_INTEGRATION_CONFIG.borrowCap.toLocaleString()}`);
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
      `Payload type: ${smokeMode ? 'Guardian HBAR transfer smoke' : 'Borrow cap update'}`
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
          'Use GUARDIAN_HBAR_SMOKE=true to prove the integration/multisig path end-to-end, or route borrow-cap updates through the Pool Admin Safe.'
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
          'Borrow-cap payload failed as Guardian Safe. This usually means the Guardian Safe is not authorized as Pool Admin for LendingPoolConfigurator.'
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
        : 'Using Guardian Safe for this integration-only setBorrowCap execution'
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
