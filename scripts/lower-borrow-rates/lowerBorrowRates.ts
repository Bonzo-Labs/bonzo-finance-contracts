/**
 * Lower Borrow Rates: WHBAR / WETH / USDC / BONZO / HBARX (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Reduces variableRateSlope1 and variableRateSlope2 for the WHBAR, WETH, USDC,
 * BONZO and HBARX reserves by deploying a fresh DefaultReserveInterestRateStrategy per
 * reserve (slopes are immutable, so they cannot be mutated in place) and
 * wiring it to the reserve via setReserveInterestRateStrategyAddress().
 *
 * SAFE WHILE PAUSED: setReserveInterestRateStrategyAddress is a pool-admin
 * action on the LendingPoolConfigurator (onlyPoolAdmin) -> LendingPool
 * (onlyLendingPoolConfigurator). Neither hop carries whenNotPaused, so this
 * runs with the protocol paused. No unpause is required, and none is done here.
 *
 * DESIGN:
 *  - The current strategy address is read live from LendingPool.getReserveData
 *    (the outputReserveData.json manifest is stale for these reserves).
 *  - All non-slope params (optimalUtilization, base, stableRateSlope1/2) are
 *    read from the current on-chain strategy and preserved byte-for-byte.
 *  - Only variableRateSlope1 / variableRateSlope2 are overridden with the
 *    TARGETS below.
 *  - A guard rejects any target that is not a genuine reduction (new must be
 *    <= current for both slopes, and strictly < for at least one).
 *
 * Step-gated in main(): deploy + wire each reserve independently, verifying
 * between steps. Deployed addresses + tx hashes are recorded in
 * rate-update-state.json and read back by the built-in verify action.
 *
 * Admin key: PRIVATE_KEY_MAINNET_ADMIN (pool admin) + MAINNET_ADMIN_ACCOUNT_ID.
 */
import { ethers } from 'hardhat';
import { BigNumberish } from 'ethers';
const hre = require('hardhat');
require('dotenv').config();

import { ContractCreateFlow, ContractFunctionParameters, Hbar } from '@hashgraph/sdk';
const { Client, PrivateKey, AccountId } = require('@hashgraph/sdk');
import BigNumber from 'bignumber.js';

import { oneRay } from '../../helpers/constants';
import {
  ASSET_BY_SYMBOL,
  PROTOCOL_ADDRESSES,
  RATE_STATE_PATH,
  TARGET_BASE_VARIABLE_RATE_DECIMAL,
  TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
  RATE_SYMBOLS,
  RateSymbol,
  assertApprovedVariableCurve,
  assertMainnet,
} from './rateConfig';
import { contractAs, readJson, recordRateUpdateStep, withRetry, writeJson } from './scriptUtils';

// --------------------------------------------------------------------------
// Network guard - mainnet only.
// --------------------------------------------------------------------------
const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
assertMainnet(chain_type);

const provider = withRetry(
  new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '')
);
const owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

// --------------------------------------------------------------------------
// APPROVED TARGET CURVE (exact decimal strings; 0.00005 = 0.005%). The base
// and both variable slopes are fixed centrally in rateConfig.ts. Optimal
// utilization and stable slopes are preserved from the live strategy.
//
// The currently wired intermediate strategies use base 0%, slope1 1%, and
// slope2 1%. This replacement run reduces each reserve to base 0%, slope1
// 0.005%, and slope2 0.005%, for a maximum variable rate of 0.01%.
// --------------------------------------------------------------------------
type Target = {
  newVariableRateSlope1: string;
  newVariableRateSlope2: string;
  newBaseVariableBorrowRate: string;
};

