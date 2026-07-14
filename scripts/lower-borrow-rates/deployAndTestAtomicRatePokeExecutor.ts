/**
 * Deploy and validate AtomicRatePokeExecutor without changing protocol roles.
 *
 * Mainnet deployment is disabled unless:
 *   CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR=DEPLOY
 *
 * This script never sets the emergency admin and never unpauses the pool.
 *
 * The DEPLOY transaction is signed and paid by PRIVATE_KEY_MAINNET_PROXY (falls
 * back to PRIVATE_KEY_MAINNET_ADMIN if unset), so the protocol admin wallet does
 * not need to send it. The executor's CONTROLLER immutable and every recorded
 * role stay bound to the real on-chain admin (the AddressesProvider owner, read
 * from chain), keeping the deployment production-usable for the later
 * handoff/execute/restore flow. The admin private key is NOT required to deploy;
 * only the admin address, which is read from the AddressesProvider.
 */
import { ethers } from 'hardhat';
import { BigNumber, providers } from 'ethers';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
import {
  assertReviewedExecutorRuntime,
  reviewedExecutorDeploymentGasEstimate,
} from './atomicRatePokeVerification';
import {
  ASSET_BY_SYMBOL,
  EXECUTOR_STATE_PATH,
  MAINNET_CHAIN_ID,
  PROTOCOL_ADDRESSES,
  RATE_SYMBOLS,
  RATE_STATE_PATH,
  RateSymbol,
  StrategyMap,
  assertApprovedVariableCurve,
  assertMainnet,
} from './rateConfig';
import { contractAs, eqAddress, readJson, withRetry, writeJson } from './scriptUtils';

const CHAIN = process.env.CHAIN_TYPE || 'hedera_testnet';
assertMainnet(CHAIN);

const rpcUrl = process.env.PROVIDER_URL_MAINNET || '';
// The deploy tx is signed/paid by the proxy wallet so the admin shows no deploy
// tx. Falls back to the admin key if the proxy key is not set (prior behavior).
const deployerKey =
  process.env.PRIVATE_KEY_MAINNET_PROXY || process.env.PRIVATE_KEY_MAINNET_ADMIN || '';
if (!rpcUrl || !deployerKey)
  throw new Error(
    'Missing mainnet provider or deployer signer (set PRIVATE_KEY_MAINNET_PROXY or PRIVATE_KEY_MAINNET_ADMIN).'
  );

const provider = withRetry(new ethers.providers.JsonRpcProvider(rpcUrl));
// Signs and pays for the deployment only. It is NOT required to hold any
// protocol role; the executor's CONTROLLER is the real admin (read from chain).
const deployer = new ethers.Wallet(deployerKey, provider);
const PUBLIC_HASHIO_MAINNET_RPC = 'https://mainnet.hashio.io/api';

const ADDRESSES = {
  ...PROTOCOL_ADDRESSES,
  whbar: ASSET_BY_SYMBOL.WHBAR,
  usdc: ASSET_BY_SYMBOL.USDC,
  weth: ASSET_BY_SYMBOL.WETH,
  bonzo: ASSET_BY_SYMBOL.BONZO,
  hbarx: ASSET_BY_SYMBOL.HBARX,
};

const eq = eqAddress;

function conciseRpcError(error: any): string {
  const code = error?.error?.code || error?.code || 'unknown';
  const rawReason = String(
    error?.error?.data?.message ||
      error?.reason ||
      error?.error?.message ||
      error?.message ||
      'unknown RPC error'
  );
  const diagnosticText = [
    rawReason,
    error?.body,
    error?.error?.body,
    error?.error?.data?.message,
  ].join(' ');
  const knownReason = diagnosticText.match(
    /INSUFFICIENT_TX_FEE|insufficient transaction fee|transaction underpriced|max fee per gas less than block base fee/i
  )?.[0];
  // Avoid logging provider URLs, request payloads, or access tokens embedded in
  // verbose ethers SERVER_ERROR messages.
  const safeReason = knownReason || rawReason.split(' (requestBody=')[0].split(', url=')[0];
  return `code=${code} reason=${safeReason.slice(0, 240)}`;
}

