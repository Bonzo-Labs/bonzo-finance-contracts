/**
 * Emergency-admin handoff, resumable batched rate refresh, and mandatory restoration.
 *
 * Default behaviour is preflight only. State-changing execution requires:
 *   CONFIRM_ATOMIC_RATE_REFRESH=HANDOFF_EXECUTE_RESTORE
 *
 * Transactions:
 *   1. AddressesProvider owner -> setEmergencyAdmin(executor)
 *   2-5. Controller -> executor.executeAtomicRefreshBatch(0..3)
 *        Each transaction: unpause -> batch mode-0 flash loan -> pause
 *   6. AddressesProvider owner -> setEmergencyAdmin(original EOA)
 *
 * Restoration is attempted in finally after any submitted handoff, even if a batch fails. If the pool is ever
 * observed open, the script first attempts executor.pauseOnly(), then restores
 * the EOA and attempts a direct emergency-admin pause if still necessary.
 */
import { ethers } from 'hardhat';
import fs from 'fs';
const hre = require('hardhat');
require('dotenv').config();

import { assertReviewedExecutorRuntime } from './atomicRatePokeVerification';
import {
  ASSET_BY_SYMBOL,
  EXECUTOR_STATE_PATH,
  MAINNET_CHAIN_ID,
  PROTOCOL_ADDRESSES,
  RATE_SYMBOLS,
  RATE_STATE_PATH,
  RateSymbol,
  StrategyMap,
  assertConfiguredReserveSet,
  assertMainnet,
  assertRecordedStrategyIdentity,
} from './rateConfig';
import {
  conciseRpcError,
  contractAs,
  eqAddress,
  readJson,
  sleep,
  smallUintToNumber,
  withRetry,
} from './scriptUtils';

const CHAIN = process.env.CHAIN_TYPE || 'hedera_testnet';
assertMainnet(CHAIN);

const rpcUrl = process.env.PROVIDER_URL_MAINNET || '';
const adminKey = process.env.PRIVATE_KEY_MAINNET_ADMIN || '';
if (!rpcUrl || !adminKey)
  throw new Error('Missing mainnet provider or admin signer configuration.');

const provider = withRetry(new ethers.providers.JsonRpcProvider(rpcUrl));
const owner = new ethers.Wallet(adminKey, provider);
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 3000);
const eq = eqAddress;
const EXPECTED_ADDRESSES = PROTOCOL_ADDRESSES;
const ALL_BATCHES_BITMAP = 0x0f;

const RATE_BATCHES: ReadonlyArray<{ id: number; symbols: RateSymbol[] }> = [
  { id: 0, symbols: ['WHBAR', 'USDC', 'WETH'] },
  { id: 1, symbols: ['BONZO', 'HBARX', 'SAUCE', 'XSAUCE'] },
  { id: 2, symbols: ['KARATE', 'GRELF', 'DOVU', 'HST'] },
  { id: 3, symbols: ['PACK', 'STEAM', 'KBL'] },
];

const configuredBatchSymbols = RATE_BATCHES.flatMap((batch) => batch.symbols);
if (
  configuredBatchSymbols.length !== RATE_SYMBOLS.length ||
  configuredBatchSymbols.some((symbol, index) => symbol !== RATE_SYMBOLS[index])
) {
  throw new Error('RATE_BATCHES must cover RATE_SYMBOLS exactly once and in configured order.');
}

async function waitForAddress(
  label: string,
  read: () => Promise<string>,
  expected: string,
  attempts = 15
) {
  let actual = '';
  for (let i = 0; i < attempts; i++) {
    actual = await read();
    if (eq(actual, expected)) return actual;
    await sleep(2000);
  }
  throw new Error(`${label} did not settle: ${actual} != ${expected}`);
}

