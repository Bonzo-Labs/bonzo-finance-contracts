/**
 * Read-only verification for the five lowered borrow-rate strategies.
 */
import BigNumber from 'bignumber.js';
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { oneRay } from '../../helpers/constants';
import {
  ASSET_BY_SYMBOL,
  PROTOCOL_ADDRESSES,
  RATE_STATE_PATH,
  TARGET_ASSETS,
  TARGET_BASE_VARIABLE_RATE_RAY,
  TARGET_MAX_VARIABLE_RATE_RAY,
  TARGET_VARIABLE_RATE_SLOPE_RAY,
  assertMainnet,
} from './rateConfig';
import { contractAs, eqAddress, readJson, withRetry } from './scriptUtils';

const chainType = process.env.CHAIN_TYPE || 'hedera_testnet';
assertMainnet(chainType);

const provider = withRetry(
  new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '')
);

const formatRay = (value: unknown) => {
  const pct = new BigNumber(value?.toString() ?? '0').dividedBy(oneRay).multipliedBy(100);
  return `${value} (${pct.toFixed(3)}%)`;
};

async function main() {
  let allPassed = true;
  const state = readJson(RATE_STATE_PATH);
  const pool = await contractAs(hre, 'LendingPool', PROTOCOL_ADDRESSES.pool, provider);
  const dataProvider = await contractAs(
    hre,
    'AaveProtocolDataProvider',
    PROTOCOL_ADDRESSES.dataProvider,
    provider
  );

  const reportRay = (label: string, actual: unknown, expected: unknown) => {
    const pass = actual?.toString() === expected?.toString();
    if (!pass) allPassed = false;
    console.log(
      `   ${pass ? 'PASS' : 'FAIL'} ${label}: on-chain=${formatRay(actual)} expected=${formatRay(
        expected
      )}`
    );
  };

  const reportAddress = (label: string, actual: string, expected: string) => {
    const pass = eqAddress(actual, expected);
    if (!pass) allPassed = false;
    console.log(`   ${pass ? 'PASS' : 'FAIL'} ${label}: on-chain=${actual} expected=${expected}`);
  };

  console.log('Chain:', chainType);
  console.log('State file:', RATE_STATE_PATH);
  console.log('Configurator:', PROTOCOL_ADDRESSES.configurator);

  for (const { symbol } of TARGET_ASSETS) {
    console.log(`\n[${symbol}]`);
    const entry = state.reserves?.[symbol];
    if (!entry?.deploy?.completed) {
      allPassed = false;
      console.log('   FAIL deploy: NOT RUN (required)');
      continue;
    }

    const deployed = entry.deploy.address;
    const runtimeCode = await provider.getCode(deployed);
    if (runtimeCode === '0x') {
      allPassed = false;
      console.log('   FAIL runtime bytecode: contract has no code');
      continue;
    }
    if (!entry.deploy.runtimeBytecodeHash) {
      allPassed = false;
      console.log('   FAIL runtimeBytecodeHash: missing from deployment state');
    } else {
      reportAddress(
        'runtimeBytecodeHash',
        ethers.utils.keccak256(runtimeCode),
        entry.deploy.runtimeBytecodeHash
      );
    }

    const strategy = await contractAs(
      hre,
      'DefaultReserveInterestRateStrategy',
      deployed,
      provider
    );
    const [optimal, base, slope1, slope2, stableSlope1, stableSlope2, max] = await Promise.all([
      strategy.OPTIMAL_UTILIZATION_RATE(),
      strategy.baseVariableBorrowRate(),
      strategy.variableRateSlope1(),
      strategy.variableRateSlope2(),
      strategy.stableRateSlope1(),
      strategy.stableRateSlope2(),
      strategy.getMaxVariableBorrowRate(),
    ]);

    console.log(`   Strategy address: ${deployed} (was ${entry.deploy.previousStrategy})`);
    reportRay('recorded target slope1', slope1, entry.deploy.target.variableRateSlope1);
    reportRay('recorded target slope2', slope2, entry.deploy.target.variableRateSlope2);
    reportRay('approved base', base, TARGET_BASE_VARIABLE_RATE_RAY);
    reportRay('approved slope1', slope1, TARGET_VARIABLE_RATE_SLOPE_RAY);
    reportRay('approved slope2', slope2, TARGET_VARIABLE_RATE_SLOPE_RAY);
    reportRay('approved maximum', max, TARGET_MAX_VARIABLE_RATE_RAY);
    reportRay('optimal utilization', optimal, entry.deploy.preserved.optimalUtilizationRate);
    reportRay('preserved base', base, entry.deploy.preserved.baseVariableBorrowRate);
    reportRay('stable slope1', stableSlope1, entry.deploy.preserved.stableRateSlope1);
    reportRay('stable slope2', stableSlope2, entry.deploy.preserved.stableRateSlope2);

    if (!entry?.wire?.completed) {
      allPassed = false;
      console.log('   FAIL wire: NOT RUN (required)');
      continue;
    }
    const reserve = await pool.getReserveData(ASSET_BY_SYMBOL[symbol]);
    reportAddress('live strategy', reserve.interestRateStrategyAddress, deployed);

    const configuration = await dataProvider.getReserveConfigurationData(ASSET_BY_SYMBOL[symbol]);
    const stableOff = configuration.stableBorrowRateEnabled === false;
    if (!stableOff) allPassed = false;
    console.log(
      `   ${stableOff ? 'PASS' : 'FAIL'} stableBorrowRateEnabled: on-chain=${
        configuration.stableBorrowRateEnabled
      } expected=false`
    );
  }

  console.log(`\n${allPassed ? 'All target reserves match.' : 'Some checks failed; see above.'}`);
  if (!allPassed) throw new Error('Borrow-rate verification failed.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
