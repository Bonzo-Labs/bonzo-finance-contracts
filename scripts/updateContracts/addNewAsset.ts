import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  AToken,
  StableDebtToken,
  VariableDebtToken,
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
  rateStrategyVolatileOne,
  rateStrategyStableThree,
  PriceOracle,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const assetConfigurations = {
  '0x00000000000000000000000000000000004d50fe': {
    underlyingAssetDecimals: 2,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BSTEAM',
  },
  '0x00000000000000000000000000000000004d50f2': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BKARATE',
  },
  '0x00000000000000000000000000000000004d6427': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'WSTEAM',
  },
  '0x00000000000000000000000000000000004e891a': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BUSDC',
    supraIndex: 432,
    ltv: 7500,
    liquidationThreshold: 7800,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e891f': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BSAUCE',
    supraIndex: 425,
    ltv: 7000,
    liquidationThreshold: 7600,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e8924': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BxSAUCE',
    supraIndex: 426,
    ltv: 7000,
    liquidationThreshold: 7600,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e8929': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BHBARX',
    supraIndex: 427,
    ltv: 7000,
    liquidationThreshold: 7500,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e892f': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BDOVU',
    supraIndex: 429,
    ltv: 5500,
    liquidationThreshold: 6500,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e8931': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BPACK',
    supraIndex: 478,
    ltv: 4500,
    liquidationThreshold: 6000,
    liquidationBonus: 10500,
  },
  '0x00000000000000000000000000000000004e8936': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'BHST',
    supraIndex: 478,
    ltv: 4000,
    liquidationThreshold: 5000,
    liquidationBonus: 10500,
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

  console.log('Owner:', owner.address);
  // Array to hold reserve parameters
  const reserveParamsArray: ReserveParams[] = [];

  const initReserveInput = assetConfigurations[tokenAddress];

  const reserveParams: ReserveParams = {
    aTokenImpl: AToken.hedera_testnet.address,
    stableDebtTokenImpl: StableDebtToken.hedera_testnet.address,
    variableDebtTokenImpl: VariableDebtToken.hedera_testnet.address,
    underlyingAssetDecimals: initReserveInput.underlyingAssetDecimals,
    interestRateStrategyAddress: initReserveInput.interestRateStrategyAddress,
    underlyingAsset: tokenAddress,
    treasury: deployer.address,
    incentivesController: HederaConfig.IncentivesController.hedera_testnet,
    underlyingAssetName: initReserveInput.underlyingAssetName,
    aTokenName: `${HederaConfig.ATokenNamePrefix}${initReserveInput.underlyingAssetName}`,
    aTokenSymbol: `a${initReserveInput.underlyingAssetName}`,
    variableDebtTokenName: `${HederaConfig.VariableDebtTokenNamePrefix}${initReserveInput.underlyingAssetName}`,
    variableDebtTokenSymbol: `variableDebt${initReserveInput.underlyingAssetName}`,
    stableDebtTokenName: `${HederaConfig.StableDebtTokenNamePrefix}${initReserveInput.underlyingAssetName}`,
    stableDebtTokenSymbol: `stableDebt${initReserveInput.underlyingAssetName}`,
    params: '0x10',
  };

  reserveParamsArray.push(reserveParams);
  console.log(reserveParamsArray);

  const addReserveTxn = await lendingPoolConfiguratorContract.batchInitReserve(reserveParamsArray);
  await addReserveTxn.wait();
  console.log('Reserve added');

  const reserve = await lendingPoolContract.getReserveData(tokenAddress);
  console.log(reserve);
}

async function addNewAssetToOracle(tokenAddress: string) {
  const oracleContract = await setupContract('SupraOracle', PriceOracle.hedera_testnet.address);
  const initReserveInput = assetConfigurations[tokenAddress];
  console.log(initReserveInput);
  const txn = await oracleContract.addNewAsset(
    initReserveInput.underlyingAssetName,
    tokenAddress,
    initReserveInput.supraIndex,
    initReserveInput.underlyingAssetDecimals
  );
  await txn.wait();
  console.log('Asset added to oracle');
  const price = await oracleContract.getPriceFeed(tokenAddress);
  console.log(price);
}

async function enableBorrowing(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  const txn = await lendingPoolConfiguratorContract.enableBorrowingOnReserve(tokenAddress, false);
  await txn.wait();
  console.log('Borrowing enabled');
}

async function configureReserveAsCollateral(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  const initReserveInput = assetConfigurations[tokenAddress];
  const txn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
    tokenAddress,
    initReserveInput.ltv,
    initReserveInput.liquidationThreshold,
    initReserveInput.liquidationBonus
  );
  await txn.wait();
  console.log('Reserve configured as collateral');
}

async function setReserveFactor(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  const txn = await lendingPoolConfiguratorContract.setReserveFactor(tokenAddress, '1500');
  await txn.wait();
  console.log('Reserve factor set');
}

async function main() {
  const newAsset = '0x00000000000000000000000000000000004e8936';
  // Step 0: Deploy a new interest rate strategy contract, if needed - use DefaultReserveInterestRateStrategy.sol
  // Step 1: Update the reserve
  await updateReserve(newAsset);
  // Step 2: Add the asset to the oracle
  // Note: If you can't add a new asset to the oracle, then update the oracle
  await addNewAssetToOracle(newAsset);
  // // Step 3: Enable borrowing
  await enableBorrowing(newAsset);
  // // Step 4: configureReserveAsCollateral and set reserve factor
  await configureReserveAsCollateral(newAsset);
  await setReserveFactor(newAsset);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