type DeploymentState = {
  network: string;
  chainId: number;
  executor: string;
  deploymentBlock: number;
  runtimeBytecodeHash: string;
  reviewedRuntimeTemplateHash: string;
  reviewedSourceHash: string;
  controller: string;
  originalEmergencyAdmin: string;
  poolAdmin: string;
  strategies: StrategyMap;
  addresses: {
    provider: string;
    pool: string;
    configurator: string;
    dataProvider: string;
    assets: StrategyMap;
  };
  execution?: {
    completedBitmap?: number;
    batches?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
};

function loadState(): DeploymentState {
  return readJson(EXECUTOR_STATE_PATH);
}

function writeStateAtomically(state: DeploymentState) {
  const temporaryPath = `${EXECUTOR_STATE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2) + '\n');
    fs.renameSync(temporaryPath, EXECUTOR_STATE_PATH);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function saveExecution(state: DeploymentState, update: Record<string, unknown>) {
  state.execution = { ...(state.execution || {}), ...update, updatedAt: new Date().toISOString() };
  writeStateAtomically(state);
}

function saveCompletedBatch(
  state: DeploymentState,
  batchId: number,
  completedBitmap: number,
  record: Record<string, unknown>
) {
  const execution = state.execution || {};
  state.execution = {
    ...execution,
    completedBitmap,
    batches: {
      ...(execution.batches || {}),
      [String(batchId + 1)]: record,
    },
    updatedAt: new Date().toISOString(),
  };
  writeStateAtomically(state);
}

function saveExecutionBestEffort(state: DeploymentState, update: Record<string, unknown>) {
  try {
    saveExecution(state, update);
  } catch (error: any) {
    console.error('Could not persist recovery state:', error?.message || error);
  }
}

type ReserveSnapshot = {
  liquidityRate: string;
  stableBorrowRate: string;
  variableBorrowRate: string;
  liquidityIndex: string;
  variableBorrowIndex: string;
};

async function readReserveSnapshots(dp: any, assets: Array<[string, string]>) {
  const snapshots: Record<string, ReserveSnapshot> = {};
  for (const [symbol, asset] of assets) {
    const reserve = await dp.getReserveData(asset);
    snapshots[symbol] = {
      liquidityRate: reserve.liquidityRate.toString(),
      stableBorrowRate: reserve.stableBorrowRate.toString(),
      variableBorrowRate: reserve.variableBorrowRate.toString(),
      liquidityIndex: reserve.liquidityIndex.toString(),
      variableBorrowIndex: reserve.variableBorrowIndex.toString(),
    };
  }
  return snapshots;
}

async function reconcileBatchCheckpoints(
  state: DeploymentState,
  executor: any,
  chainBitmap: number
) {
  if (chainBitmap < 0 || chainBitmap > ALL_BATCHES_BITMAP) {
    throw new Error(`Executor returned invalid completed-batch bitmap ${chainBitmap}.`);
  }

  const execution = state.execution || {};
  const batches = { ...(execution.batches || {}) };
  let jsonClaimedBitmap = Number(execution.completedBitmap || 0);
  if (!Number.isInteger(jsonClaimedBitmap) || jsonClaimedBitmap < 0) {
    throw new Error(`Invalid JSON completed-batch bitmap ${execution.completedBitmap}.`);
  }
  for (const batch of RATE_BATCHES) {
    const record = batches[String(batch.id + 1)] as any;
    if (record?.status === 'completed' || record?.status === 'recovered-from-chain') {
      jsonClaimedBitmap |= 1 << batch.id;
    }
  }
  if ((jsonClaimedBitmap & ~chainBitmap) !== 0) {
    throw new Error(
      `Execution JSON claims bitmap ${jsonClaimedBitmap}, but the executor reports ${chainBitmap}. ` +
        'Refusing to continue because local progress exceeds on-chain progress.'
    );
  }

  let repaired = Number(execution.completedBitmap || 0) !== chainBitmap;
  for (const batch of RATE_BATCHES) {
    const bit = 1 << batch.id;
    const existingRecord = batches[String(batch.id + 1)] as any;
    if (
      (chainBitmap & bit) === 0 ||
      existingRecord?.status === 'completed' ||
      existingRecord?.status === 'recovered-from-chain'
    ) {
      continue;
    }

    const events = await executor.queryFilter(
      executor.filters.AtomicRateRefreshBatchExecuted(null, batch.id),
      state.deploymentBlock
    );
    const event = events[events.length - 1];
    if (!event) {
      throw new Error(
        `Batch ${batch.id + 1} is complete on chain, but its checkpoint event could not be ` +
          `recovered from block ${state.deploymentBlock}. Refusing to continue without an audit record.`
      );
    }
    batches[String(batch.id + 1)] = {
      status: 'recovered-from-chain',
      contractBatchId: batch.id,
      batchNumber: batch.id + 1,
      symbols: batch.symbols,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      recoveredAt: new Date().toISOString(),
    };
    repaired = true;
  }

  if (repaired) {
    state.execution = {
      ...execution,
      completedBitmap: chainBitmap,
      batches,
      reconciledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeStateAtomically(state);
    console.log(`Reconciled execution checkpoint to on-chain bitmap ${chainBitmap}.`);
  }
}

async function preflight(state: DeploymentState) {
  if (state.network !== CHAIN || state.chainId !== MAINNET_CHAIN_ID)
    throw new Error('Deployment state network mismatch.');
  if (!eq(state.controller, owner.address))
    throw new Error('Configured controller differs from signer.');
  if (!eq(state.originalEmergencyAdmin, owner.address))
    throw new Error(
      'Recorded original emergency admin differs from the AddressesProvider owner signer.'
    );
  if (!eq(state.poolAdmin, owner.address))
    throw new Error('Recorded pool admin differs from the AddressesProvider owner signer.');

  const a = state.addresses;
  for (const key of Object.keys(EXPECTED_ADDRESSES) as Array<keyof typeof EXPECTED_ADDRESSES>) {
    if (!eq(a[key], EXPECTED_ADDRESSES[key])) {
      throw new Error(`Deployment state address mismatch for ${key}: ${a[key]}`);
    }
  }
  for (const symbol of RATE_SYMBOLS) {
    if (!eq(a.assets[symbol], ASSET_BY_SYMBOL[symbol])) {
      throw new Error(`Deployment state asset mismatch for ${symbol}: ${a.assets[symbol]}`);
    }
  }
  const ap = await contractAs(hre, 'LendingPoolAddressesProvider', a.provider, owner);
  const pool = await contractAs(hre, 'LendingPool', a.pool, provider);
  const configurator = await contractAs(hre, 'LendingPoolConfigurator', a.configurator, owner);
  const dp = await contractAs(hre, 'AaveProtocolDataProvider', a.dataProvider, provider);
  const executor = await contractAs(hre, 'AtomicRatePokeExecutor', state.executor, owner);

  const [
    network,
    providerOwner,
    emergencyAdmin,
    poolAdmin,
    livePool,
    liveConfigurator,
    paused,
    completedBatches,
    code,
  ] = await Promise.all([
    provider.getNetwork(),
    ap.owner(),
    ap.getEmergencyAdmin(),
    ap.getPoolAdmin(),
    ap.getLendingPool(),
    ap.getLendingPoolConfigurator(),
    pool.paused(),
    executor.completedBatches(),
    provider.getCode(state.executor),
  ]);

  if (network.chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain id: ${network.chainId}`);
  if (!eq(providerOwner, owner.address))
    throw new Error(`Signer is not AddressesProvider owner ${providerOwner}`);
  if (!eq(emergencyAdmin, state.originalEmergencyAdmin)) {
    throw new Error(
      `Emergency admin ${emergencyAdmin} != expected original ${state.originalEmergencyAdmin}`
    );
  }
  if (!eq(poolAdmin, state.poolAdmin)) throw new Error(`Pool admin changed to ${poolAdmin}`);
  if (!eq(livePool, a.pool) || !eq(liveConfigurator, a.configurator)) {
    throw new Error('AddressesProvider pool or configurator changed after deployment.');
  }
  if (!paused) throw new Error('Pool is not paused.');
  const completedBitmap = smallUintToNumber(completedBatches, 'completedBatches');
  if (code === '0x' || ethers.utils.keccak256(code) !== state.runtimeBytecodeHash) {
    throw new Error('Executor runtime bytecode is missing or does not match deployment state.');
  }
  const reviewedRuntime = await assertReviewedExecutorRuntime(hre, code);
  if (
    reviewedRuntime.reviewedRuntimeTemplateHash !== state.reviewedRuntimeTemplateHash ||
    reviewedRuntime.reviewedSourceHash !== state.reviewedSourceHash
  ) {
    throw new Error('Executor does not match the reviewed runtime/source recorded at deployment.');
  }
  const immutableChecks: Array<[string, string]> = [
    [await executor.CONTROLLER(), state.controller],
    [await executor.ADDRESSES_PROVIDER(), a.provider],
    [await executor.LENDING_POOL(), a.pool],
    [await executor.CONFIGURATOR(), a.configurator],
  ];
  for (const [actual, expected] of immutableChecks) {
    if (!eq(actual, expected))
      throw new Error(`Executor immutable mismatch: ${actual} != ${expected}`);
  }
  for (let i = 0; i < RATE_SYMBOLS.length; i++) {
    const symbol = RATE_SYMBOLS[i];
    const [asset, strategy] = await Promise.all([executor.ASSETS(i), executor.STRATEGIES(i)]);
    if (!eq(asset, a.assets[symbol])) {
      throw new Error(`${symbol}: executor asset ${asset} != ${a.assets[symbol]}`);
    }
    if (!eq(strategy, state.strategies[symbol])) {
      throw new Error(`${symbol}: executor strategy ${strategy} != ${state.strategies[symbol]}`);
    }
  }
  await reconcileBatchCheckpoints(state, executor, completedBitmap);

  const reserves: string[] = await pool.getReservesList();
  assertConfiguredReserveSet(reserves);
  const notFrozen: string[] = [];
  for (const asset of reserves) {
    const cfg = await dp.getReserveConfigurationData(asset);
    if (!cfg.isFrozen) notFrozen.push(asset);
  }
  if (notFrozen.length) throw new Error(`Not all reserves are frozen: ${notFrozen.join(', ')}`);

  const rateState = readJson(RATE_STATE_PATH);
  const assets: Array<[RateSymbol, string]> = RATE_SYMBOLS.map((symbol) => [
    symbol,
    a.assets[symbol],
  ]);
  for (const [symbol, asset] of assets) {
    const expectedStrategy = rateState.reserves?.[symbol]?.deploy?.address;
    const wired = rateState.reserves?.[symbol]?.wire?.completed;
    if (!wired || !expectedStrategy) throw new Error(`${symbol}: strategy state incomplete`);
    if (!eq(state.strategies[symbol as keyof typeof state.strategies], expectedStrategy)) {
      throw new Error(`${symbol}: recorded executor strategy differs from approved strategy state`);
    }
    const reserve = await pool.getReserveData(asset);
    if (!eq(reserve.interestRateStrategyAddress, expectedStrategy)) {
      throw new Error(
        `${symbol}: live strategy ${reserve.interestRateStrategyAddress} != ${expectedStrategy}`
      );
    }
    const strategy = await contractAs(
      hre,
      'DefaultReserveInterestRateStrategy',
      expectedStrategy,
      provider
    );
    await assertRecordedStrategyIdentity(
      symbol,
      strategy,
      provider,
      rateState.reserves[symbol].deploy
    );
    const cfg = await dp.getReserveConfigurationData(asset);
    if (!cfg.isActive || !cfg.isFrozen || cfg.stableBorrowRateEnabled) {
      throw new Error(`${symbol}: expected active, frozen, and stable borrowing disabled`);
    }
    const underlying = new ethers.Contract(
      asset,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const aToken = new ethers.Contract(
      reserve.aTokenAddress,
      ['function totalSupply() view returns (uint256)'],
      provider
    );
    const [liquidity, aTokenSupply] = await Promise.all([
      underlying.balanceOf(reserve.aTokenAddress),
      aToken.totalSupply(),
    ]);
    if (liquidity.lt(1))
      throw new Error(`${symbol}: insufficient aToken liquidity for one atomic unit`);
    if (aTokenSupply.isZero()) throw new Error(`${symbol}: aToken total supply is zero`);
  }

  const beforeRates = await readReserveSnapshots(dp, assets);
  console.log('Preflight passed. No transaction has been sent.');
  console.log('Stored variable rates before:', beforeRates);
  return { ap, pool, configurator, dp, executor, assets, beforeRates, completedBitmap };
}

function readReserveUpdateEvents(receipt: any, pool: any, assets: Array<[string, string]>) {
  const updates: Record<string, ReserveSnapshot> = {};
  const symbolByAsset = new Map(assets.map(([symbol, asset]) => [asset.toLowerCase(), symbol]));

  for (const log of receipt.logs || []) {
    if (!eq(log.address, pool.address)) continue;
    let parsed: any;
    try {
      parsed = pool.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed.name !== 'ReserveDataUpdated') continue;
    const symbol = symbolByAsset.get(parsed.args.reserve.toLowerCase());
    if (!symbol) continue;
    if (updates[symbol]) throw new Error(`${symbol}: duplicate ReserveDataUpdated event`);
    updates[symbol] = {
      liquidityRate: parsed.args.liquidityRate.toString(),
      stableBorrowRate: parsed.args.stableBorrowRate.toString(),
      variableBorrowRate: parsed.args.variableBorrowRate.toString(),
      liquidityIndex: parsed.args.liquidityIndex.toString(),
      variableBorrowIndex: parsed.args.variableBorrowIndex.toString(),
    };
  }

  for (const [symbol] of assets) {
    if (!updates[symbol]) throw new Error(`${symbol}: missing ReserveDataUpdated event`);
  }
  return updates;
}

async function main() {
  const state = loadState();
  console.log('Chain:', CHAIN);
  console.log('AddressesProvider owner/controller:', owner.address);
  console.log('Executor:', state.executor);
  const c = await preflight(state);
  const pendingBatches = RATE_BATCHES.filter(
    (batch) => (c.completedBitmap & (1 << batch.id)) === 0
  );
  console.log('Completed batch bitmap:', c.completedBitmap);
  console.log(
    'Pending batches:',
    pendingBatches.length
      ? pendingBatches.map((batch) => `${batch.id + 1} (${batch.symbols.join(', ')})`).join('; ')
      : 'none'
  );

  if (pendingBatches.length === 0) {
    saveExecution(state, {
      completed: true,
      completedBitmap: c.completedBitmap,
      completedAt: state.execution?.completedAt || new Date().toISOString(),
      activeBatchId: null,
      activeBatchNumber: null,
      activeBatchTxHash: null,
      lastRunError: null,
      error: null,
    });
    console.log('All four atomic refresh batches are already complete. No transaction is needed.');
    return;
  }

  if (process.env.CONFIRM_ATOMIC_RATE_REFRESH !== 'HANDOFF_EXECUTE_RESTORE') {
    console.log(
      'Dry run only. Set CONFIRM_ATOMIC_RATE_REFRESH=HANDOFF_EXECUTE_RESTORE to hand off, execute the remaining batches, and restore.'
    );
    return;
  }

  // let executionError: unknown;
  // let handoffSubmitted = false;
  // let completedBitmap = c.completedBitmap;
  // try {
  //   console.log('Assigning emergency admin to executor...');
  //   // Mark BEFORE broadcasting. If setEmergencyAdmin reaches the relay but the
  //   // await rejects (e.g. a dropped connection after the relay accepted it), the
  //   // transaction can still mine and make the executor the emergency admin.
  //   // Setting this flag first guarantees the finally block always runs the
  //   // restoration path rather than skipping it and stranding the role.
  //   handoffSubmitted = true;
  //   const handoffTx = await c.ap.setEmergencyAdmin(state.executor);
  //   saveExecution(state, { startedAt: new Date().toISOString(), handoffTxHash: handoffTx.hash });
  //   await handoffTx.wait();
  //   saveExecution(state, { handoffMined: true });
  //   await waitForAddress('Emergency-admin handoff', () => c.ap.getEmergencyAdmin(), state.executor);
  //   saveExecution(state, { handoffCompleted: true });
  //   await sleep(TX_DELAY_MS);

  //   // Simulate every remaining batch before broadcasting the first one. This
  //   // prevents discovering a deterministic child-record or validation failure
  //   // only after earlier batches have already committed.
  //   const configuredGasLimit = process.env.ATOMIC_EXECUTOR_EXECUTE_GAS_LIMIT
  //     ? ethers.BigNumber.from(process.env.ATOMIC_EXECUTOR_EXECUTE_GAS_LIMIT)
  //     : undefined;
  //   const gasLimits = new Map<number, any>();
  //   console.log('Simulating all remaining atomic refresh batches...');
  //   for (const batch of pendingBatches) {
  //     try {
  //       await c.executor.callStatic.executeAtomicRefreshBatch(batch.id);
  //     } catch (simulationError: any) {
  //       throw new Error(
  //         `Batch ${batch.id + 1} simulation failed; refusing execution: ${conciseRpcError(
  //           simulationError
  //         )}`
  //       );
  //     }

  //     let estimatedGas: any;
  //     try {
  //       estimatedGas = await c.executor.estimateGas.executeAtomicRefreshBatch(batch.id);
  //     } catch (estimateError: any) {
  //       if (!configuredGasLimit) {
  //         throw new Error(
  //           `Batch ${batch.id + 1} gas estimation unavailable (${conciseRpcError(
  //             estimateError
  //           )}). Set ATOMIC_EXECUTOR_EXECUTE_GAS_LIMIT explicitly only after reviewing its simulation.`
  //         );
  //       }
  //     }
  //     if (
  //       estimatedGas &&
  //       configuredGasLimit &&
  //       configuredGasLimit.lt(estimatedGas.mul(105).div(100))
  //     ) {
  //       throw new Error(
  //         `ATOMIC_EXECUTOR_EXECUTE_GAS_LIMIT ${configuredGasLimit.toString()} is below 105% of ` +
  //           `Batch ${batch.id + 1} estimate ${estimatedGas.toString()}.`
  //       );
  //     }
  //     const gasLimit = configuredGasLimit || estimatedGas.mul(110).div(100);
  //     gasLimits.set(batch.id, gasLimit);
  //     console.log(
  //       `Batch ${batch.id + 1} simulation passed: estimate=${
  //         estimatedGas?.toString() || 'unavailable'
  //       } limit=${gasLimit.toString()}.`
  //     );
  //   }

  //   for (const batch of pendingBatches) {
  //     const batchAssets: Array<[RateSymbol, string]> = batch.symbols.map((symbol) => [
  //       symbol,
  //       state.addresses.assets[symbol],
  //     ]);
  //     const [liveAdmin, pausedBefore, beforeRates] = await Promise.all([
  //       c.ap.getEmergencyAdmin(),
  //       c.pool.paused(),
  //       readReserveSnapshots(c.dp, batchAssets),
  //     ]);
  //     if (!eq(liveAdmin, state.executor)) {
  //       throw new Error(`Executor lost emergency-admin role before Batch ${batch.id + 1}.`);
  //     }
  //     if (!pausedBefore) throw new Error(`Pool is open before Batch ${batch.id + 1}.`);

  //     console.log(`Executing Batch ${batch.id + 1}/4 (${batch.symbols.join(', ')})...`);
  //     const executeTx = await c.executor.executeAtomicRefreshBatch(batch.id, {
  //       gasLimit: gasLimits.get(batch.id),
  //     });
  //     saveExecution(state, {
  //       activeBatchId: batch.id,
  //       activeBatchNumber: batch.id + 1,
  //       activeBatchTxHash: executeTx.hash,
  //     });
  //     const receipt = await executeTx.wait();
  //     if (receipt.status !== 1) {
  //       throw new Error(`Batch ${batch.id + 1} transaction failed: ${executeTx.hash}`);
  //     }

  //     const reserveUpdates = readReserveUpdateEvents(receipt, c.pool, batchAssets);
  //     const [pausedAfter, chainCompletedBatches, afterRates, block] = await Promise.all([
  //       c.pool.paused(),
  //       c.executor.completedBatches(),
  //       readReserveSnapshots(c.dp, batchAssets),
  //       provider.getBlock(receipt.blockNumber),
  //     ]);
  //     if (!pausedAfter) throw new Error(`Pool is not paused after Batch ${batch.id + 1}.`);
  //     completedBitmap = smallUintToNumber(chainCompletedBatches, 'completedBatches');
  //     if ((completedBitmap & (1 << batch.id)) === 0) {
  //       throw new Error(`Executor did not checkpoint Batch ${batch.id + 1} on chain.`);
  //     }

  //     for (const [symbol] of batchAssets) {
  //       const before = beforeRates[symbol];
  //       const after = afterRates[symbol];
  //       const eventUpdate = reserveUpdates[symbol];
  //       if (ethers.BigNumber.from(after.variableBorrowRate).gt(before.variableBorrowRate)) {
  //         throw new Error(
  //           `${symbol}: stored variable rate increased in Batch ${batch.id + 1} ` +
  //             `(before ${before.variableBorrowRate}, after ${after.variableBorrowRate})`
  //         );
  //       }
  //       for (const field of [
  //         'liquidityRate',
  //         'stableBorrowRate',
  //         'variableBorrowRate',
  //         'liquidityIndex',
  //         'variableBorrowIndex',
  //       ] as const) {
  //         if (after[field] !== eventUpdate[field]) {
  //           throw new Error(
  //             `${symbol}: ${field} does not match Batch ${batch.id + 1} event ` +
  //               `(${after[field]} != ${eventUpdate[field]})`
  //           );
  //         }
  //       }
  //     }

  //     saveCompletedBatch(state, batch.id, completedBitmap, {
  //       status: 'completed',
  //       contractBatchId: batch.id,
  //       batchNumber: batch.id + 1,
  //       symbols: batch.symbols,
  //       txHash: executeTx.hash,
  //       blockNumber: receipt.blockNumber,
  //       completedAt: block
  //         ? new Date(block.timestamp * 1000).toISOString()
  //         : new Date().toISOString(),
  //       poolPausedAfter: pausedAfter,
  //       beforeRates,
  //       afterRates,
  //       reserveDataUpdatedEvents: reserveUpdates,
  //     });
  //     saveExecution(state, {
  //       activeBatchId: null,
  //       activeBatchNumber: null,
  //       activeBatchTxHash: null,
  //     });
  //     console.log(`Batch ${batch.id + 1} completed. Bitmap is now ${completedBitmap}.`);
  //     await sleep(TX_DELAY_MS);
  //   }
  // } catch (error) {
  //   executionError = error;
  //   saveExecutionBestEffort(state, {
  //     completedBitmap,
  //     lastRunError: conciseRpcError(error),
  //   });
  // } finally {
  //   if (handoffSubmitted) {
  //     // Reads and rescue are best effort. Neither may prevent the unconditional
  //     // owner-driven restoration transaction below.
  //     let liveEmergencyAdmin: string | undefined;
  //     let poolPaused: boolean | undefined;
  //     try {
  //       liveEmergencyAdmin = await c.ap.getEmergencyAdmin();
  //     } catch (adminReadError: any) {
  //       console.error(
  //         'Could not read the emergency admin; proceeding with unconditional restoration:',
  //         conciseRpcError(adminReadError)
  //       );
  //       saveExecutionBestEffort(state, {
  //         recoveryAdminReadError: conciseRpcError(adminReadError),
  //       });
  //     }
  //     try {
  //       poolPaused = await c.pool.paused();
  //     } catch (pauseReadError: any) {
  //       console.error(
  //         'Could not read the pool pause state before restoration:',
  //         conciseRpcError(pauseReadError)
  //       );
  //       saveExecutionBestEffort(state, {
  //         recoveryPauseReadError: conciseRpcError(pauseReadError),
  //       });
  //     }

  //     try {
  //       if (
  //         poolPaused === false &&
  //         (!liveEmergencyAdmin || eq(liveEmergencyAdmin, state.executor))
  //       ) {
  //         console.error(
  //           'Pool observed open. Attempting executor pause-only rescue before role restoration.'
  //         );
  //         const rescueTx = await c.executor.pauseOnly();
  //         saveExecutionBestEffort(state, { pauseOnlyRescueTxHash: rescueTx.hash });
  //         await rescueTx.wait();
  //         await sleep(TX_DELAY_MS);
  //       } else {
  //         // Hedera relays can lag a mined transaction when deriving the next
  //         // nonce. Wait before the restoration transaction when no urgent
  //         // pause-only rescue is needed.
  //         await sleep(TX_DELAY_MS);
  //       }
  //     } catch (rescueError: any) {
  //       console.error('CRITICAL: executor pause-only rescue failed:', conciseRpcError(rescueError));
  //       saveExecutionBestEffort(state, {
  //         pauseOnlyRescueError: conciseRpcError(rescueError),
  //       });
  //     }

  //     console.log('Restoring original emergency admin...');
  //     try {
  //       const restoreTx = await c.ap.setEmergencyAdmin(state.originalEmergencyAdmin);
  //       saveExecutionBestEffort(state, { restoreTxHash: restoreTx.hash });
  //       await restoreTx.wait();
  //       await waitForAddress(
  //         'Emergency-admin restoration',
  //         () => c.ap.getEmergencyAdmin(),
  //         state.originalEmergencyAdmin
  //       );
  //       saveExecutionBestEffort(state, { restoreCompleted: true });
  //       await sleep(TX_DELAY_MS);
  //     } catch (restoreError: any) {
  //       // A relay may reject after accepting the signed transaction. Reconcile
  //       // the live role before declaring restoration failed.
  //       try {
  //         await waitForAddress(
  //           'Emergency-admin restoration reconciliation',
  //           () => c.ap.getEmergencyAdmin(),
  //           state.originalEmergencyAdmin
  //         );
  //         saveExecutionBestEffort(state, {
  //           restoreCompleted: true,
  //           restoreReconciledAfterError: conciseRpcError(restoreError),
  //         });
  //       } catch (reconciliationError: any) {
  //         saveExecutionBestEffort(state, {
  //           restoreCompleted: false,
  //           restoreError: conciseRpcError(restoreError),
  //           restoreReconciliationError: conciseRpcError(reconciliationError),
  //         });
  //         console.error(
  //           'CRITICAL: emergency-admin restoration failed. Manual owner action is required.'
  //         );
  //         throw restoreError;
  //       }
  //     }

  //     if (!(await c.pool.paused())) {
  //       console.error(
  //         'Pool still open after role restoration. Sending direct emergency-admin pause.'
  //       );
  //       const pauseTx = await c.configurator.setPoolPause(true);
  //       saveExecutionBestEffort(state, { fallbackPauseTxHash: pauseTx.hash });
  //       await pauseTx.wait();
  //     }
  //   } else {
  //     const liveEmergencyAdmin = await c.ap.getEmergencyAdmin();
  //     if (!eq(liveEmergencyAdmin, state.originalEmergencyAdmin)) {
  //       throw new Error(
  //         `CRITICAL: unexpected emergency admin ${liveEmergencyAdmin}; expected original EOA`
  //       );
  //     }
  //   }
  // }

  // const [finalProviderOwner, finalEmergencyAdmin, finalPoolAdmin, finalPaused] = await Promise.all([
  //   c.ap.owner(),
  //   c.ap.getEmergencyAdmin(),
  //   c.ap.getPoolAdmin(),
  //   c.pool.paused(),
  // ]);
  // if (!eq(finalProviderOwner, state.controller))
  //   throw new Error('AddressesProvider owner changed unexpectedly.');
  // if (!eq(finalEmergencyAdmin, state.originalEmergencyAdmin))
  //   throw new Error('Final emergency admin is incorrect.');
  // if (!eq(finalPoolAdmin, state.poolAdmin)) throw new Error('Pool admin changed unexpectedly.');
  // if (!finalPaused) throw new Error('Pool is not paused at final verification.');

  // if (executionError) throw executionError;
  // const finalCompletedBitmap = smallUintToNumber(
  //   await c.executor.completedBatches(),
  //   'completedBatches'
  // );
  // if (finalCompletedBitmap !== ALL_BATCHES_BITMAP) {
  //   throw new Error(
  //     `Execution ended without all batches complete: ${finalCompletedBitmap} != ${ALL_BATCHES_BITMAP}.`
  //   );
  // }
  // if (!(await c.executor.used())) throw new Error('Executor does not report complete use.');

  // const afterRates = await readReserveSnapshots(c.dp, c.assets);
  // for (const [symbol] of c.assets) {
  //   const before = c.beforeRates[symbol];
  //   const after = afterRates[symbol];

  //   if (ethers.BigNumber.from(after.variableBorrowRate).gt(before.variableBorrowRate)) {
  //     throw new Error(
  //       `${symbol}: stored variable rate increased (before ${before.variableBorrowRate}, after ${after.variableBorrowRate})`
  //     );
  //   }
  // }

  // const allReserves: string[] = await c.pool.getReservesList();
  // for (const asset of allReserves) {
  //   const cfg = await c.dp.getReserveConfigurationData(asset);
  //   if (!cfg.isFrozen) throw new Error(`Reserve ${asset} is no longer frozen.`);
  // }
  // saveExecution(state, {
  //   completed: true,
  //   completedBitmap: finalCompletedBitmap,
  //   completedAt: new Date().toISOString(),
  //   beforeRates: c.beforeRates,
  //   afterRates,
  //   lastRunError: null,
  // });
  // console.log('All atomic refresh batches completed and verified.');
  // console.log('Stored reserve rates after:', afterRates);
  // console.log('Pool paused:', finalPaused);
  // console.log('AddressesProvider owner unchanged:', finalProviderOwner);
  // console.log('Emergency admin restored:', finalEmergencyAdmin);
  // console.log('Pool admin unchanged:', finalPoolAdmin);
}

main().catch((error) => {
  console.error(conciseRpcError(error));
  process.exit(1);
});
