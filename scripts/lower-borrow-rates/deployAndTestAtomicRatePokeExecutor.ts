/**
 * Deploy and validate AtomicRatePokeExecutor without changing protocol roles.
 *
 * Mainnet deployment is disabled unless:
 *   CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR=DEPLOY
 *
 * This script never sets the emergency admin and never unpauses the pool.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

import {
  WHBAR,
  USDC,
  WETH,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';
import { withRetry } from './rpcRetry';

const CHAIN = process.env.CHAIN_TYPE || 'hedera_testnet';
if (CHAIN !== 'hedera_mainnet') {
  throw new Error(`Mainnet only. Set CHAIN_TYPE=hedera_mainnet (got ${CHAIN}).`);
}

const rpcUrl = process.env.PROVIDER_URL_MAINNET || '';
const adminKey = process.env.PRIVATE_KEY_MAINNET_ADMIN || '';
if (!rpcUrl || !adminKey)
  throw new Error('Missing mainnet provider or admin signer configuration.');

const provider = withRetry(new ethers.providers.JsonRpcProvider(rpcUrl));
const controller = new ethers.Wallet(adminKey, provider);
const STATE_PATH = path.join(__dirname, 'atomic-rate-poke-state.json');
const RATE_STATE_PATH = path.join(__dirname, 'rate-update-state.json');

const ADDRESSES = {
  provider: LendingPoolAddressesProvider.hedera_mainnet.address,
  pool: LendingPool.hedera_mainnet.address,
  configurator: LendingPoolConfigurator.hedera_mainnet.address,
  dataProvider: AaveProtocolDataProvider.hedera_mainnet.address,
  whbar: WHBAR.hedera_mainnet.token.address,
  usdc: USDC.hedera_mainnet.token.address,
  weth: WETH.hedera_mainnet.token.address,
};

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function contractAs(name: string, address: string, signerOrProvider: any) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}

async function preflight() {
  const ap = await contractAs('LendingPoolAddressesProvider', ADDRESSES.provider, provider);
  const pool = await contractAs('LendingPool', ADDRESSES.pool, provider);
  const dp = await contractAs('AaveProtocolDataProvider', ADDRESSES.dataProvider, provider);
  const [chainId, owner, emergencyAdmin, poolAdmin, livePool, liveConfigurator, paused] =
    await Promise.all([
      provider.getNetwork().then((n) => n.chainId),
      ap.owner(),
      ap.getEmergencyAdmin(),
      ap.getPoolAdmin(),
      ap.getLendingPool(),
      ap.getLendingPoolConfigurator(),
      pool.paused(),
    ]);

  if (chainId !== 295) throw new Error(`Wrong chain id: ${chainId}`);
  if (!eq(owner, controller.address))
    throw new Error(`Signer ${controller.address} is not provider owner ${owner}`);
  if (!eq(emergencyAdmin, controller.address)) {
    throw new Error(
      `Emergency admin is already ${emergencyAdmin}, not controller ${controller.address}`
    );
  }
  if (!eq(poolAdmin, controller.address))
    throw new Error(`Pool admin ${poolAdmin} differs from controller`);
  if (!eq(livePool, ADDRESSES.pool))
    throw new Error(`AddressesProvider pool mismatch: ${livePool}`);
  if (!eq(liveConfigurator, ADDRESSES.configurator)) {
    throw new Error(`AddressesProvider configurator mismatch: ${liveConfigurator}`);
  }
  if (!paused) throw new Error('Pool is not paused. Refusing deployment workflow.');

  const reserves: string[] = await pool.getReservesList();
  const notFrozen: string[] = [];
  for (const asset of reserves) {
    const cfg = await dp.getReserveConfigurationData(asset);
    if (!cfg.isFrozen) notFrozen.push(asset);
  }
  if (notFrozen.length) throw new Error(`Not all reserves are frozen: ${notFrozen.join(', ')}`);

  const rateState = JSON.parse(fs.readFileSync(RATE_STATE_PATH, 'utf8'));
  const strategies: Record<'WHBAR' | 'USDC' | 'WETH', string> = {
    WHBAR: '',
    USDC: '',
    WETH: '',
  };
  for (const [symbol, asset] of [
    ['WHBAR', ADDRESSES.whbar],
    ['USDC', ADDRESSES.usdc],
    ['WETH', ADDRESSES.weth],
  ] as const) {
    const expected = rateState.reserves?.[symbol]?.deploy?.address;
    if (!rateState.reserves?.[symbol]?.wire?.completed || !expected) {
      throw new Error(`${symbol}: strategy deployment/wiring state is incomplete`);
    }
    strategies[symbol] = expected;
    const reserve = await pool.getReserveData(asset);
    if (!eq(reserve.interestRateStrategyAddress, expected)) {
      throw new Error(
        `${symbol}: live strategy ${reserve.interestRateStrategyAddress} != ${expected}`
      );
    }
    const aTokenLiquidity = await new ethers.Contract(
      asset,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    ).balanceOf(reserve.aTokenAddress);
    if (aTokenLiquidity.lt(1)) throw new Error(`${symbol}: aToken has no underlying liquidity`);
  }

  console.log('Preflight passed: chain, owner/admin roles, pause, freezes, wiring, and liquidity.');
  return { owner, emergencyAdmin, poolAdmin, strategies };
}

async function validateDeployment(
  address: string,
  strategies: Record<'WHBAR' | 'USDC' | 'WETH', string>,
  expectedRuntimeHash?: string
) {
  const executor = await contractAs('AtomicRatePokeExecutor', address, controller);
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error('Executor has no runtime bytecode.');
  const runtimeHash = ethers.utils.keccak256(code);
  if (expectedRuntimeHash && runtimeHash !== expectedRuntimeHash) {
    throw new Error(`Runtime bytecode hash mismatch: ${runtimeHash} != ${expectedRuntimeHash}`);
  }

  const values = await Promise.all([
    executor.CONTROLLER(),
    executor.ADDRESSES_PROVIDER(),
    executor.LENDING_POOL(),
    executor.CONFIGURATOR(),
    executor.WHBAR(),
    executor.USDC(),
    executor.WETH(),
    executor.WHBAR_STRATEGY(),
    executor.USDC_STRATEGY(),
    executor.WETH_STRATEGY(),
    executor.used(),
  ]);
  const expected = [
    controller.address,
    ADDRESSES.provider,
    ADDRESSES.pool,
    ADDRESSES.configurator,
    ADDRESSES.whbar,
    ADDRESSES.usdc,
    ADDRESSES.weth,
    strategies.WHBAR,
    strategies.USDC,
    strategies.WETH,
  ];
  for (let i = 0; i < expected.length; i++) {
    if (!eq(values[i], expected[i]))
      throw new Error(`Immutable ${i} mismatch: ${values[i]} != ${expected[i]}`);
  }
  if (values[10] !== false) throw new Error('Fresh executor is unexpectedly marked used.');

  let rejectedForRole = false;
  try {
    await executor.callStatic.executeAtomicRefresh();
  } catch (error: any) {
    rejectedForRole = `${error?.message || error}`.includes('EXECUTOR: not emergency admin');
  }
  if (!rejectedForRole)
    throw new Error('Executor did not reject execution before emergency-admin handoff.');

  const pool = await contractAs('LendingPool', ADDRESSES.pool, provider);
  if (!(await pool.paused()))
    throw new Error('Pool changed from paused during deployment validation.');
  console.log(
    'Deployment validation passed: bytecode, immutables, one-shot state, role gate, and pause state.'
  );
  return runtimeHash;
}

async function main() {
  console.log('Chain:', CHAIN);
  console.log('Controller/deployer:', controller.address);
  const roles = await preflight();

  if (process.env.CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR !== 'DEPLOY') {
    console.log('Dry run only. Set CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR=DEPLOY to deploy.');
    return;
  }

  const factory = await ethers.getContractFactory('AtomicRatePokeExecutor', controller);
  const executor = await factory.deploy(
    ADDRESSES.provider,
    controller.address,
    ADDRESSES.whbar,
    ADDRESSES.usdc,
    ADDRESSES.weth,
    roles.strategies.WHBAR,
    roles.strategies.USDC,
    roles.strategies.WETH,
    { gasLimit: Number(process.env.ATOMIC_EXECUTOR_DEPLOY_GAS_LIMIT || 2_500_000) }
  );
  console.log('Deployment transaction:', executor.deployTransaction.hash);
  await executor.deployed();

  const runtimeBytecodeHash = await validateDeployment(executor.address, roles.strategies);
  const receipt = await executor.deployTransaction.wait();
  const state = {
    network: CHAIN,
    chainId: 295,
    deployedAt: new Date().toISOString(),
    executor: executor.address,
    deploymentTxHash: executor.deployTransaction.hash,
    deploymentBlock: receipt.blockNumber,
    runtimeBytecodeHash,
    controller: controller.address,
    originalEmergencyAdmin: roles.emergencyAdmin,
    poolAdmin: roles.poolAdmin,
    strategies: roles.strategies,
    addresses: ADDRESSES,
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  console.log('Executor:', executor.address);
  console.log('State file:', STATE_PATH);
  console.log('No protocol role was changed. The pool remains paused.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
