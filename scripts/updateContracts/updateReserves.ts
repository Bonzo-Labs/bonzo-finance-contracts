import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPool, LendingPoolConfigurator } from '../outputReserveData.json';
import {
  strategyKARATE,
  strategyCLXY,
  strategyHBARX,
  strategySAUCE,
  strategyUSDC,
  strategyXSAUCE,
} from '../../markets/hedera/reservesConfigs';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const assetConfigurations = {
  '0x00000000000000000000000000000000003991ed': {
    strategy: strategyKARATE,
  },
  '0x0000000000000000000000000000000000220ced': {
    strategy: strategyHBARX,
  },
  '0x0000000000000000000000000000000000120f46': {
    strategy: strategySAUCE,
  },
  '0x000000000000000000000000000000000015a59b': {
    strategy: strategyXSAUCE,
  },
  '0x0000000000000000000000000000000000001549': {
    strategy: strategyUSDC,
  },
  '0x00000000000000000000000000000000000014f5': {
    strategy: strategyCLXY,
  },
};

async function updateReserveFactor(tokenAddress: string) {
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  const strategy = assetConfigurations[tokenAddress].strategy;
  const updateTxn = await lendingPoolConfiguratorContract.setReserveFactor(
    tokenAddress,
    strategy.reserveFactor
  );
  await updateTxn.wait();
  console.log('Reserve factor updated');

  const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  console.log('Reserve data:', reserveData);
}

async function updateLTVs(tokenAddress: string) {
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  const strategy = assetConfigurations[tokenAddress].strategy;
  const updateTxn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
    tokenAddress,
    strategy.baseLTVAsCollateral,
    strategy.liquidationThreshold,
    strategy.liquidationBonus
  );
  await updateTxn.wait();
  console.log('Reserve factor updated');

  const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  console.log('Reserve data:', reserveData);
}

async function updateRateStrategy(tokenAddress: string, rateStrategyAddress: any) {
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  const updateTxn = await lendingPoolConfiguratorContract.setReserveInterestRateStrategyAddress(
    tokenAddress,
    rateStrategyAddress
  );
  await updateTxn.wait();
  console.log('Rate strategy updated');

  const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  console.log('Reserve data:', reserveData);
}

async function main() {
  // await updateReserveFactor('0x00000000000000000000000000000000003991ed');
  // await updateLTVs('0x00000000000000000000000000000000003991ed');
  await updateRateStrategy(
    '0x00000000000000000000000000000000003991ed',
    '0x2809440753c754a55C0E64F3b2bdBA32A3916408'
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