const TARGETS: Record<RateSymbol, Target> = {
  WHBAR: {
    newVariableRateSlope1: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newVariableRateSlope2: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newBaseVariableBorrowRate: TARGET_BASE_VARIABLE_RATE_DECIMAL,
  },
  USDC: {
    newVariableRateSlope1: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newVariableRateSlope2: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newBaseVariableBorrowRate: TARGET_BASE_VARIABLE_RATE_DECIMAL,
  },
  WETH: {
    newVariableRateSlope1: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newVariableRateSlope2: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newBaseVariableBorrowRate: TARGET_BASE_VARIABLE_RATE_DECIMAL,
  },
  BONZO: {
    newVariableRateSlope1: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newVariableRateSlope2: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newBaseVariableBorrowRate: TARGET_BASE_VARIABLE_RATE_DECIMAL,
  },
  HBARX: {
    newVariableRateSlope1: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newVariableRateSlope2: TARGET_VARIABLE_RATE_SLOPE_DECIMAL,
    newBaseVariableBorrowRate: TARGET_BASE_VARIABLE_RATE_DECIMAL,
  },
};

// --------------------------------------------------------------------------
// State file (deployed addresses, preserved params, tx hashes).
// --------------------------------------------------------------------------
const EMPTY_RUNTIME_HASH = ethers.utils.keccak256('0x');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadState() {
  return readJson(RATE_STATE_PATH);
}
function saveStepState(symbol: string, phase: 'deploy' | 'wire', data: Record<string, unknown>) {
  const state = loadState();
  // A replacement deployment invalidates the previous wire record. Keep the
  // audit trail, but do not let downstream scripts mistake old wiring for the
  // newly deployed strategy.
  recordRateUpdateStep(state, symbol, phase, data);
  writeJson(RATE_STATE_PATH, state);
}

function saveReconciledRuntimeHash(symbol: string, address: string, runtimeBytecodeHash: string) {
  const state = loadState();
  const deploy = state.reserves?.[symbol]?.deploy;
  if (!deploy || deploy.address?.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`${symbol}: deployment state changed while reconciling runtime bytecode`);
  }
  deploy.runtimeBytecodeHash = runtimeBytecodeHash;
  deploy.runtimeBytecodeObservedAt = new Date().toISOString();
  deploy.runtimeBytecodeStatus = 'confirmed';
  writeJson(RATE_STATE_PATH, state);
}

async function waitForRuntimeCode(address: string, attempts = 30) {
  let previousCode = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const code = await provider.getCode(address);
    if (code !== '0x') {
      if (code === previousCode) return code;
      previousCode = code;
    } else {
      previousCode = '';
    }
    if (attempt < attempts) await sleep(2000);
  }
  throw new Error(
    `Runtime bytecode for ${address} did not become stable after ${attempts} attempts. ` +
      `The deployment may still have succeeded; reconcile it before deploying a replacement.`
  );
}

const toRay = (dec: string) => new BigNumber(dec).multipliedBy(oneRay).toFixed(0);
const rayToPct = (ray: BigNumberish) =>
  `${new BigNumber(ray.toString()).dividedBy(oneRay).multipliedBy(100).toFixed(3)}%`;

async function setupContract(artifactName: string, contractAddress: string) {
  return contractAs(hre, artifactName, contractAddress, owner);
}
// Read-only (through provider). Hedera's relay resolves eth_call `from` against
// a real account; owner's derived EVM address isn't indexed, so views go here.
async function setupReadOnlyContract(artifactName: string, contractAddress: string) {
  return contractAs(hre, artifactName, contractAddress, provider);
}
async function configurator() {
  return setupContract('LendingPoolConfigurator', PROTOCOL_ADDRESSES.configurator);
}

// Read the live strategy address + its six parameters for a reserve.
async function readLiveStrategy(symbol: RateSymbol) {
  const asset = ASSET_BY_SYMBOL[symbol];
  const pool = await setupReadOnlyContract('LendingPool', PROTOCOL_ADDRESSES.pool);
  const reserveData = await pool.getReserveData(asset);
  const strategyAddress: string = reserveData.interestRateStrategyAddress;
  const strat = await setupReadOnlyContract('DefaultReserveInterestRateStrategy', strategyAddress);
  const [optimal, base, vSlope1, vSlope2, sSlope1, sSlope2] = await Promise.all([
    strat.OPTIMAL_UTILIZATION_RATE(),
    strat.baseVariableBorrowRate(),
    strat.variableRateSlope1(),
    strat.variableRateSlope2(),
    strat.stableRateSlope1(),
    strat.stableRateSlope2(),
  ]);
  return {
    asset,
    strategyAddress,
    optimal: optimal.toString(),
    base: base.toString(),
    vSlope1: vSlope1.toString(),
    vSlope2: vSlope2.toString(),
    sSlope1: sSlope1.toString(),
    sSlope2: sSlope2.toString(),
  };
}

