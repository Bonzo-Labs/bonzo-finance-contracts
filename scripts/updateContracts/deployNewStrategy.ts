import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { LendingPoolAddressesProvider } from '../outputReserveData.json';
import { rateStrategyVolatileThree } from '../../markets/hedera/rateStrategies';

import { LendingPool, LendingPoolConfigurator } from '../outputReserveData.json';
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
  rateStrategyDOVU,
  rateStrategyHBAR,
  rateStrategyHBARX,
  rateStrategyHST,
  rateStrategyKARATE,
  rateStrategyPACK,
  rateStrategySAUCE,
  rateStrategyXSAUCE,
  rateStrategySTEAM,
  rateStrategyUSDC,
} from '../../markets/hedera/rateStrategies';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
console.log('Chain is = ', chain_type);
let reserves, assetConfigurations;
let lendingPoolContract, lendingPoolConfiguratorContract;
let lendingPoolAddress, lendingPoolConfiguratorAddress;
let provider, owner;

if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  reserves = [
    BKARATE.hedera_testnet.token.address,
    BDOVU.hedera_testnet.token.address,
    BPACK.hedera_testnet.token.address,
  ];

  // assetConfigurations = {
  //   '0x00000000000000000000000000000000004d50f2': {
  //     strategy: strategyKARATE,
  //   },
  //   '0x00000000000000000000000000000000004e892f': {
  //     strategy: strategyDOVU,
  //   },
  //   '0x00000000000000000000000000000000004e8931': {
  //     strategy: strategyPACK,
  //   },
  // };

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
      strategy: rateStrategyHBAR,
    },
    '0x00000000000000000000000000000000000cba44': {
      strategy: rateStrategyHBARX,
    },
    '0x000000000000000000000000000000000006f89a': {
      strategy: rateStrategyUSDC,
    },
    '0x00000000000000000000000000000000000b2ad5': {
      strategy: rateStrategySAUCE,
    },
    '0x00000000000000000000000000000000001647e8': {
      strategy: rateStrategyXSAUCE,
    },
    '0x000000000000000000000000000000000022d6de': {
      strategy: rateStrategyKARATE,
    },
    '0x000000000000000000000000000000000038b3db': {
      strategy: rateStrategyDOVU,
    },
    '0x0000000000000000000000000000000000492a28': {
      strategy: rateStrategyPACK,
    },
    '0x00000000000000000000000000000000000ec585': {
      strategy: rateStrategyHST,
    },
    '0x000000000000000000000000000000000030fb8b': {
      strategy: rateStrategySTEAM,
    },
  };

  lendingPoolAddress = LendingPool.hedera_mainnet.address;
  lendingPoolConfiguratorAddress = LendingPoolConfigurator.hedera_mainnet.address;
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function deployNewStrategy(reserve: any, strategy: any) {
  //     ILendingPoolAddressesProvider provider,
  //     uint256 optimalUtilizationRate,
  //     uint256 baseVariableBorrowRate,
  //     uint256 variableRateSlope1,
  //     uint256 variableRateSlope2,
  //     uint256 stableRateSlope1,
  //     uint256 stableRateSlope2
  const deploymentArgs = {
    provider: LendingPoolAddressesProvider.hedera_mainnet.address,
    optimalUtilizationRate: strategy.optimalUtilizationRate,
    baseVariableBorrowRate: strategy.baseVariableBorrowRate,
    variableRateSlope1: strategy.variableRateSlope1,
    variableRateSlope2: strategy.variableRateSlope2,
    stableRateSlope1: strategy.stableRateSlope1,
    stableRateSlope2: strategy.stableRateSlope2,
  };
  console.log('Deployment args = ', deploymentArgs);

  const rateStrategyContract = await hre.ethers.getContractFactory(
    'DefaultReserveInterestRateStrategy'
  );
  const rateStrategy = await rateStrategyContract.deploy(
    deploymentArgs.provider,
    deploymentArgs.optimalUtilizationRate,
    deploymentArgs.baseVariableBorrowRate,
    deploymentArgs.variableRateSlope1,
    deploymentArgs.variableRateSlope2,
    deploymentArgs.stableRateSlope1,
    deploymentArgs.stableRateSlope2
  );
  await rateStrategy.deployed();
  console.log(`Deployed strategy for reserve = ${reserve}`);
  console.log('Rate Strategy deployed to:', rateStrategy.address);
}

async function main() {
  console.log('Owner:', owner.address);
  for (const reserve of reserves) {
    const strategy = assetConfigurations[reserve].strategy;
    await deployNewStrategy(reserve, strategy);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
