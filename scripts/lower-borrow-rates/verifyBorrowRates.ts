/**
 * Verify lowered borrow rates: WHBAR / WETH / USDC (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Reads rate-update-state.json to see which reserves have been deployed/wired,
 * then re-reads on-chain state and checks:
 *   - the newly deployed strategy carries the target variable slopes AND the
 *     preserved non-slope params recorded at deploy time; and
 *   - the reserve's live interestRateStrategyAddress points at that new
 *     strategy.
 * Reserves not yet processed are reported as skipped rather than failed.
 *
 *   CHAIN_TYPE=hedera_mainnet npx hardhat run \
 *     scripts/lower-borrow-rates/verifyBorrowRates.ts --network hedera_mainnet
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
import BigNumber from 'bignumber.js';

import {
  WHBAR,
  WETH,
  USDC,
  LendingPool,
  LendingPoolConfigurator,
} from '../outputReserveData.json';
import { oneRay } from '../../helpers/constants';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `This is a mainnet-only operation. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');

const RESERVES: Record<'WHBAR' | 'USDC' | 'WETH', string> = {
  WHBAR: WHBAR.hedera_mainnet.token.address,
  USDC: USDC.hedera_mainnet.token.address,
  WETH: WETH.hedera_mainnet.token.address,
};

const STATE_PATH = path.join(__dirname, 'rate-update-state.json');
function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, provider);
}

let allPassed = true;
function formatRay(value: unknown) {
  const pct = new BigNumber(value?.toString() ?? '0').dividedBy(oneRay).multipliedBy(100);
  return `${value} (${pct.toFixed(3)}%)`;
}
function reportRay(label: string, actual: unknown, expected: unknown) {
  const pass = actual?.toString() === expected?.toString();
  if (!pass) allPassed = false;
  console.log(
    `   ${pass ? '✅' : '❌'} ${label}: on-chain=${formatRay(actual)} expected=${formatRay(expected)}`
  );
}
function reportAddress(label: string, actual: unknown, expected: unknown) {
  const pass = actual?.toString().toLowerCase() === expected?.toString().toLowerCase();
  if (!pass) allPassed = false;
  console.log(`   ${pass ? '✅' : '❌'} ${label}: on-chain=${actual} expected=${expected}`);
}

// All three reserves are required for this workflow. Missing deploy/wire is a
// FAILURE, not a skip - otherwise an empty state file "passes".
const REQUIRED: Array<'WHBAR' | 'USDC' | 'WETH'> = ['WHBAR', 'USDC', 'WETH'];

async function verifyReserve(symbol: 'WHBAR' | 'USDC' | 'WETH', entry: any) {
  console.log(`\n[${symbol}]`);
  const required = REQUIRED.includes(symbol);
  if (!entry?.deploy?.completed) {
    if (required) {
      allPassed = false;
      console.log('   ❌ deploy: NOT RUN (required)');
    } else {
      console.log('   ⏭  deploy: not yet run');
    }
    return;
  }
  const deployed = entry.deploy.address;
  const strat = await setupContract('DefaultReserveInterestRateStrategy', deployed);
  const [optimal, base, vSlope1, vSlope2, sSlope1, sSlope2] = await Promise.all([
    strat.OPTIMAL_UTILIZATION_RATE(),
    strat.baseVariableBorrowRate(),
    strat.variableRateSlope1(),
    strat.variableRateSlope2(),
    strat.stableRateSlope1(),
    strat.stableRateSlope2(),
  ]);

  console.log(`   Strategy address: ${deployed} (was ${entry.deploy.previousStrategy})`);
  // Overridden slopes must match the recorded target.
  reportRay('variableRateSlope1', vSlope1, entry.deploy.target.variableRateSlope1);
  reportRay('variableRateSlope2', vSlope2, entry.deploy.target.variableRateSlope2);
  // Non-slope params must equal what was preserved at deploy time.
  reportRay('optimalUtilizationRate', optimal, entry.deploy.preserved.optimalUtilizationRate);
  reportRay('baseVariableBorrowRate', base, entry.deploy.preserved.baseVariableBorrowRate);
  reportRay('stableRateSlope1', sSlope1, entry.deploy.preserved.stableRateSlope1);
  reportRay('stableRateSlope2', sSlope2, entry.deploy.preserved.stableRateSlope2);

  // Wiring check.
  if (!entry?.wire?.completed) {
    if (required) {
      allPassed = false;
      console.log('   ❌ wire: NOT RUN (required - reserve still on previous strategy)');
    } else {
      console.log('   ⏭  wire: not yet run (reserve still on previous strategy)');
    }
    return;
  }
  const pool = await setupContract('LendingPool', LendingPool.hedera_mainnet.address);
  const reserveData = await pool.getReserveData(RESERVES[symbol]);
  reportAddress('reserve.interestRateStrategyAddress', reserveData.interestRateStrategyAddress, deployed);
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('State file:', STATE_PATH);
  console.log('Configurator:', LendingPoolConfigurator.hedera_mainnet.address);

  const state = loadState();
  for (const symbol of ['WHBAR', 'USDC', 'WETH'] as const) {
    await verifyReserve(symbol, state.reserves?.[symbol]);
  }

  console.log(
    `\n${allPassed ? '✅ All completed steps match target values.' : '❌ Some checks failed - see above.'}`
  );
  if (!allPassed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
