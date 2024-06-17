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
  '0x0000000000000000000000000000000000001599': {
    underlyingAssetDecimals: 8,
    interestRateStrategyAddress: rateStrategyVolatileOne.hedera_testnet.address,
    underlyingAssetName: 'DUMMY',
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
  const txn = await oracleContract.addNewAsset('DUMMY', tokenAddress, 427, 8);
  await txn.wait();
  console.log('Asset added to oracle');
}

async function enableBorrowing(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  const txn = await lendingPoolConfiguratorContract.enableBorrowingOnReserve(tokenAddress, true);
  await txn.wait();
  console.log('Borrowing enabled');
}

async function configureReserveAsCollateral(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  const txn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
    tokenAddress,
    '5000',
    '5001',
    '10500'
  );
  await txn.wait();
  console.log('Reserve configured as collateral');
}

async function main() {
  // Step 1: Update the reserve
  await updateReserve('0x0000000000000000000000000000000000001599');
  // Step 2: Add the asset to the oracle
  await addNewAssetToOracle('0x0000000000000000000000000000000000001599');
  // Step 3: Enable borrowing
  await enableBorrowing('0x0000000000000000000000000000000000001599');
  // Step 4: configureReserveAsCollateral
  await configureReserveAsCollateral('0x0000000000000000000000000000000000001599');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