async function printCurrent(symbol: RateSymbol) {
  const s = await readLiveStrategy(symbol);
  console.log(`\n=== ${symbol} current interest-rate strategy ===`);
  console.log('Asset:              ', s.asset);
  console.log('Strategy:           ', s.strategyAddress);
  console.log('optimalUtilization: ', rayToPct(s.optimal));
  console.log('baseVariableBorrow: ', rayToPct(s.base));
  console.log('variableRateSlope1: ', rayToPct(s.vSlope1));
  console.log('variableRateSlope2: ', rayToPct(s.vSlope2));
  console.log('stableRateSlope1:   ', rayToPct(s.sSlope1));
  console.log('stableRateSlope2:   ', rayToPct(s.sSlope2));
  // Reserve-level flag (independent of the strategy's stable slopes) - must be off.
  const dp = await setupReadOnlyContract(
    'AaveProtocolDataProvider',
    PROTOCOL_ADDRESSES.dataProvider
  );
  const cfg = await dp.getReserveConfigurationData(s.asset);
  console.log(
    'stableBorrowRateEnabled:',
    cfg.stableBorrowRateEnabled,
    cfg.stableBorrowRateEnabled ? '  ⚠️  SHOULD BE OFF' : ''
  );
  console.log('==========================================\n');
}

