import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  USDC,
  SAUCE,
  KARATE,
  HBARX,
  XSAUCE,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
  rateStrategyVolatileOne,
  rateStrategyStableThree,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const assetConfigurations = {
  '0x0000000000000000000000000000000000001549': {
    aTokenImpl: USDC.aToken.address,
    stableDebtTokenImpl: USDC.stableDebt.address,
    variableDebtTokenImpl: USDC.variableDebt.address,
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyStableThree.hedera_testnet.address,
    underlyingAssetName: 'USDC',
    underlyingAssetAddress: USDC.token.address,
  },
  '0x0000000000000000000000000000000000120f46': {
    aTokenImpl: SAUCE.aToken.address,
    stableDebtTokenImpl: SAUCE.stableDebt.address,
    variableDebtTokenImpl: SAUCE.variableDebt.address,
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'SAUCE',
    underlyingAssetAddress: SAUCE.token.address,
  },
  '0x0000000000000000000000000000000000220ced': {
    aTokenImpl: HBARX.aToken.address,
    stableDebtTokenImpl: HBARX.stableDebt.address,
    variableDebtTokenImpl: HBARX.variableDebt.address,
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'HBARX',
    underlyingAssetAddress: HBARX.token.address,
  },
  '0x00000000000000000000000000000000003991eD': {
    aTokenImpl: KARATE.aToken.address,
    stableDebtTokenImpl: KARATE.stableDebt.address,
    variableDebtTokenImpl: KARATE.variableDebt.address,
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'KARATE',
    underlyingAssetAddress: KARATE.token.address,
  },
  '0x000000000000000000000000000000000015a59b': {
    aTokenImpl: XSAUCE.aToken.address,
    stableDebtTokenImpl: XSAUCE.stableDebt.address,
    variableDebtTokenImpl: XSAUCE.variableDebt.address,
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'XSAUCE',
    underlyingAssetAddress: XSAUCE.token.address,
  },
};

// Define the type for reserve parameters
type ReserveParams = {
  aTokenImpl: string;
  stableDebtTokenImpl: string;
  variableDebtTokenImpl: string;
  underlyingAssetDecimals: number;
  interestRateStrategyAddress: string;
  underlyingAsset: string;
  treasury: string;
  incentivesController: any;
  underlyingAssetName: string;
  aTokenName: string;
  aTokenSymbol: string;
  variableDebtTokenName: string;
  variableDebtTokenSymbol: string;
  stableDebtTokenName: string;
  stableDebtTokenSymbol: string;
  params: string;
};

// Array to hold reserve parameters
const reserveParamsArray: ReserveParams[] = [];

async function updateReserve(tokenAddress: string) {
  const [deployer] = await ethers.getSigners();

  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );
  const dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  const initReserveInput = assetConfigurations[tokenAddress];
  if (!initReserveInput) {
    throw new Error(`Configuration for token address ${tokenAddress} not found`);
  }

  const {
    aTokenImpl,
    stableDebtTokenImpl,
    variableDebtTokenImpl,
    underlyingAssetDecimals,
    interestRateStrategyAddress,
    underlyingAssetName,
    underlyingAssetAddress,
  } = initReserveInput;

  const reserveParams: ReserveParams = {
    aTokenImpl,
    stableDebtTokenImpl,
    variableDebtTokenImpl,
    underlyingAssetDecimals,
    interestRateStrategyAddress,
    underlyingAsset: underlyingAssetAddress,
    treasury: deployer.address,
    incentivesController: HederaConfig.IncentivesController.hedera_testnet,
    underlyingAssetName,
    aTokenName: `${HederaConfig.ATokenNamePrefix}${underlyingAssetName}`,
    aTokenSymbol: `a${underlyingAssetName}`,
    variableDebtTokenName: `${HederaConfig.VariableDebtTokenNamePrefix}${underlyingAssetName}`,
    variableDebtTokenSymbol: `variableDebt${underlyingAssetName}`,
    stableDebtTokenName: `${HederaConfig.StableDebtTokenNamePrefix}${underlyingAssetName}`,
    stableDebtTokenSymbol: `stableDebt${underlyingAssetName}`,
    params: '0x10',
  };

  // const poolReserve = await lendingPoolContract.getReserveData(tokenAddress);

  reserveParamsArray.push(reserveParams);

  console.log('Reserve params array:', reserveParamsArray);
  // console.log('Lending pool configurator contract', lendingPoolConfiguratorContract);
  await lendingPoolConfiguratorContract.batchInitReserve(reserveParamsArray);
  console.log('Reserve initialized for token address:', tokenAddress);

  // if (poolReserve.aTokenAddress !== ZERO_ADDRESS) {
  //   console.log(`- Skipping init of ${tokenAddress} because is already initialized`);
  // } else {
  // }
}

async function main() {
  await updateReserve('0x0000000000000000000000000000000000120f46');
  console.log(reserveParamsArray);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