async function estimateDeploymentGas(
  estimationProvider: providers.JsonRpcProvider,
  unsignedDeployment: providers.TransactionRequest,
  label: string
): Promise<BigNumber | undefined> {
  try {
    const [network, feeData] = await Promise.all([
      estimationProvider.getNetwork(),
      estimationProvider.getFeeData(),
    ]);
    if (network.chainId !== MAINNET_CHAIN_ID) {
      throw new Error(
        `${label} returned chain id ${network.chainId}, expected ${MAINNET_CHAIN_ID}`
      );
    }

    const baseRequest = {
      from: deployer.address,
      data: unsignedDeployment.data,
      value: 0,
    };
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      try {
        return await estimationProvider.estimateGas({
          ...baseRequest,
          type: 2,
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        });
      } catch (eip1559EstimateError: any) {
        console.warn(
          `${label} EIP-1559 estimate failed (${conciseRpcError(eip1559EstimateError)}).`
        );
      }
    }

    if (feeData.gasPrice) {
      try {
        return await estimationProvider.estimateGas({
          ...baseRequest,
          gasPrice: feeData.gasPrice,
        });
      } catch (legacyEstimateError: any) {
        console.warn(`${label} legacy estimate failed (${conciseRpcError(legacyEstimateError)}).`);
      }
    }
  } catch (providerError: any) {
    console.warn(`${label} estimator unavailable (${conciseRpcError(providerError)}).`);
  }
  return undefined;
}

async function preflight() {
  const ap = await contractAs(hre, 'LendingPoolAddressesProvider', ADDRESSES.provider, provider);
  const pool = await contractAs(hre, 'LendingPool', ADDRESSES.pool, provider);
  const dp = await contractAs(hre, 'AaveProtocolDataProvider', ADDRESSES.dataProvider, provider);
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

  if (chainId !== MAINNET_CHAIN_ID) throw new Error(`Wrong chain id: ${chainId}`);
  // The deployer does NOT need to hold any role. Instead, verify the real admin
  // holds all three roles (owner == emergency admin == pool admin). The owner is
  // adopted as the executor's CONTROLLER, so the later execute flow (which the
  // owner runs and which requires CONTROLLER == owner) stays valid.
  if (!eq(emergencyAdmin, owner)) {
    throw new Error(
      `Emergency admin ${emergencyAdmin} is not the AddressesProvider owner ${owner}`
    );
  }
  if (!eq(poolAdmin, owner))
    throw new Error(`Pool admin ${poolAdmin} is not the AddressesProvider owner ${owner}`);
  const controllerAddress = owner;
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

  const rateState = readJson(RATE_STATE_PATH);
  const strategies: StrategyMap = {
    WHBAR: '',
    USDC: '',
    WETH: '',
    BONZO: '',
    HBARX: '',
  };
  for (const symbol of RATE_SYMBOLS) {
    const asset = ASSET_BY_SYMBOL[symbol];
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
    const strategy = await contractAs(
      hre,
      'DefaultReserveInterestRateStrategy',
      expected,
      provider
    );
    await assertApprovedVariableCurve(symbol, strategy);
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
    const [aTokenLiquidity, aTokenSupply] = await Promise.all([
      underlying.balanceOf(reserve.aTokenAddress),
      aToken.totalSupply(),
    ]);
    if (aTokenLiquidity.lt(1)) throw new Error(`${symbol}: aToken has no underlying liquidity`);
    if (aTokenSupply.isZero()) throw new Error(`${symbol}: aToken total supply is zero`);
  }

  console.log(
    'Preflight passed: chain, owner/admin roles, pause, freezes, wiring, liquidity, and aToken supply.'
  );
  return { owner, emergencyAdmin, poolAdmin, controllerAddress, strategies };
}