// --------------------------------------------------------------------------
// Deploy a new strategy for `symbol`: preserve all params, override slopes.
// --------------------------------------------------------------------------
async function deployNewStrategy(symbol: RateSymbol) {
  const live = await readLiveStrategy(symbol);
  const target = TARGETS[symbol];

  const newV1 = toRay(target.newVariableRateSlope1);
  const newV2 = toRay(target.newVariableRateSlope2);
  const newBase = toRay(target.newBaseVariableBorrowRate);

  // Guard: reject anything that is not a genuine reduction (never increase).
  const curV1 = ethers.BigNumber.from(live.vSlope1);
  const curV2 = ethers.BigNumber.from(live.vSlope2);
  const curBase = ethers.BigNumber.from(live.base);
  const nV1 = ethers.BigNumber.from(newV1);
  const nV2 = ethers.BigNumber.from(newV2);
  const nBase = ethers.BigNumber.from(newBase);
  if (nV1.gt(curV1) || nV2.gt(curV2) || nBase.gt(curBase)) {
    throw new Error(
      `${symbol}: targets must not INCREASE. ` +
        `current base=${rayToPct(curBase)} s1=${rayToPct(curV1)} s2=${rayToPct(curV2)}; ` +
        `target base=${rayToPct(nBase)} s1=${rayToPct(nV1)} s2=${rayToPct(nV2)}. Edit TARGETS.`
    );
  }
  if (nV1.eq(curV1) && nV2.eq(curV2) && nBase.eq(curBase)) {
    throw new Error(
      `${symbol}: targets equal current (no reduction configured). Edit TARGETS[${symbol}].`
    );
  }

  const deploymentArgs = {
    provider: PROTOCOL_ADDRESSES.provider,
    optimalUtilizationRate: live.optimal, // preserved
    baseVariableBorrowRate: newBase, // override or preserved
    variableRateSlope1: newV1, // NEW
    variableRateSlope2: newV2, // NEW
    stableRateSlope1: live.sSlope1, // preserved
    stableRateSlope2: live.sSlope2, // preserved
  };
  console.log(`\nDeploying new ${symbol} strategy:`);
  console.log(`  baseVariableBorrowRate: ${rayToPct(curBase)} -> ${rayToPct(newBase)}`);
  console.log(`  variableRateSlope1: ${rayToPct(curV1)} -> ${rayToPct(newV1)}`);
  console.log(`  variableRateSlope2: ${rayToPct(curV2)} -> ${rayToPct(newV2)}`);
  console.log('  (optimalUtilization + stable slopes preserved from', live.strategyAddress + ')');

  const artifact = await hre.artifacts.readArtifact('DefaultReserveInterestRateStrategy');
  const functionParameters = new ContractFunctionParameters()
    .addAddress(deploymentArgs.provider)
    .addUint256(deploymentArgs.optimalUtilizationRate)
    .addUint256(deploymentArgs.baseVariableBorrowRate)
    .addUint256(deploymentArgs.variableRateSlope1)
    .addUint256(deploymentArgs.variableRateSlope2)
    .addUint256(deploymentArgs.stableRateSlope1)
    .addUint256(deploymentArgs.stableRateSlope2);

  const client = Client.forMainnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_MAINNET_ADMIN!);
  const operatorAccountId = AccountId.fromString(process.env.MAINNET_ADMIN_ACCOUNT_ID!);
  client.setOperator(operatorAccountId, operatorPrKey);
  client.setDefaultMaxTransactionFee(new Hbar(20));

  // Gas: this deploy uses ~791k gas. Hedera charges max(gasUsed, 80% * gasLimit),
  // so an oversized limit is pure waste - 2,000,000 charged for 1,600,000 gas
  // (~15 HBAR) vs ~7.6 HBAR when the 80% floor stays below actual usage. Keep the
  // limit in [~800k, ~988k]: high enough not to run out, low enough that
  // 0.8*limit <= actual so you pay for actual usage only.
  const contractCreateTx = new ContractCreateFlow()
    .setGas(950_000)
    .setBytecode(artifact.bytecode)
    .setConstructorParameters(functionParameters);

  const response = await contractCreateTx.execute(client);
  const record = await response.getRecord(client);
  const receipt = record.receipt;
  const newContractId = receipt.contractId;
  if (!newContractId) {
    throw new Error('Failed to retrieve new contract ID from receipt');
  }
  const address = `0x${newContractId.toSolidityAddress()}`;
  console.log(
    `Deployed ${symbol} strategy. Contract ID=${newContractId.toString()} EVM=${address}`
  );

  // Hedera JSON-RPC can briefly return 0x after a successful SDK deployment.
  // Hash only after two consecutive non-empty reads agree; hashing 0x would
  // record the empty-code hash and incorrectly block the later wire step.
  const runtimeCode = await waitForRuntimeCode(address);
  const runtimeBytecodeHash = ethers.utils.keccak256(runtimeCode);

  saveStepState(symbol, 'deploy', {
    network: chain_type,
    addressesProvider: PROTOCOL_ADDRESSES.provider,
    address,
    contractId: newContractId.toString(),
    evmAddress: address,
    hederaTxId: response.transactionId?.toString() ?? null,
    consensusTimestamp: record.consensusTimestamp?.toString() ?? null,
    deployerAccountId: operatorAccountId.toString(),
    deployerEvm: owner.address,
    runtimeBytecodeHash,
    runtimeBytecodeObservedAt: new Date().toISOString(),
    runtimeBytecodeStatus: 'confirmed',
    constructorParams: {
      provider: deploymentArgs.provider,
      optimalUtilizationRate: deploymentArgs.optimalUtilizationRate,
      baseVariableBorrowRate: deploymentArgs.baseVariableBorrowRate,
      variableRateSlope1: deploymentArgs.variableRateSlope1,
      variableRateSlope2: deploymentArgs.variableRateSlope2,
      stableRateSlope1: deploymentArgs.stableRateSlope1,
      stableRateSlope2: deploymentArgs.stableRateSlope2,
    },
    preserved: {
      optimalUtilizationRate: live.optimal,
      baseVariableBorrowRate: newBase, // deployed base (override or preserved)
      stableRateSlope1: live.sSlope1,
      stableRateSlope2: live.sSlope2,
    },
    target: {
      variableRateSlope1: newV1,
      variableRateSlope2: newV2,
      baseVariableBorrowRate: newBase,
    },
    previousStrategy: live.strategyAddress,
    timestamp: new Date().toISOString(),
  });
  console.log(`>> Recorded in ${RATE_STATE_PATH}. Run the wire step next.`);
}

