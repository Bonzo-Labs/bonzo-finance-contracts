/**
 * Lower Borrow Rates: WHBAR / WETH / USDC (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Reduces variableRateSlope1 and variableRateSlope2 for the WHBAR, WETH and
 * USDC reserves by deploying a fresh DefaultReserveInterestRateStrategy per
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
 * rate-update-state.json and read back by verifyBorrowRates.ts.
 *
 * Admin key: PRIVATE_KEY_MAINNET_ADMIN (pool admin) + MAINNET_ADMIN_ACCOUNT_ID.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { ContractCreateFlow, ContractFunctionParameters, Hbar } from '@hashgraph/sdk';
const { Client, PrivateKey, AccountId } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
import BigNumber from 'bignumber.js';

import {
  WHBAR,
  WETH,
  USDC,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';
import { oneRay } from '../../helpers/constants';

// --------------------------------------------------------------------------
// Network guard - mainnet only.
// --------------------------------------------------------------------------
const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `This is a mainnet-only operation. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

// --------------------------------------------------------------------------
// TARGET SLOPES (human decimals; 0.06 = 6%). Expressed as the NEW value for
// each reserve's variable-rate curve. Everything else is preserved from the
// live on-chain strategy.
//
//   >>> EDIT THESE. They are pre-filled with the CURRENT on-chain values, so
//   >>> as-is the guard will refuse to deploy ("not a reduction"). Set each to
//   >>> the approved lower value before running the corresponding deploy step.
//
// Current on-chain (read 2026-07-11):
//   WHBAR  base 0%   slope1 6.0%   slope2 150%
//   USDC   base 2%   slope1 13.0%  slope2 50%
//   WETH   base 0%   slope1 3.3%   slope2 85%
//
// newBaseVariableBorrowRate is optional: omit to preserve the live base;
// provide it (e.g. USDC 0) to override.
// --------------------------------------------------------------------------
type Target = {
  newVariableRateSlope1: number;
  newVariableRateSlope2: number;
  newBaseVariableBorrowRate?: number;
};

const TARGETS: Record<'WHBAR' | 'USDC' | 'WETH', Target> = {
  WHBAR: { newVariableRateSlope1: 0.01, newVariableRateSlope2: 0.01 }, // 1% / 1%  (from 6% / 150%)
  USDC: { newVariableRateSlope1: 0.01, newVariableRateSlope2: 0.01, newBaseVariableBorrowRate: 0 }, // 1% / 1%, base 2%->0%
  WETH: { newVariableRateSlope1: 0.01, newVariableRateSlope2: 0.01 }, // 1% / 1%  (from 3.3% / 85%)
};

const RESERVES: Record<'WHBAR' | 'USDC' | 'WETH', string> = {
  WHBAR: WHBAR.hedera_mainnet.token.address,
  USDC: USDC.hedera_mainnet.token.address,
  WETH: WETH.hedera_mainnet.token.address,
};

// --------------------------------------------------------------------------
// State file (deployed addresses, preserved params, tx hashes).
// --------------------------------------------------------------------------
const STATE_PATH = path.join(__dirname, 'rate-update-state.json');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}
function saveStepState(symbol: string, phase: string, data: Record<string, unknown>) {
  const state = loadState();
  state.reserves[symbol] = state.reserves[symbol] || {};
  state.reserves[symbol][phase] = { ...state.reserves[symbol][phase], ...data, completed: true };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

const toRay = (dec: number) => new BigNumber(dec).multipliedBy(oneRay).toFixed(0);
const rayToPct = (ray: ethers.BigNumberish) =>
  `${new BigNumber(ray.toString()).dividedBy(oneRay).multipliedBy(100).toFixed(3)}%`;

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}
// Read-only (through provider). Hedera's relay resolves eth_call `from` against
// a real account; owner's derived EVM address isn't indexed, so views go here.
async function setupReadOnlyContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, provider);
}
async function configurator() {
  return setupContract('LendingPoolConfigurator', LendingPoolConfigurator.hedera_mainnet.address);
}

// Read the live strategy address + its six parameters for a reserve.
async function readLiveStrategy(symbol: 'WHBAR' | 'USDC' | 'WETH') {
  const asset = RESERVES[symbol];
  const pool = await setupReadOnlyContract('LendingPool', LendingPool.hedera_mainnet.address);
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

async function printCurrent(symbol: 'WHBAR' | 'USDC' | 'WETH') {
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
  console.log('==========================================\n');
}

// --------------------------------------------------------------------------
// Deploy a new strategy for `symbol`: preserve all params, override slopes.
// --------------------------------------------------------------------------
async function deployNewStrategy(symbol: 'WHBAR' | 'USDC' | 'WETH') {
  const live = await readLiveStrategy(symbol);
  const target = TARGETS[symbol];

  const newV1 = toRay(target.newVariableRateSlope1);
  const newV2 = toRay(target.newVariableRateSlope2);
  // base: override if provided, else preserve live base.
  const baseOverridden = target.newBaseVariableBorrowRate !== undefined;
  const newBase = baseOverridden ? toRay(target.newBaseVariableBorrowRate!) : live.base;

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
    provider: LendingPoolAddressesProvider.hedera_mainnet.address,
    optimalUtilizationRate: live.optimal, // preserved
    baseVariableBorrowRate: newBase, // override or preserved
    variableRateSlope1: newV1, // NEW
    variableRateSlope2: newV2, // NEW
    stableRateSlope1: live.sSlope1, // preserved
    stableRateSlope2: live.sSlope2, // preserved
  };
  console.log(`\nDeploying new ${symbol} strategy:`);
  if (baseOverridden) {
    console.log(`  baseVariableBorrowRate: ${rayToPct(curBase)} -> ${rayToPct(newBase)}`);
  }
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

  const contractCreateTx = new ContractCreateFlow()
    .setGas(2_000_000)
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

  // Full audit record: identity, provenance and an integrity hash of the
  // deployed runtime bytecode (so the wire step can detect tampering).
  const runtimeCode = await provider.getCode(address);
  const runtimeBytecodeHash = ethers.utils.keccak256(runtimeCode);

  saveStepState(symbol, 'deploy', {
    network: chain_type,
    addressesProvider: LendingPoolAddressesProvider.hedera_mainnet.address,
    address,
    contractId: newContractId.toString(),
    evmAddress: address,
    hederaTxId: response.transactionId?.toString() ?? null,
    consensusTimestamp: record.consensusTimestamp?.toString() ?? null,
    deployerAccountId: operatorAccountId.toString(),
    deployerEvm: owner.address,
    runtimeBytecodeHash,
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
  console.log(`>> Recorded in ${STATE_PATH}. Run the wire step next.`);
}

// --------------------------------------------------------------------------
// Validate a deployed strategy end-to-end BEFORE trusting the state-file
// address enough to wire it into a live reserve. A wrong or tampered address
// could point a reserve at a contract that reverts on every interaction.
// --------------------------------------------------------------------------
async function validateDeployedStrategy(symbol: 'WHBAR' | 'USDC' | 'WETH') {
  const state = loadState();
  const entry = state.reserves?.[symbol]?.deploy;
  if (!entry?.address) {
    throw new Error(`No deployed strategy for ${symbol}. Run deployNewStrategy('${symbol}') first.`);
  }
  const deployed: string = entry.address;

  // (a) state entry belongs to this network + deployment.
  if (entry.network && entry.network !== chain_type) {
    throw new Error(`${symbol}: state entry network ${entry.network} != ${chain_type}.`);
  }
  const liveProvider = LendingPoolAddressesProvider.hedera_mainnet.address;
  if (entry.addressesProvider && entry.addressesProvider.toLowerCase() !== liveProvider.toLowerCase()) {
    throw new Error(`${symbol}: state addressesProvider ${entry.addressesProvider} != ${liveProvider}.`);
  }

  // (b) address has contract bytecode, and it matches the recorded hash.
  const code = await provider.getCode(deployed);
  if (!code || code === '0x') {
    throw new Error(`${symbol}: deployed address ${deployed} has no bytecode.`);
  }
  if (entry.runtimeBytecodeHash) {
    const liveHash = ethers.utils.keccak256(code);
    if (liveHash.toLowerCase() !== entry.runtimeBytecodeHash.toLowerCase()) {
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

  // (d) it must actually differ from the reserve's current strategy.
  const live = await readLiveStrategy(symbol);
  if (live.strategyAddress.toLowerCase() === deployed.toLowerCase()) {
    throw new Error(`${symbol}: deployed strategy equals current live strategy (nothing to wire).`);
  }
  console.log(`✅ ${symbol} deployed strategy ${deployed} validated (params, provider, bytecode).`);
  return { deployed, asset: RESERVES[symbol], preSwapStrategy: live.strategyAddress };
}

// --------------------------------------------------------------------------
// Wire the newly deployed strategy to the reserve (after full validation).
// Also snapshots the reserve's stored borrow/liquidity rate at wire time -
// still the OLD rate, since swapping the strategy does not refresh it - so the
// poke preflight can detect any unexpected change during the pause.
// --------------------------------------------------------------------------
async function wireStrategy(symbol: 'WHBAR' | 'USDC' | 'WETH') {
  const { deployed, asset, preSwapStrategy } = await validateDeployedStrategy(symbol);

  const dp = await setupReadOnlyContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address
  );
  const before = await dp.getReserveData(asset);

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
  console.log('LendingPool:', LendingPool.hedera_mainnet.address);

  // Inspect all three reserves before touching anything.
  await printCurrent('WHBAR');
  await printCurrent('USDC');
  await printCurrent('WETH');

  // Execute one step at a time by uncommenting. Run verifyBorrowRates.ts
  // after each deploy+wire pair before moving to the next reserve.
  //
  // --- WHBAR ---
  // await deployNewStrategy('WHBAR');
  // await wireStrategy('WHBAR');
  //
  // --- USDC ---
  // await deployNewStrategy('USDC');
  // await wireStrategy('USDC');
  //
  // --- WETH ---
  // await deployNewStrategy('WETH');
  // await wireStrategy('WETH');

  // await printCurrent('WHBAR');
  // await printCurrent('USDC');
  // await printCurrent('WETH');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
