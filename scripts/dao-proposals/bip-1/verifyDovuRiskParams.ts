/**
 * BIP-1: DOVU Risk Parameter Update - step verification (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Reads bip1-state.json to see which steps of updateDovuRiskParams.ts have
 * actually been run, then re-reads on-chain state for each completed step
 * and compares it against the target values from that script / from
 * markets/hedera/rateStrategies.ts. Steps not yet run are reported as
 * skipped rather than failed.
 *
 * Run this after each step, before uncommenting the next one:
 *
 *   CHAIN_TYPE=hedera_mainnet npx hardhat run \
 *     scripts/dao-proposals/bip-1/verifyDovuRiskParams.ts --network hedera_mainnet
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
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
import BigNumber from 'bignumber.js';
import { oneRay } from '../../../helpers/constants';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `BIP-1 is a mainnet-only proposal. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');

const DOVU_ADDRESS = DOVU.hedera_mainnet.token.address;

const TARGET = {
  supplyCap: 31_250_000,
  borrowCap: 15_625_000,
  ltv: 2000,
  liquidationThreshold: 4500,
  liquidationBonus: 11000,
  reserveFactor: 2500,
};

const STATE_PATH = path.join(__dirname, 'bip1-state.json');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, provider);
}

let allPassed = true;

function reportSkipped(step: string) {
  console.log(`⏭  ${step}: not yet run`);
}

function reportField(label: string, actual: unknown, expected: unknown) {
  const pass = actual?.toString() === expected?.toString();
  if (!pass) allPassed = false;
  console.log(`   ${pass ? '✅' : '❌'} ${label}: on-chain=${actual} expected=${expected}`);
}

// Ray-encoded values (1 RAY = 100%) are unreadable as raw integers, e.g.
// "90000000000000000000000000" - show the equivalent percentage alongside it.
function formatRay(value: unknown) {
  const pct = new BigNumber(value?.toString() ?? '0').dividedBy(oneRay).multipliedBy(100);
  return `${value} (${pct.toFixed(2)}%)`;
}

function reportRayField(label: string, actual: unknown, expected: unknown) {
  const pass = actual?.toString() === expected?.toString();
  if (!pass) allPassed = false;
  console.log(
    `   ${pass ? '✅' : '❌'} ${label}: on-chain=${formatRay(actual)} expected=${formatRay(expected)}`
  );
}

function reportAddressField(label: string, actual: unknown, expected: unknown) {
  const pass = actual?.toString().toLowerCase() === expected?.toString().toLowerCase();
  if (!pass) allPassed = false;
  console.log(`   ${pass ? '✅' : '❌'} ${label}: on-chain=${actual} expected=${expected}`);
}

async function verifyDeployNewRateStrategy(step: { address: string | null }) {
  console.log('\n[Step 1] deployNewRateStrategy - rateStrategyDOVUv2 constructor params');
  if (!step.address) return reportSkipped('deployNewRateStrategy');

  const strategy = await setupContract('DefaultReserveInterestRateStrategy', step.address);
  const [optimal, base, vSlope1, vSlope2, sSlope1, sSlope2] = await Promise.all([
    strategy.OPTIMAL_UTILIZATION_RATE(),
    strategy.baseVariableBorrowRate(),
    strategy.variableRateSlope1(),
    strategy.variableRateSlope2(),
    strategy.stableRateSlope1(),
    strategy.stableRateSlope2(),
  ]);

  console.log(`   Strategy address: ${step.address}`);
  reportRayField('optimalUtilizationRate', optimal, rateStrategyDOVUv2.optimalUtilizationRate);
  reportRayField('baseVariableBorrowRate', base, rateStrategyDOVUv2.baseVariableBorrowRate);
  reportRayField('variableRateSlope1', vSlope1, rateStrategyDOVUv2.variableRateSlope1);
  reportRayField('variableRateSlope2', vSlope2, rateStrategyDOVUv2.variableRateSlope2);
  reportRayField('stableRateSlope1', sSlope1, rateStrategyDOVUv2.stableRateSlope1);
  reportRayField('stableRateSlope2', sSlope2, rateStrategyDOVUv2.stableRateSlope2);
}

async function verifySetSupplyCap(step: { completed: boolean }) {
  console.log('\n[Step 2] setSupplyCap');
  if (!step.completed) return reportSkipped('setSupplyCap');

  const c = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  const supplyCap = await c.getSupplyCap(DOVU_ADDRESS);
  reportField('supplyCap', supplyCap, TARGET.supplyCap);
}

async function verifySetBorrowCap(step: { completed: boolean }) {
  console.log('\n[Step 3] setBorrowCap');
  if (!step.completed) return reportSkipped('setBorrowCap');

  const c = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  const borrowCap = await c.getBorrowCap(DOVU_ADDRESS);
  reportField('borrowCap', borrowCap, TARGET.borrowCap);
}

async function verifyConfigureCollateral(step: { completed: boolean }) {
  console.log('\n[Step 4] configureCollateral - LTV / liquidation threshold / liquidation bonus');
  if (!step.completed) return reportSkipped('configureCollateral');

  const dataProvider = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address
  );
  const config = await dataProvider.getReserveConfigurationData(DOVU_ADDRESS);
  reportField('ltv', config.ltv, TARGET.ltv);
  reportField('liquidationThreshold', config.liquidationThreshold, TARGET.liquidationThreshold);
  reportField('liquidationBonus', config.liquidationBonus, TARGET.liquidationBonus);
}

async function verifySetReserveFactor(step: { completed: boolean }) {
  console.log('\n[Step 5] setReserveFactor');
  if (!step.completed) return reportSkipped('setReserveFactor');

  const dataProvider = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address
  );
  const config = await dataProvider.getReserveConfigurationData(DOVU_ADDRESS);
  reportField('reserveFactor', config.reserveFactor, TARGET.reserveFactor);
}

async function verifySetInterestRateStrategy(
  step: { completed: boolean },
  deployedAddress: string | null
) {
  console.log('\n[Step 6] setInterestRateStrategy - wiring to LendingPool reserve');
  if (!step.completed) return reportSkipped('setInterestRateStrategy');

  const pool = await setupContract('LendingPool', LendingPool.hedera_mainnet.address);
  const reserveData = await pool.getReserveData(DOVU_ADDRESS);
  reportAddressField(
    'interestRateStrategyAddress',
    reserveData.interestRateStrategyAddress,
    deployedAddress
  );
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Asset (DOVU):', DOVU_ADDRESS);
  console.log('State file:', STATE_PATH);

  const state = loadState();

  await verifyDeployNewRateStrategy(state.steps.deployNewRateStrategy);
  await verifySetSupplyCap(state.steps.setSupplyCap);
  await verifySetBorrowCap(state.steps.setBorrowCap);
  await verifyConfigureCollateral(state.steps.configureCollateral);
  await verifySetReserveFactor(state.steps.setReserveFactor);
  await verifySetInterestRateStrategy(
    state.steps.setInterestRateStrategy,
    state.steps.deployNewRateStrategy.address
  );

  console.log(
    `\n${
      allPassed
        ? '✅ All completed steps match target values.'
        : '❌ Some checks failed - see above.'
    }`
  );
  if (!allPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