// --------------------------------------------------------------------------
// Validate a deployed strategy end-to-end BEFORE trusting the state-file
// address enough to wire it into a live reserve. A wrong or tampered address
// could point a reserve at a contract that reverts on every interaction.
// --------------------------------------------------------------------------
async function validateDeployedStrategy(symbol: RateSymbol) {
  const state = loadState();
  const entry = state.reserves?.[symbol]?.deploy;
  if (!entry?.address) {
    throw new Error(
      `No deployed strategy for ${symbol}. Run deployNewStrategy('${symbol}') first.`
    );
  }
  const deployed: string = entry.address;

  // (a) state entry belongs to this network + deployment.
  if (entry.network && entry.network !== chain_type) {
    throw new Error(`${symbol}: state entry network ${entry.network} != ${chain_type}.`);
  }
  const liveProvider = PROTOCOL_ADDRESSES.provider;
  if (
    entry.addressesProvider &&
    entry.addressesProvider.toLowerCase() !== liveProvider.toLowerCase()
  ) {
    throw new Error(
      `${symbol}: state addressesProvider ${entry.addressesProvider} != ${liveProvider}.`
    );
  }

  // (b) address has contract bytecode, and it matches the recorded hash.
  const code = await provider.getCode(deployed);
  if (!code || code === '0x') {
    throw new Error(`${symbol}: deployed address ${deployed} has no bytecode.`);
  }
  const runtimeBytecodeHash = ethers.utils.keccak256(code);
  const needsRuntimeHashReconciliation =
    !entry.runtimeBytecodeHash || entry.runtimeBytecodeHash === EMPTY_RUNTIME_HASH;
  if (!needsRuntimeHashReconciliation) {
    if (runtimeBytecodeHash.toLowerCase() !== entry.runtimeBytecodeHash.toLowerCase()) {
      throw new Error(`${symbol}: runtime bytecode hash mismatch (tampered address?).`);
    }
  }

  // (c) on-chain params match intent, incl. the addresses provider it points at.
  const strat = await setupReadOnlyContract('DefaultReserveInterestRateStrategy', deployed);
  const [ap, optimal, base, vSlope1, vSlope2, sSlope1, sSlope2] = await Promise.all([
    strat.addressesProvider(),
    strat.OPTIMAL_UTILIZATION_RATE(),
    strat.baseVariableBorrowRate(),
    strat.variableRateSlope1(),
    strat.variableRateSlope2(),
    strat.stableRateSlope1(),
    strat.stableRateSlope2(),
  ]);
  const eq = (a: unknown, b: unknown) => a?.toString() === b?.toString();
  if (ap.toLowerCase() !== liveProvider.toLowerCase()) {
    throw new Error(`${symbol}: strategy.addressesProvider ${ap} != live ${liveProvider}.`);
  }
  const checks: Array<[string, unknown, unknown]> = [
    ['optimalUtilizationRate', optimal, entry.preserved.optimalUtilizationRate],
    ['baseVariableBorrowRate', base, entry.target.baseVariableBorrowRate],
    ['variableRateSlope1', vSlope1, entry.target.variableRateSlope1],
    ['variableRateSlope2', vSlope2, entry.target.variableRateSlope2],
    ['stableRateSlope1', sSlope1, entry.preserved.stableRateSlope1],
    ['stableRateSlope2', sSlope2, entry.preserved.stableRateSlope2],
  ];
  for (const [label, actual, expected] of checks) {
    if (!eq(actual, expected)) {
      throw new Error(`${symbol}: ${label} on-chain=${actual} expected=${expected}.`);
    }
  }

  await assertApprovedVariableCurve(symbol, strat);

  if (needsRuntimeHashReconciliation) {
    saveReconciledRuntimeHash(symbol, deployed, runtimeBytecodeHash);
    console.log(
      `✅ ${symbol} replaced an empty/pending runtime hash with confirmed on-chain hash ${runtimeBytecodeHash}.`
    );
  }

  // (d) it must actually differ from the reserve's current strategy.
  const live = await readLiveStrategy(symbol);
  if (live.strategyAddress.toLowerCase() === deployed.toLowerCase()) {
    throw new Error(`${symbol}: deployed strategy equals current live strategy (nothing to wire).`);
  }
  console.log(`✅ ${symbol} deployed strategy ${deployed} validated (params, provider, bytecode).`);
  return { deployed, asset: ASSET_BY_SYMBOL[symbol], preSwapStrategy: live.strategyAddress };
}

