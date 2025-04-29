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

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET);
const owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const assetConfigurations = {
  '0x00000000000000000000000000000000007e545e': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'BONZO',
    supraIndex: 432,
    ltv: 1,
    liquidationThreshold: 2,
    liquidationBonus: 10666,
  },
  '0x000000000000000000000000000000000011afa2': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'GRELF',
    supraIndex: 527,
    ltv: 3000,
    liquidationThreshold: 4300,
    liquidationBonus: 10666,
  },
  '0x00000000000000000000000000000000004d6427': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'WSTEAM',
  },
  '0x00000000000000000000000000000000005b665a': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'KBL',
    supraIndex: 526,
    ltv: 3000,
    liquidationThreshold: 4300,
    liquidationBonus: 10666,
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
    LendingPool.hedera_mainnet.address
  );

  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  const addressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_mainnet.address
  );

  console.log('Signer:', owner.address);
  const poolOwner = await addressesProviderContract.getPoolAdmin();
  console.log('Lending Pool Owner:', poolOwner);
  // Array to hold reserve parameters
  const reserveParamsArray: ReserveParams[] = [];

  const initReserveInput = assetConfigurations[tokenAddress];

  const reserveParams: ReserveParams = {
    aTokenImpl: AToken.hedera_mainnet.address,
    stableDebtTokenImpl: StableDebtToken.hedera_mainnet.address,
    variableDebtTokenImpl: VariableDebtToken.hedera_mainnet.address,
    underlyingAssetDecimals: initReserveInput.underlyingAssetDecimals,
    interestRateStrategyAddress: initReserveInput.interestRateStrategyAddress,
    underlyingAsset: tokenAddress,
    treasury: deployer.address,
    incentivesController: HederaConfig.IncentivesController.hedera_mainnet,
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
  const addressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_mainnet.address
  );
  const oracleAddress = await addressesProviderContract.getPriceOracle();
  console.log('Oracle address = ', oracleAddress);

  // const oracleContract = await setupContract('SupraOracle', oracleAddress);
  // console.log('Oracle owner = ', await oracleContract.owner());

  // const initReserveInput = assetConfigurations[tokenAddress];
  // console.log(initReserveInput);
  // const txn = await oracleContract.addNewAsset(
  //   initReserveInput.underlyingAssetName,
  //   tokenAddress,
  //   initReserveInput.supraIndex,
  //   initReserveInput.underlyingAssetDecimals
  // );
  // await txn.wait();
  // console.log('Asset added to oracle');
  // const price = await oracleContract.getPriceFeed(tokenAddress);
  // console.log(price);
}

async function enableBorrowing(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  const txn = await lendingPoolConfiguratorContract.enableBorrowingOnReserve(tokenAddress, false);
  // const txn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(tokenAddress);
  await txn.wait();
  console.log('Borrowing enabled');
}

async function configureReserveAsCollateral(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
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
    LendingPoolConfigurator.hedera_mainnet.address
  );

  const txn = await lendingPoolConfiguratorContract.setReserveFactor(tokenAddress, '1725');
  await txn.wait();
  console.log('Reserve factor set');
}

async function main() {
  const newAsset = '0x00000000000000000000000000000000005b665a';
  // Step 0: Deploy a new interest rate strategy contract, if needed - use DefaultReserveInterestRateStrategy.sol
  // Step 1: Update the reserve
  // await updateReserve(newAsset);
  // Step 2: Add the asset to the oracle
  // Note: If you can't add a new asset to the oracle, then update the oracle
  // await addNewAssetToOracle(newAsset);
  // // // Step 3: Enable borrowing
  // await enableBorrowing(newAsset);
  // // // Step 4: configureReserveAsCollateral and set reserve factor
  // await configureReserveAsCollateral(newAsset);
  // await setReserveFactor(newAsset);
  // Step 5 - Configure the aToken and variableDebtToken in incentives controller
  // Step 6: Update the scripts - getUpdatedMetrics, cronJob, processPoints
  // Step 7: Set borrow cap
  // Step 8: Update the interest rate model in the JSON
  // Step 9: Add allowance from the rewards treasury account. /allowances.ts
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