async function validateDeployment(
  address: string,
  controllerAddress: string,
  strategies: StrategyMap
) {
  const executor = await contractAs(hre, 'AtomicRatePokeExecutor', address, provider);
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error('Executor has no runtime bytecode.');
  const reviewedRuntime = await assertReviewedExecutorRuntime(hre, code);

  const values = await Promise.all([
    executor.CONTROLLER(),
    executor.ADDRESSES_PROVIDER(),
    executor.LENDING_POOL(),
    executor.CONFIGURATOR(),
    executor.WHBAR(),
    executor.USDC(),
    executor.WETH(),
    executor.BONZO(),
    executor.HBARX(),
    executor.WHBAR_STRATEGY(),
    executor.USDC_STRATEGY(),
    executor.WETH_STRATEGY(),
    executor.BONZO_STRATEGY(),
    executor.HBARX_STRATEGY(),
    executor.used(),
  ]);
  const expected = [
    controllerAddress,
    ADDRESSES.provider,
    ADDRESSES.pool,
    ADDRESSES.configurator,
    ADDRESSES.whbar,
    ADDRESSES.usdc,
    ADDRESSES.weth,
    ADDRESSES.bonzo,
    ADDRESSES.hbarx,
    strategies.WHBAR,
    strategies.USDC,
    strategies.WETH,
    strategies.BONZO,
    strategies.HBARX,
  ];
  for (let i = 0; i < expected.length; i++) {
    if (!eq(values[i], expected[i]))
      throw new Error(`Immutable ${i} mismatch: ${values[i]} != ${expected[i]}`);
  }
  if (values[14] !== false) throw new Error('Fresh executor is unexpectedly marked used.');

  // Before the emergency-admin handoff the executor is NOT the emergency admin,
  // so executeAtomicRefresh must revert. Simulate AS the controller (via an
  // eth_call from-override, which needs no signature) so the call passes the
  // onlyController gate and reverts on the meaningful `EXECUTOR: not emergency
  // admin` check rather than the caller gate. Assert that it reverts at all; do
  // not depend on the revert-reason string, which the Hedera JSON-RPC relay does
  // not reliably surface (it often returns a bare CONTRACT_REVERT_EXECUTED). When
  // the reason IS present, confirm it is the expected role gate, but only warn.
  let reverted = false;
  let revertMessage = '';
  try {
    await executor.callStatic.executeAtomicRefresh({ from: controllerAddress });
  } catch (error: any) {
    reverted = true;
    revertMessage = `${error?.message || error}`;
  }
  if (!reverted)
    throw new Error('Executor did not reject executeAtomicRefresh before emergency-admin handoff.');
  if (revertMessage && !revertMessage.includes('EXECUTOR: not emergency admin')) {
    console.warn(
      `Pre-handoff execution reverted as expected, but with an unexpected reason: ${revertMessage}`
    );
  }

  const pool = await contractAs(hre, 'LendingPool', ADDRESSES.pool, provider);
  if (!(await pool.paused()))
    throw new Error('Pool changed from paused during deployment validation.');
  console.log(
    'Deployment validation passed: bytecode, immutables, one-shot state, role gate, and pause state.'
  );
  return reviewedRuntime;
}

