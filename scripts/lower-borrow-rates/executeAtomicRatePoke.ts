/**
 * Emergency-admin handoff, atomic rate refresh, and mandatory restoration.
 *
 * Default behaviour is preflight only. State-changing execution requires:
 *   CONFIRM_ATOMIC_RATE_REFRESH=HANDOFF_EXECUTE_RESTORE
 *
 * Transactions:
 *   1. AddressesProvider owner -> setEmergencyAdmin(executor)
 *   2. Controller -> executor.executeAtomicRefresh()
 *      Internally: unpause -> three-asset mode-0 flash loan -> pause
 *   3. AddressesProvider owner -> setEmergencyAdmin(original EOA)
 *
 * Step 3 is attempted in finally after any submitted handoff, even if step 2 fails. If the pool is ever
 * observed open, the script first attempts executor.pauseOnly(), then restores
 * the EOA and attempts a direct emergency-admin pause if still necessary.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

import { withRetry } from './rpcRetry';
import {
  WHBAR,
  USDC,
  WETH,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';

const CHAIN = process.env.CHAIN_TYPE || 'hedera_testnet';
if (CHAIN !== 'hedera_mainnet') {
  throw new Error(`Mainnet only. Set CHAIN_TYPE=hedera_mainnet (got ${CHAIN}).`);
}

const rpcUrl = process.env.PROVIDER_URL_MAINNET || '';
const adminKey = process.env.PRIVATE_KEY_MAINNET_ADMIN || '';
if (!rpcUrl || !adminKey)
  throw new Error('Missing mainnet provider or admin signer configuration.');

const provider = withRetry(new ethers.providers.JsonRpcProvider(rpcUrl));
const owner = new ethers.Wallet(adminKey, provider);
const STATE_PATH = path.join(__dirname, 'atomic-rate-poke-state.json');
const RATE_STATE_PATH = path.join(__dirname, 'rate-update-state.json');
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 3000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const EXPECTED_ADDRESSES = {
  provider: LendingPoolAddressesProvider.hedera_mainnet.address,
  pool: LendingPool.hedera_mainnet.address,
  configurator: LendingPoolConfigurator.hedera_mainnet.address,
  dataProvider: AaveProtocolDataProvider.hedera_mainnet.address,
  whbar: WHBAR.hedera_mainnet.token.address,
  usdc: USDC.hedera_mainnet.token.address,
  weth: WETH.hedera_mainnet.token.address,
};

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
  runtimeBytecodeHash: string;
  controller: string;
  originalEmergencyAdmin: string;
  poolAdmin: string;
  strategies: Record<'WHBAR' | 'USDC' | 'WETH', string>;
  addresses: {
    provider: string;
    pool: string;
    configurator: string;
    dataProvider: string;
    whbar: string;
    usdc: string;
    weth: string;
  };
  execution?: Record<string, unknown>;
};

function loadState(): DeploymentState {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveExecution(state: DeploymentState, update: Record<string, unknown>) {
  state.execution = { ...(state.execution || {}), ...update, updatedAt: new Date().toISOString() };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function contractAs(name: string, address: string, signerOrProvider: any) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}

async function readRates(dp: any, assets: Array<[string, string]>) {
  const rates: Record<string, string> = {};
  for (const [symbol, asset] of assets) {
    rates[symbol] = (await dp.getReserveData(asset)).variableBorrowRate.toString();
  }
  return rates;
}

async function preflight(state: DeploymentState) {
  if (state.network !== CHAIN || state.chainId !== 295)
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
  const ap = await contractAs('LendingPoolAddressesProvider', a.provider, owner);
  const pool = await contractAs('LendingPool', a.pool, provider);
  const configurator = await contractAs('LendingPoolConfigurator', a.configurator, owner);
  const dp = await contractAs('AaveProtocolDataProvider', a.dataProvider, provider);
  const executor = await contractAs('AtomicRatePokeExecutor', state.executor, owner);

  const [
    network,
    providerOwner,
    emergencyAdmin,
    poolAdmin,
    livePool,
    liveConfigurator,
    paused,
    used,
    code,
  ] = await Promise.all([
    provider.getNetwork(),
    ap.owner(),
    ap.getEmergencyAdmin(),
    ap.getPoolAdmin(),
    ap.getLendingPool(),
    ap.getLendingPoolConfigurator(),
    pool.paused(),
    executor.used(),
    provider.getCode(state.executor),
  ]);

  if (network.chainId !== 295) throw new Error(`Wrong chain id: ${network.chainId}`);
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
  if (used) throw new Error('Executor has already been used.');
  if (code === '0x' || ethers.utils.keccak256(code) !== state.runtimeBytecodeHash) {
    throw new Error('Executor runtime bytecode is missing or does not match deployment state.');
  }

  const immutableChecks: Array<[string, string]> = [
    [await executor.CONTROLLER(), state.controller],
    [await executor.ADDRESSES_PROVIDER(), a.provider],
    [await executor.LENDING_POOL(), a.pool],
    [await executor.CONFIGURATOR(), a.configurator],
    [await executor.WHBAR(), a.whbar],
    [await executor.USDC(), a.usdc],
    [await executor.WETH(), a.weth],
    [await executor.WHBAR_STRATEGY(), state.strategies.WHBAR],
    [await executor.USDC_STRATEGY(), state.strategies.USDC],
    [await executor.WETH_STRATEGY(), state.strategies.WETH],
  ];
  for (const [actual, expected] of immutableChecks) {
    if (!eq(actual, expected))
      throw new Error(`Executor immutable mismatch: ${actual} != ${expected}`);
  }

  const reserves: string[] = await pool.getReservesList();
  const notFrozen: string[] = [];
  for (const asset of reserves) {
    const cfg = await dp.getReserveConfigurationData(asset);
    if (!cfg.isFrozen) notFrozen.push(asset);
  }
  if (notFrozen.length) throw new Error(`Not all reserves are frozen: ${notFrozen.join(', ')}`);

  const rateState = JSON.parse(fs.readFileSync(RATE_STATE_PATH, 'utf8'));
  const assets: Array<[string, string]> = [
    ['WHBAR', a.whbar],
    ['USDC', a.usdc],
    ['WETH', a.weth],
  ];
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
    const cfg = await dp.getReserveConfigurationData(asset);
    if (!cfg.isActive || !cfg.isFrozen || cfg.stableBorrowRateEnabled) {
      throw new Error(`${symbol}: expected active, frozen, and stable borrowing disabled`);
    }
    const liquidity = await new ethers.Contract(
      asset,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    ).balanceOf(reserve.aTokenAddress);
    if (liquidity.lt(1))
      throw new Error(`${symbol}: insufficient aToken liquidity for one atomic unit`);
  }

  const beforeRates = await readRates(dp, assets);
  console.log('Preflight passed. No transaction has been sent.');
  console.log('Stored variable rates before:', beforeRates);
  return { ap, pool, configurator, dp, executor, assets, beforeRates };
}

async function main() {
  const state = loadState();
  console.log('Chain:', CHAIN);
  console.log('AddressesProvider owner/controller:', owner.address);
  console.log('Executor:', state.executor);
  const c = await preflight(state);

  if (process.env.CONFIRM_ATOMIC_RATE_REFRESH !== 'HANDOFF_EXECUTE_RESTORE') {
    console.log(
      'Dry run only. Set CONFIRM_ATOMIC_RATE_REFRESH=HANDOFF_EXECUTE_RESTORE to perform the three transactions.'
    );
    return;
  }

  let executionError: unknown;
  let handoffSubmitted = false;
  try {
    console.log('1/3 Assigning emergency admin to executor...');
    const handoffTx = await c.ap.setEmergencyAdmin(state.executor);
    handoffSubmitted = true;
    saveExecution(state, { startedAt: new Date().toISOString(), handoffTxHash: handoffTx.hash });
    await handoffTx.wait();
    saveExecution(state, { handoffMined: true });
    await waitForAddress('Emergency-admin handoff', () => c.ap.getEmergencyAdmin(), state.executor);
    saveExecution(state, { handoffCompleted: true });
    await sleep(TX_DELAY_MS);

    console.log('2/3 Executing atomic unpause -> rate refresh -> pause...');
    const executeTx = await c.executor.executeAtomicRefresh({
      gasLimit: Number(process.env.ATOMIC_EXECUTOR_EXECUTE_GAS_LIMIT || 6_000_000),
    });
    saveExecution(state, { executeTxHash: executeTx.hash });
    const executeReceipt = await executeTx.wait();
    if (executeReceipt.status !== 1)
      throw new Error(`Execution transaction failed: ${executeTx.hash}`);
    if (!(await c.pool.paused())) throw new Error('Pool is not paused after atomic execution.');
    if (!(await c.executor.used()))
      throw new Error('Executor did not record successful one-shot use.');
    saveExecution(state, { executeCompleted: true, executeBlock: executeReceipt.blockNumber });
  } catch (error) {
    executionError = error;
    saveExecution(state, { executeCompleted: false, error: `${(error as any)?.message || error}` });
  } finally {
    // A submitted handoff is always paired with a restoration transaction,
    // even if receipt or role reads fail after the handoff was accepted.
    const liveEmergencyAdmin = await c.ap.getEmergencyAdmin();
    if (handoffSubmitted) {
      try {
        if (eq(liveEmergencyAdmin, state.executor) && !(await c.pool.paused())) {
          console.error(
            'Pool observed open. Attempting executor pause-only rescue before role restoration.'
          );
          const rescueTx = await c.executor.pauseOnly();
          saveExecution(state, { pauseOnlyRescueTxHash: rescueTx.hash });
          await rescueTx.wait();
          await sleep(TX_DELAY_MS);
        } else {
          // Hedera relays can lag a mined transaction when deriving the next
          // nonce. Wait before the restoration transaction when no urgent
          // pause-only rescue is needed.
          await sleep(TX_DELAY_MS);
        }
      } catch (rescueError: any) {
        console.error(
          'CRITICAL: executor pause-only rescue failed:',
          rescueError?.message || rescueError
        );
        saveExecution(state, { pauseOnlyRescueError: `${rescueError?.message || rescueError}` });
      }

      console.log('3/3 Restoring original emergency admin...');
      try {
        const restoreTx = await c.ap.setEmergencyAdmin(state.originalEmergencyAdmin);
        saveExecution(state, { restoreTxHash: restoreTx.hash });
        await restoreTx.wait();
        await waitForAddress(
          'Emergency-admin restoration',
          () => c.ap.getEmergencyAdmin(),
          state.originalEmergencyAdmin
        );
        saveExecution(state, { restoreCompleted: true });
        await sleep(TX_DELAY_MS);
      } catch (restoreError: any) {
        saveExecution(state, {
          restoreCompleted: false,
          restoreError: `${restoreError?.message || restoreError}`,
        });
        console.error(
          'CRITICAL: emergency-admin restoration failed. Manual owner action is required.'
        );
        throw restoreError;
      }

      if (!(await c.pool.paused())) {
        console.error(
          'Pool still open after role restoration. Sending direct emergency-admin pause.'
        );
        const pauseTx = await c.configurator.setPoolPause(true);
        saveExecution(state, { fallbackPauseTxHash: pauseTx.hash });
        await pauseTx.wait();
      }
    } else if (!eq(liveEmergencyAdmin, state.originalEmergencyAdmin)) {
      throw new Error(
        `CRITICAL: unexpected emergency admin ${liveEmergencyAdmin}; expected executor or original EOA`
      );
    }
  }

  const finalEmergencyAdmin = await c.ap.getEmergencyAdmin();
  const finalPoolAdmin = await c.ap.getPoolAdmin();
  const finalPaused = await c.pool.paused();
  if (!eq(finalEmergencyAdmin, state.originalEmergencyAdmin))
    throw new Error('Final emergency admin is incorrect.');
  if (!eq(finalPoolAdmin, state.poolAdmin)) throw new Error('Pool admin changed unexpectedly.');
  if (!finalPaused) throw new Error('Pool is not paused at final verification.');

  if (executionError) throw executionError;

  const afterRates = await readRates(c.dp, c.assets);
  for (const [symbol] of c.assets) {
    if (!ethers.BigNumber.from(afterRates[symbol]).lt(c.beforeRates[symbol])) {
      throw new Error(`${symbol}: stored variable rate did not decrease`);
    }
  }
  for (const [, asset] of c.assets) {
    const cfg = await c.dp.getReserveConfigurationData(asset);
    if (!cfg.isFrozen) throw new Error(`Reserve ${asset} is no longer frozen.`);
  }
  saveExecution(state, {
    completed: true,
    completedAt: new Date().toISOString(),
    beforeRates: c.beforeRates,
    afterRates,
  });
  console.log('Atomic refresh completed and verified.');
  console.log('Stored variable rates after:', afterRates);
  console.log('Pool paused:', finalPaused);
  console.log('Emergency admin restored:', finalEmergencyAdmin);
  console.log('Pool admin unchanged:', finalPoolAdmin);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
