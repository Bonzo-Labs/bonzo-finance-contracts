/**
 * BIP-1: DOVU Risk Parameter Update (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Governance proposal: "DOVU Risk Parameter Update" (Bonzo Lend).
 *
 * This script applies the approved DOVU risk-parameter changes on Hedera
 * Mainnet. It is intentionally step-gated in main() so each on-chain action
 * can be reviewed and executed independently.
 *
 *   Parameter        Current                 Recommended
 *   Supply Cap       19,379,844 DOVU         31,250,000 DOVU
 *   Liq Threshold    59%   (5900)            45%    (4500)
 *   Liq Bonus        6.66% (10666)           10%    (11000)
 *   Borrow Cap       3,875,968 DOVU          15,625,000 DOVU
 *   Reserve Factor   17.25% (1725)           25%    (2500)
 *   Slope-2 (gamma)  250%  (2.5 * RAY)       300%   (3.0 * RAY)
 *   LTV              20%   (2000)            20%    (2000, unchanged)
 *   Close Factor     50%                     50%    (protocol-level, unchanged)
 *
 * Notes:
 *  - LTV, Liquidation Threshold and Liquidation Bonus are all written in a
 *    single configureReserveAsCollateral() call. LTV is unchanged (2000) but
 *    must still be passed to preserve it.
 *  - Liquidation Bonus is encoded as (100% + bonus): 10% bonus => 11000.
 *  - Supply/Borrow caps are whole-token units (no decimals), matching the
 *    LendingPoolConfigurator setSupplyCap/setBorrowCap convention.
 *  - Slope-2 cannot be mutated in place. A new DefaultReserveInterestRateStrategy
 *    must be deployed (deployNewRateStrategy) and then wired to the DOVU reserve
 *    via setReserveInterestRateStrategyAddress(). The deployed address is
 *    recorded automatically in bip1-state.json and read back by that step.
 *  - Admin key: PRIVATE_KEY_MAINNET_ADMIN (pool admin). This script is written
 *    for mainnet ONLY.
 *  - After each step, run verifyDovuRiskParams.ts to check the on-chain state
 *    it just wrote against the target values in this file.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { ContractCreateFlow, ContractFunctionParameters, Hbar } from '@hashgraph/sdk';
const { Client, PrivateKey, AccountId } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');

import {
  DOVU,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../../outputReserveData.json';
import { rateStrategyDOVUv2 } from '../../../markets/hedera/rateStrategies';

// --------------------------------------------------------------------------
// Network guard - this proposal targets Hedera Mainnet only.
// --------------------------------------------------------------------------
const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `BIP-1 is a mainnet-only proposal. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

// --------------------------------------------------------------------------
// DOVU target parameters (BIP-1)
// --------------------------------------------------------------------------
const DOVU_ADDRESS = DOVU.hedera_mainnet.token.address;

const TARGET = {
  supplyCap: 31_250_000, // whole DOVU tokens
  borrowCap: 15_625_000, // whole DOVU tokens
  ltv: 2000, // 20.00% (unchanged)
  liquidationThreshold: 4500, // 45.00%
  liquidationBonus: 11000, // 10.00% bonus (100% + 10%)
  reserveFactor: 2500, // 25.00%
};

// Address of the new DOVU interest-rate strategy (Slope-2 = 300%).
// Auto-populated from bip1-state.json after deployNewRateStrategy() runs;
// only needed as a manual fallback if the state file is unavailable.
const NEW_RATE_STRATEGY_ADDRESS_OVERRIDE = '';

// --------------------------------------------------------------------------
// bip1-state.json - records what's actually been executed on-chain so far
// (deployed addresses, tx hashes) so verifyDovuRiskParams.ts can check each
// step independently as it's completed.
// --------------------------------------------------------------------------
const STATE_PATH = path.join(__dirname, 'bip1-state.json');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveStepState(step: string, data: Record<string, unknown>) {
  const state = loadState();
  state.steps[step] = { ...state.steps[step], ...data, completed: true };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

// Read-only variant (no signer) for view calls. Hedera's JSON-RPC relay
// resolves eth_call's `from` against a real Hedera account when the contract
// is connected via a signer; owner's derived EVM address isn't indexed there,
// so plain view reads must go through the provider instead.
async function setupReadOnlyContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, provider);
}

async function configurator() {
  return setupContract('LendingPoolConfigurator', LendingPoolConfigurator.hedera_mainnet.address);
}

// --------------------------------------------------------------------------
// Read + log current on-chain DOVU configuration.
// --------------------------------------------------------------------------
async function printCurrentParams(label: string) {
  const configuratorContract = await setupReadOnlyContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  const dataProvider = await setupReadOnlyContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address
  );

  const [supplyCap, borrowCap, config] = await Promise.all([
    configuratorContract.getSupplyCap(DOVU_ADDRESS),
    configuratorContract.getBorrowCap(DOVU_ADDRESS),
    dataProvider.getReserveConfigurationData(DOVU_ADDRESS),
  ]);

  console.log(`\n=== DOVU reserve params (${label}) ===`);
  console.log('Asset:', DOVU_ADDRESS);
  console.log('Supply Cap:          ', supplyCap.toString());
  console.log('Borrow Cap:          ', borrowCap.toString());
  console.log('LTV:                 ', config.ltv.toString());
  console.log('Liquidation Thresh.: ', config.liquidationThreshold.toString());
  console.log('Liquidation Bonus:   ', config.liquidationBonus.toString());
  console.log('Reserve Factor:      ', config.reserveFactor.toString());
  console.log('========================================\n');
}

// --------------------------------------------------------------------------
// Step 1: Deploy the new DOVU interest-rate strategy (Slope-2 = 300%).
//   Mirrors scripts/updateContracts/deployNewStrategy.ts (Hedera SDK deploy).
//   The resulting address is recorded in bip1-state.json automatically.
// --------------------------------------------------------------------------
async function deployNewRateStrategy() {
  const strategy = rateStrategyDOVUv2;
  const deploymentArgs = {
    provider: LendingPoolAddressesProvider.hedera_mainnet.address,
    optimalUtilizationRate: strategy.optimalUtilizationRate,
    baseVariableBorrowRate: strategy.baseVariableBorrowRate,
    variableRateSlope1: strategy.variableRateSlope1,
    variableRateSlope2: strategy.variableRateSlope2,
    stableRateSlope1: strategy.stableRateSlope1,
    stableRateSlope2: strategy.stableRateSlope2,
  };
  console.log('Deploying rateStrategyDOVUv2 with args:', deploymentArgs);

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
  // ContractCreateFlow's internal FileCreate/FileAppend transactions fall back to the
  // client's default max fee if none is set; at current HBAR pricing that default is
  // too low for the file-append step and fails with INSUFFICIENT_TX_FEE.
  client.setDefaultMaxTransactionFee(new Hbar(20));

  const contractCreateTx = new ContractCreateFlow()
    .setGas(2_000_000)
    .setBytecode(artifact.bytecode)
    .setConstructorParameters(functionParameters);

  const response = await contractCreateTx.execute(client);
  const receipt = await response.getReceipt(client);
  const newContractId = receipt.contractId;
  if (!newContractId) {
    throw new Error('Failed to retrieve new contract ID from receipt');
  }
  const address = `0x${newContractId.toSolidityAddress()}`;
  console.log(
    `Deployed rateStrategyDOVUv2. Contract ID = ${newContractId.toString()}, ` +
      `EVM address = ${address}`
  );
  saveStepState('deployNewRateStrategy', { address, timestamp: new Date().toISOString() });
  console.log(`>> Recorded in ${STATE_PATH}. Step 6 will read it automatically.`);
}

// --------------------------------------------------------------------------
// Step 2: Supply cap  19,379,844 -> 31,250,000
// --------------------------------------------------------------------------
async function setSupplyCap() {
  const c = await configurator();
  console.log(`Setting DOVU supply cap to ${TARGET.supplyCap} ...`);
  const txn = await c.setSupplyCap(DOVU_ADDRESS, TARGET.supplyCap);
  const receipt = await txn.wait();
  const readOnly = await setupReadOnlyContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  console.log('New supply cap:', (await readOnly.getSupplyCap(DOVU_ADDRESS)).toString());
  saveStepState('setSupplyCap', {
    txHash: receipt.transactionHash,
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Step 3: Borrow cap  3,875,968 -> 15,625,000
// --------------------------------------------------------------------------
async function setBorrowCap() {
  const c = await configurator();
  console.log(`Setting DOVU borrow cap to ${TARGET.borrowCap} ...`);
  const txn = await c.setBorrowCap(DOVU_ADDRESS, TARGET.borrowCap);
  const receipt = await txn.wait();
  const readOnly = await setupReadOnlyContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  console.log('New borrow cap:', (await readOnly.getBorrowCap(DOVU_ADDRESS)).toString());
  saveStepState('setBorrowCap', {
    txHash: receipt.transactionHash,
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Step 4: Collateral config  LTV 20% (unchanged), LT 59%->45%, LB 6.66%->10%
// --------------------------------------------------------------------------
async function configureCollateral() {
  const c = await configurator();
  console.log(
    `Configuring DOVU collateral: ltv=${TARGET.ltv}, ` +
      `liquidationThreshold=${TARGET.liquidationThreshold}, ` +
      `liquidationBonus=${TARGET.liquidationBonus} ...`
  );
  const txn = await c.configureReserveAsCollateral(
    DOVU_ADDRESS,
    TARGET.ltv,
    TARGET.liquidationThreshold,
    TARGET.liquidationBonus
  );
  const receipt = await txn.wait();
  console.log('DOVU collateral parameters updated.');
  saveStepState('configureCollateral', {
    txHash: receipt.transactionHash,
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Step 5: Reserve factor  17.25% -> 25%
// --------------------------------------------------------------------------
async function setReserveFactor() {
  const c = await configurator();
  console.log(`Setting DOVU reserve factor to ${TARGET.reserveFactor} ...`);
  const txn = await c.setReserveFactor(DOVU_ADDRESS, TARGET.reserveFactor);
  const receipt = await txn.wait();
  console.log('DOVU reserve factor updated.');
  saveStepState('setReserveFactor', {
    txHash: receipt.transactionHash,
    timestamp: new Date().toISOString(),
  });
}

// --------------------------------------------------------------------------
// Step 6: Wire the new interest-rate strategy (Slope-2 = 300%) to DOVU.
//   Requires NEW_RATE_STRATEGY_ADDRESS populated from Step 1.
// --------------------------------------------------------------------------
async function setInterestRateStrategy() {
  const state = loadState();
  const strategyAddress =
    NEW_RATE_STRATEGY_ADDRESS_OVERRIDE || state.steps.deployNewRateStrategy.address;
  if (!strategyAddress) {
    throw new Error(
      'No deployed strategy address found. Run deployNewRateStrategy() first ' +
        '(it records the address in bip1-state.json), or set NEW_RATE_STRATEGY_ADDRESS_OVERRIDE.'
    );
  }
  const c = await configurator();
  console.log(`Setting DOVU interest-rate strategy to ${strategyAddress} ...`);
  const txn = await c.setReserveInterestRateStrategyAddress(DOVU_ADDRESS, strategyAddress);
  const receipt = await txn.wait();
  console.log('DOVU interest-rate strategy updated.');
  saveStepState('setInterestRateStrategy', {
    txHash: receipt.transactionHash,
    timestamp: new Date().toISOString(),
  });
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Pool admin signer:', owner.address);
  console.log('LendingPool:', LendingPool.hedera_mainnet.address);

  // Inspect current state before making any changes.
  await printCurrentParams('BEFORE');

  // Execute steps one at a time by uncommenting them (review each on-chain).
  //
  // After each step, run verifyDovuRiskParams.ts before uncommenting the next.
  //
  // Step 1 - deploy new interest-rate strategy (Slope-2 = 300%).
  //          Address is recorded in bip1-state.json automatically.
  // await deployNewRateStrategy();
  //
  // Step 2 - supply cap.
  // await setSupplyCap();
  //
  // Step 3 - borrow cap.
  // await setBorrowCap();
  //
  // Step 4 - LTV / liquidation threshold / liquidation bonus.
  // await configureCollateral();
  //
  // Step 5 - reserve factor.
  // await setReserveFactor();
  //
  // Step 6 - attach new interest-rate strategy (reads address from Step 1's
  //          state file entry automatically).
  // await setInterestRateStrategy();

  // Verify the resulting state after applying the changes.
  // await printCurrentParams('AFTER');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
