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
// const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
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
    supraIndex: 532,
    ltv: 5000,
    liquidationThreshold: 5900,
    liquidationBonus: 10666,
  },
  '0x000000000000000000000000000000000011afa2': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'GRELF',
    supraIndex: 527,
    ltv: 5000,
    liquidationThreshold: 5900,
    liquidationBonus: 10666,
  },
  '0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'WHBARE',
    supraIndex: 471,
    ltv: 6272,
    liquidationThreshold: 6798,
    liquidationBonus: 10198,
  },
  '0x00000000000000000000000000000000005B665A': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'KBL',
    supraIndex: 526,
    ltv: 5000,
    liquidationThreshold: 5700,
    liquidationBonus: 10666,
  },
  '0x0000000000000000000000000000000000492a28': {
    underlyingAssetDecimals: 6,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'PACK',
    supraIndex: 525,
    ltv: 5000,
    liquidationThreshold: 5700,
    liquidationBonus: 10691,
  },
  '0x000000000000000000000000000000000022D6de': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'KARATE',
    supraIndex: 524,
    ltv: 5000,
    liquidationThreshold: 5700,
    liquidationBonus: 10346,
  },
  '0x000000000000000000000000000000000038b3db': {
    underlyingAssetDecimals: 18,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_mainnet.address,
    underlyingAssetName: 'DOVU',
    supraIndex: 523,
    ltv: 5000,
    liquidationThreshold: 5900,
    liquidationBonus: 10666,
  },
  '0xca367694cdac8f152e33683bb36cc9d6a73f1ef2': {
    underlyingAssetDecimals: 18,
    interestRateStrategyAddress: '0x000000000000000000000000000000000099ab66',
    underlyingAssetName: 'WETH',
    supraIndex: 1001,
    ltv: 7000,
    liquidationThreshold: 7500,
    liquidationBonus: 10700,
    aTokenImplementation: '0x2Bf2835b69144567784Bb04CEfe0F8D0a688e5C8',
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
    aTokenImpl: initReserveInput.aTokenImplementation,
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

  const oracleContract = await setupContract('SupraOracle', oracleAddress);
  console.log('Oracle owner = ', await oracleContract.owner());

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
  console.log(initReserveInput);
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

  const txn = await lendingPoolConfiguratorContract.setReserveFactor(tokenAddress, '2000');
  await txn.wait();
  console.log('Reserve factor set');
}

async function main() {
  const newAsset = '0xca367694cdac8f152e33683bb36cc9d6a73f1ef2';
  // Step 0: Deploy a new interest rate strategy contract, if needed - use DefaultReserveInterestRateStrategy.sol
  // Step 0: Deploy new aToken implementation contract, if needed - use AToken.sol
  // Step 1: Update the reserve
  // await updateReserve(newAsset);
  // Step 2: Add the asset to the oracle
  // Note: If you can't add a new asset to the oracle, then update the oracle
  // await addNewAssetToOracle(newAsset);
  // // // Step 3: Enable borrowing
  // await enableBorrowing(newAsset);
  // // Step 4: configureReserveAsCollateral and set reserve factor
  // await configureReserveAsCollateral(newAsset);
  // await setReserveFactor(newAsset);
  // Step 5 - Configure the aToken and variableDebtToken in bonzo-staking-module
  // Step 6: Update the scripts - getUpdatedMetrics, cronJob, processPoints, getActionEvents
  // Step 7: Set borrow cap
  // Step 8: Update the interest rate model in the JSON in getProtocolAssetDetails
  // Step 9: [Optional] Add allowance from the rewards treasury account. /allowances.ts
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