// --------------------------------------------------------------------------
// Wire the newly deployed strategy to the reserve (after full validation).
// Also snapshots the reserve's stored borrow/liquidity rate at wire time -
// still the OLD rate, since swapping the strategy does not refresh it - so the
// poke preflight can detect any unexpected change during the pause.
// --------------------------------------------------------------------------
async function wireStrategy(symbol: RateSymbol) {
  const { deployed, asset, preSwapStrategy } = await validateDeployedStrategy(symbol);

  const dp = await setupReadOnlyContract(
    'AaveProtocolDataProvider',
    PROTOCOL_ADDRESSES.dataProvider
  );
  const before = await dp.getReserveData(asset);

  // The strategy swap does NOT touch stableBorrowRateEnabled, but surface it -
  // we want stable borrowing OFF everywhere.
  const cfg = await dp.getReserveConfigurationData(asset);
  if (cfg.stableBorrowRateEnabled) {
    console.warn(
      `⚠️  ${symbol}: stableBorrowRateEnabled is TRUE. This swap does not change it, ` +
        `but stable borrowing should be OFF - disable via configurator.disableReserveStableRate.`
    );
  }

  const c = await configurator();
  console.log(`Wiring ${symbol} (${asset}): ${preSwapStrategy} -> ${deployed} ...`);
  const txn = await c.setReserveInterestRateStrategyAddress(asset, deployed);
  const receipt = await txn.wait();
  console.log(`${symbol} interest-rate strategy updated. tx=${receipt.transactionHash}`);
  saveStepState(symbol, 'wire', {
    txHash: receipt.transactionHash,
    fromStrategy: preSwapStrategy,
    toStrategy: deployed,
    storedRateSnapshot: {
      variableBorrowRate: before.variableBorrowRate.toString(),
      liquidityRate: before.liquidityRate.toString(),
    },
    timestamp: new Date().toISOString(),
  });
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Pool admin signer:', owner.address);
  console.log('LendingPool:', PROTOCOL_ADDRESSES.pool);

  // Inspect every target reserve before touching anything.
  for (const symbol of RATE_SYMBOLS) await printCurrent(symbol);

  // Run one step at a time by uncommenting exactly one call. After deploying,
  // run this script again with the matching wire call uncommented. Then run
  // verifyBorrowRates.ts before moving to the next reserve.

  // --- WHBAR ---
  // await deployNewStrategy('WHBAR');
  // await wireStrategy('WHBAR');

  // --- USDC ---
  // await deployNewStrategy('USDC');
  // await wireStrategy('USDC');

  // --- WETH ---
  // await deployNewStrategy('WETH');
  // await wireStrategy('WETH');

  // --- BONZO ---
  // await deployNewStrategy('BONZO');
  await wireStrategy('BONZO');

  // --- HBARX ---
  // await deployNewStrategy('HBARX');
  await wireStrategy('HBARX');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