async function main() {
  console.log('Chain:', CHAIN);
  console.log('Deployer (pays for deploy tx):', deployer.address);
  const roles = await preflight();
  console.log('Controller/admin (executor CONTROLLER, read from chain):', roles.controllerAddress);

  if (process.env.CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR !== 'DEPLOY') {
    console.log('Dry run only. Set CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR=DEPLOY to deploy.');
    return;
  }

  const constructorArguments = [
    ADDRESSES.provider,
    roles.controllerAddress,
    RATE_SYMBOLS.map((symbol) => ASSET_BY_SYMBOL[symbol]),
    RATE_SYMBOLS.map((symbol) => roles.strategies[symbol]),
  ];
  let executorAddress = '';
  let deploymentTxHash = '';
  let receipt: any;

  if (fs.existsSync(EXECUTOR_STATE_PATH)) {
    const existing = readJson(EXECUTOR_STATE_PATH);
    if (existing?.executor) {
      const existingCode = await provider.getCode(existing.executor);
      if (existingCode !== '0x') {
        let matchesCurrentExecutor = true;
        try {
          await assertReviewedExecutorRuntime(hre, existingCode);
        } catch {
          matchesCurrentExecutor = false;
        }
        if (!matchesCurrentExecutor) {
          const staleExecutor = await contractAs(
            hre,
            'AtomicRatePokeExecutor',
            existing.executor,
            provider
          );
          const ap = await contractAs(
            hre,
            'LendingPoolAddressesProvider',
            ADDRESSES.provider,
            provider
          );
          const [staleUsed, emergencyAdmin] = await Promise.all([
            staleExecutor.used(),
            ap.getEmergencyAdmin(),
          ]);
          if (staleUsed || eq(emergencyAdmin, existing.executor)) {
            throw new Error('Obsolete executor is used or still holds emergency admin.');
          }
        } else {
          if (existing.validated !== false || !existing.deploymentTxHash) {
            throw new Error(`Current executor already deployed at ${existing.executor}.`);
          }
          receipt = await provider.getTransactionReceipt(existing.deploymentTxHash);
          if (!receipt) {
            throw new Error(
              `Executor ${existing.executor} has code but deployment receipt ${existing.deploymentTxHash} is unavailable.`
            );
          }
          executorAddress = existing.executor;
          deploymentTxHash = existing.deploymentTxHash;
          console.log('Resuming interrupted executor validation:', executorAddress);
        }
      } else if (existing.deploymentTxHash) {
        const [existingReceipt, transaction] = await Promise.all([
          provider.getTransactionReceipt(existing.deploymentTxHash),
          provider.getTransaction(existing.deploymentTxHash),
        ]);
        if (!existingReceipt) {
          throw new Error(
            `Prior executor deployment ${existing.deploymentTxHash} has no receipt ` +
              `(transaction ${transaction ? 'is still visible' : 'is not currently visible'}). ` +
              `Do not deploy a replacement until it is reconciled.`
          );
        }
        if (existingReceipt?.status === 1) {
          throw new Error(
            `Prior executor deployment ${existing.deploymentTxHash} succeeded but its code is not ` +
              `visible yet. Do not deploy a replacement; wait for RPC propagation and rerun.`
          );
        }
        // A confirmed failed deployment is safe to replace. Its receipt stays
        // available on-chain and in Git history; the state file tracks only
        // the current executor attempt.
      }
    }
  }

  if (!executorAddress) {
    const factory = await ethers.getContractFactory('AtomicRatePokeExecutor', deployer);
    const unsignedDeployment = factory.getDeployTransaction(...constructorArguments);
    if (!unsignedDeployment.data) throw new Error('Executor deployment has no creation payload.');
    // Lock the compiled creation bytecode before broadcast. Constructor values
    // come from the live-checked addresses and approved rate-update state above.
    const reviewedGasEstimate = reviewedExecutorDeploymentGasEstimate(
      unsignedDeployment.data,
      factory.bytecode
    );
    // The configured relay can read and broadcast successfully but rejects
    // contract-creation eth_estimateGas calls. Use public Hashio solely for this
    // read-only estimate so that relay defect cannot block deployment.
    const publicHashioProvider = withRetry(
      new ethers.providers.JsonRpcProvider(PUBLIC_HASHIO_MAINNET_RPC),
      2
    );
    let estimatedGas = await estimateDeploymentGas(
      publicHashioProvider,
      unsignedDeployment,
      'Public Hashio RPC'
    );
    let estimateSource = 'public Hashio RPC';

    if (!estimatedGas) {
      estimatedGas = reviewedGasEstimate;
      estimateSource = 'reviewed bytecode-locked Hashio calibration';
    }

    const minimumSaneEstimate = reviewedGasEstimate.mul(95).div(100);
    const maximumSaneEstimate = reviewedGasEstimate.mul(105).div(100);
    if (estimatedGas.lt(minimumSaneEstimate) || estimatedGas.gt(maximumSaneEstimate)) {
      throw new Error(
        `Relay gas estimate ${estimatedGas.toString()} is outside 5% of the reviewed ` +
          `${reviewedGasEstimate.toString()} calibration. Refusing deployment.`
      );
    }

    const configuredGasLimit = process.env.ATOMIC_EXECUTOR_DEPLOY_GAS_LIMIT
      ? ethers.BigNumber.from(process.env.ATOMIC_EXECUTOR_DEPLOY_GAS_LIMIT)
      : undefined;
    // Hedera charges at least 80% of the supplied gas limit. Keep the automatic
    // headroom below 25% so the floor remains below the live estimate and does
    // not turn unused buffer into extra cost.
    const bufferedEstimate = estimatedGas.mul(110).div(100);
    if (configuredGasLimit && configuredGasLimit.lt(estimatedGas.mul(105).div(100))) {
      throw new Error(
        `ATOMIC_EXECUTOR_DEPLOY_GAS_LIMIT ${configuredGasLimit.toString()} is below the required ` +
          `5% safety buffer over estimate ${estimatedGas.toString()}.`
      );
    }
    const deploymentGasLimit = configuredGasLimit || bufferedEstimate;
    console.log(
      `Executor deployment gas: estimate=${estimatedGas.toString()} ` +
        `source=${estimateSource} limit=${deploymentGasLimit.toString()}.`
    );
    const executor = await factory.deploy(...constructorArguments, {
      gasLimit: deploymentGasLimit,
    });
    executorAddress = executor.address;
    deploymentTxHash = executor.deployTransaction.hash;
    console.log('Deployment transaction:', deploymentTxHash);

    // Persist as soon as the relay returns the deployment transaction. This
    // breadcrumb can be resumed if confirmation or validation is interrupted.
    writeJson(EXECUTOR_STATE_PATH, {
      network: CHAIN,
      chainId: MAINNET_CHAIN_ID,
      executor: executorAddress,
      deploymentTxHash,
      deployedAt: new Date().toISOString(),
      validated: false,
    });

    receipt = await executor.deployTransaction.wait();
  }

  if (receipt.status !== 1) throw new Error(`Executor deployment failed: ${deploymentTxHash}`);

  const reviewedRuntime = await validateDeployment(
    executorAddress,
    roles.controllerAddress,
    roles.strategies
  );
  const state = {
    network: CHAIN,
    chainId: MAINNET_CHAIN_ID,
    deployedAt: new Date().toISOString(),
    executor: executorAddress,
    deploymentTxHash,
    deploymentBlock: receipt.blockNumber,
    runtimeBytecodeHash: reviewedRuntime.runtimeBytecodeHash,
    reviewedRuntimeTemplateHash: reviewedRuntime.reviewedRuntimeTemplateHash,
    reviewedSourceHash: reviewedRuntime.reviewedSourceHash,
    controller: roles.controllerAddress,
    deployer: deployer.address,
    originalEmergencyAdmin: roles.emergencyAdmin,
    poolAdmin: roles.poolAdmin,
    strategies: roles.strategies,
    addresses: ADDRESSES,
  };
  writeJson(EXECUTOR_STATE_PATH, state);
  console.log('Executor:', executorAddress);
  console.log('State file:', EXECUTOR_STATE_PATH);
  console.log('No protocol role was changed. The pool remains paused.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
