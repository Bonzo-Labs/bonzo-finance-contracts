import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import {
  LendingPool,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';
import {
  BKARATE,
  BDOVU,
  BPACK,
  WHBAR,
  HBARX,
  SAUCE,
  XSAUCE,
  USDC,
  DOVU,
  HST,
  KARATE,
  PACK,
  STEAM,
} from '../outputReserveData.json';
import {
  strategyKARATE,
  strategyHBARX,
  strategySAUCE,
  strategyUSDC,
  strategyXSAUCE,
  strategyDOVU,
  strategyHST,
  strategyPACK,
  strategySTEAM,
  strategyWHBAR,
} from '../../markets/hedera/reservesConfigs';

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let reserves, assetConfigurations;
let lendingPoolContract, lendingPoolConfiguratorContract, dataProviderContract;
let lendingPoolAddress, lendingPoolConfiguratorAddress, dataProviderAddress;
let provider, owner;

if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  reserves = [
    BKARATE.hedera_testnet.token.address,
    BDOVU.hedera_testnet.token.address,
    BPACK.hedera_testnet.token.address,
  ];

  assetConfigurations = {
    '0x00000000000000000000000000000000004d50f2': {
      strategy: strategyKARATE,
    },
    '0x00000000000000000000000000000000004e892f': {
      strategy: strategyDOVU,
    },
    '0x00000000000000000000000000000000004e8931': {
      strategy: strategyPACK,
    },
  };

  lendingPoolAddress = LendingPool.hedera_testnet.address;
  lendingPoolConfiguratorAddress = LendingPoolConfigurator.hedera_testnet.address;
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
  reserves = [
    // WHBAR.hedera_mainnet.token.address,
    // HBARX.hedera_mainnet.token.address,
    USDC.hedera_mainnet.token.address,
    SAUCE.hedera_mainnet.token.address,
    // XSAUCE.hedera_mainnet.token.address,
    KARATE.hedera_mainnet.token.address,
    // DOVU.hedera_mainnet.token.address,
    // PACK.hedera_mainnet.token.address,
    // HST.hedera_mainnet.token.address,
    // STEAM.hedera_mainnet.token.address,
  ];

  assetConfigurations = {
    '0x0000000000000000000000000000000000163b5a': {
      strategy: strategyWHBAR,
      rateStrategyAddress: '0x82C50aAfe0dc3f92e637EE05076d68180DB06d58',
    },
    '0x00000000000000000000000000000000000cba44': {
      strategy: strategyHBARX,
      rateStrategyAddress: '0xA68FC75Acc8a731a1e5cc4CB717b162566d947A8',
    },
    '0x000000000000000000000000000000000006f89a': {
      strategy: strategyUSDC,
      rateStrategyAddress: '0x10753aD937e2f16daB73230fE5e5d8ace807C666',
    },
    '0x00000000000000000000000000000000000b2ad5': {
      strategy: strategySAUCE,
      rateStrategyAddress: '0xf38e204b948Db78Ca5D51cCEd7ccEe182Fe4bcA8',
    },
    '0x00000000000000000000000000000000001647e8': {
      strategy: strategyXSAUCE,
      rateStrategyAddress: '0x998A60b83617F05c1Dcd4b3f5D37a2265d6a674D',
    },
    '0x000000000000000000000000000000000022d6de': {
      strategy: strategyKARATE,
      rateStrategyAddress: '0x9bB33f2D511CA3089Fc5696BEe3ABee7174a556a',
    },
    '0x000000000000000000000000000000000038b3db': {
      strategy: strategyDOVU,
      rateStrategyAddress: '0xC8C0c05683474a7B4c8DdaD69D0D546A841Be5D4',
    },
    '0x0000000000000000000000000000000000492a28': {
      strategy: strategyPACK,
      rateStrategyAddress: '0x4DF846F81135d9e63834AD4C7865F1C1983F767a',
    },
    '0x00000000000000000000000000000000000ec585': {
      strategy: strategyHST,
      rateStrategyAddress: '0x6886E0eD3Cb5dcE6f8e50dCb692a142AE8a14775',
    },
    '0x000000000000000000000000000000000030fb8b': {
      strategy: strategySTEAM,
      rateStrategyAddress: '0xA3E524FE431011dc6d050c32E92Acc38D2f50cB4',
    },
  };

  lendingPoolAddress = LendingPool.hedera_mainnet.address;
  lendingPoolConfiguratorAddress = LendingPoolConfigurator.hedera_mainnet.address;
  dataProviderAddress = AaveProtocolDataProvider.hedera_mainnet.address;
}

async function updateReserveFactor(tokenAddress: string) {
  console.log('Owner:', owner.address);

  const strategy = assetConfigurations[tokenAddress].strategy;
  const updateTxn = await lendingPoolConfiguratorContract.setReserveFactor(
    tokenAddress,
    strategy.reserveFactor
  );
  await updateTxn.wait();
  console.log('Reserve factor updated');

  // const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  // console.log('Reserve data:', reserveData);
}

async function updateLTVs(tokenAddress: string) {
  console.log('Owner:', owner.address);
  console.log('Token address:', tokenAddress);

  const strategy = assetConfigurations[tokenAddress].strategy;
  const updateTxn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
    tokenAddress,
    strategy.baseLTVAsCollateral,
    strategy.liquidationThreshold,
    strategy.liquidationBonus
  );
  await updateTxn.wait();
  console.log('LTVs updated');

  // const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  // console.log('Reserve data:', reserveData);
}

async function updateRateStrategy(tokenAddress: string, rateStrategyAddress: any) {
  // console.log('Owner:', owner.address);
  // const updateTxn = await lendingPoolConfiguratorContract.setReserveInterestRateStrategyAddress(
  //   tokenAddress,
  //   rateStrategyAddress
  // );
  // await updateTxn.wait();
  // console.log(`Rate strategy updated for token ${tokenAddress}`);

  const reserveData = await lendingPoolContract.getReserveData(tokenAddress);
  const updatedRateStrategyAddress = reserveData.interestRateStrategyAddress;
  console.log(`Updated rate strategy address: ${updatedRateStrategyAddress}`);
  const rateStrategy = await setupContract(
    'DefaultReserveInterestRateStrategy',
    updatedRateStrategyAddress
  );
  const RAY = 1e27;
  const slope1Raw = await rateStrategy.variableRateSlope1();
  const slope2Raw = await rateStrategy.variableRateSlope2();
  const optimalUtilizationRateRaw = await rateStrategy.OPTIMAL_UTILIZATION_RATE();
  // Convert BigNumber to string, then to a number, and apply the calculations
  const slope1Percentage = (parseFloat(slope1Raw.toString()) / RAY) * 100;
  const slope2Percentage = (parseFloat(slope2Raw.toString()) / RAY) * 100;
  const optimalUtilizationRatePercentage =
    (parseFloat(optimalUtilizationRateRaw.toString()) / RAY) * 100;
  console.log(`Token address: ${tokenAddress}===`);
  console.log(`Slope1: ${slope1Percentage}%`);
  console.log(`Slope2: ${slope2Percentage}%`);
  console.log(`Optimal Utilization Rate: ${optimalUtilizationRatePercentage}%`);
}

async function main() {
  lendingPoolContract = await setupContract('LendingPool', lendingPoolAddress);
  lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    lendingPoolConfiguratorAddress
  );
  dataProviderContract = await setupContract('AaveProtocolDataProvider', dataProviderAddress);

  for (const reserve of reserves) {
    // await updateReserveFactor(reserve);
    // await updateLTVs(reserve);
    await updateRateStrategy(reserve, assetConfigurations[reserve].rateStrategyAddress);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
