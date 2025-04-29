import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import {
  SAUCE,
  WHBAR,
  USDC,
  KARATE,
  HBARX,
  PACK,
  STEAM,
  DOVU,
  WSTEAM,
  BSTEAM,
  BHST,
  HST,
} from './outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
let dataProviderAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY3 || '', provider);
  dataProviderAddress = AaveProtocolDataProvider.hedera_testnet.address;
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  // console.log('Provider = ', provider);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
  dataProviderAddress = AaveProtocolDataProvider.hedera_mainnet.address;
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function lendingPool() {
  console.log('Deploying contracts with the account:', owner.address);
  // Load the contract artifacts
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_mainnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_mainnet.address
  );
  const dataProviderContract = await setupContract('AaveProtocolDataProvider', dataProviderAddress);

  console.log('Pool admin = ', await lendingPoolAddressesProviderContract.getPoolAdmin());
  console.log('Emergency admin = ', await lendingPoolAddressesProviderContract.getEmergencyAdmin());

  // const sauceAToken = await setupContract('AToken', WHBAR.hedera_testnet.aToken.address);

  // console.log('Owner:', owner.address);

  // const disableTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await disableTxn.wait();
  // console.log('Borrowing disabled');

  // const deactivateTxn = await lendingPoolConfiguratorContract.deactivateReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await deactivateTxn.wait();
  // console.log('Reserve deactivated');

  // const freezeTxn = await lendingPoolConfiguratorContract.unfreezeReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await freezeTxn.wait();
  // console.log('Reserve frozen');

  // 0x103aADF590b249dFc2424c0d499bA406902EE60a
  // console.log('Old Oracle = ', await lendingPoolAddressesProviderContract.getPriceOracle());
  // const oracleUpdate = await lendingPoolAddressesProviderContract.setPriceOracle(
  //   '0x103aADF590b249dFc2424c0d499bA406902EE60a'
  // );
  // await oracleUpdate.wait();
  // console.log('Oracle updated...');
  // console.log('New oracle = ', await lendingPoolAddressesProviderContract.getPriceOracle());

  // const reservesList = await lendingPoolContract.getReservesList();
  // console.log('Reserves:', reservesList);

  // const positionManager = await lendingPoolContract.getPositionManager();
  // console.log('Position Manager:', positionManager);

  // // Step 1 - Need to unpause the contract
  console.log('Paused before:', await lendingPoolContract.paused());
  const txn = await lendingPoolConfiguratorContract.setPoolPause(false);
  await txn.wait();
  console.log('Paused after:', await lendingPoolContract.paused());

  // const configureTxn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
  //   BHST.hedera_testnet.token.address,
  //   0,
  //   0,
  //   0
  // );
  // await configureTxn.wait();
  // console.log('Reserve configured as collateral');

  // Enable or disable an asset as a collateral
  // const userReserveData = await dataProviderContract.getUserReserveData(
  //   WSTEAM.hedera_testnet.token.address,
  //   '0x1e17A29D259fF4f78f02e97c7DECCc7EC3aea103'
  // );
  // console.log('User Reserve Data for SAUCE:', userReserveData);
  // console.log(
  //   'user account data:',
  //   await lendingPoolContract.getUserAccountData('0x1e17A29D259fF4f78f02e97c7DECCc7EC3aea103')
  // );
  // const amountInEth = await lendingPoolContract.getAmountInEth(
  //   100000000,
  //   WSTEAM.hedera_testnet.token.address
  // );
  // console.log('Amount in ETH:', ethers.utils.formatUnits(amountInEth.toString(), 18));
  // console.log('Collateral enabled:', userReserveData.usageAsCollateralEnabled);
  // const enableTXN = await lendingPoolContract.setUserUseReserveAsCollateral(
  //   BSTEAM.hedera_testnet.token.address,
  //   false
  // );
  // await enableTXN.wait();
  // console.log('Collateral disabled');

  // const reserveData = await dataProviderContract.getReserveConfigurationData(
  //   HST.hedera_mainnet.token.address
  // );
  // console.log('BHST Reserve Data:', reserveData);
  // const userReserveData1 = await dataProviderContract.getUserReserveData(
  //   PACK.hedera_mainnet.token.address,
  //   '0x00000000000000000000000000000000000a0af0'
  // );
  // console.log('Collateral after:', userReserveData1.usageAsCollateralEnabled);
}

async function main() {
  await lendingPool();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
