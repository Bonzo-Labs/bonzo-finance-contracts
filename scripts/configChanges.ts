import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import { SAUCE, HBARX, WHBAR } from './outputReserveData.json';
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, newOwner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  newOwner = new ethers.Wallet(process.env.PRIVATE_KEY3 || '', provider);
} else if (chain_type == 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET;
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  newOwner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
}

async function setupContract(artifactName, contractAddress, wallet) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, wallet);
}

async function printReserveData(assetName, assetAddress) {
  const dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_testnet.address,
    owner
  );

  const reserveData = await dataProviderContract.getReserveData(assetAddress);
  console.log(`${assetName} reserve data:`, reserveData);
}

async function configChanges() {
  console.log('Owner = ', owner.address);
  console.log('New Owner = ', newOwner.address);
  // Load the contract artifacts
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address,
    owner
  );
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address,
    owner
  );
  const addressesProviderContractNew = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address,
    newOwner
  );
  const configuratorNew = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address,
    newOwner
  );

  // await printReserveData('HBARX', HBARX.hedera_testnet.token.address);

  // // Disable borrowing on the reserve
  // const disableBorrowingTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
  //   HBARX.hedera_testnet.token.address
  // );
  // await disableBorrowingTxn.wait();
  // console.log('Borrowing disabled for HBARX');

  // await printReserveData('HBARX', HBARX.hedera_testnet.token.address);

  console.log('Current Owner:', await lendingPoolAddressesProviderContract.owner());
  console.log('Current Pool Admin', await lendingPoolAddressesProviderContract.getPoolAdmin());
  console.log(
    'Current Emergency Admin',
    await lendingPoolAddressesProviderContract.getEmergencyAdmin()
  );

  // Change the pool admin
  const changePoolAdminTxn = await lendingPoolAddressesProviderContract.setPoolAdmin(
    newOwner.address
  );
  await changePoolAdminTxn.wait();
  console.log('Pool admin changed');

  // Change the emergency admin
  const changeEmergencyAdminTxn = await lendingPoolAddressesProviderContract.setEmergencyAdmin(
    newOwner.address
  );
  await changeEmergencyAdminTxn.wait();
  console.log('Emergency admin changed');

  console.log('New Pool Admin', await lendingPoolAddressesProviderContract.getPoolAdmin());
  console.log(
    'New Emergency Admin',
    await lendingPoolAddressesProviderContract.getEmergencyAdmin()
  );

  // Enable borrowing on the reserve
  const enableBorrowingTxn = await configuratorNew.enableBorrowingOnReserve(
    HBARX.hedera_testnet.token.address,
    false
  );
  await enableBorrowingTxn.wait();
  console.log('Borrowing enabled for HBARX');

  await printReserveData('HBARX', HBARX.hedera_testnet.token.address);

  // Change owner
  const transferOwnershipTxn = await lendingPoolAddressesProviderContract.transferOwnership(
    newOwner.address
  );
  await transferOwnershipTxn.wait();
  console.log('Ownership transfer initiated');

  console.log('Pending owner = ', await lendingPoolAddressesProviderContract.pendingOwner());

  const acceptOwnershipTxn = await addressesProviderContractNew.acceptOwnership();
  await acceptOwnershipTxn.wait();
  console.log('Ownership transfer accepted');

  console.log('New Owner:', await lendingPoolAddressesProviderContract.owner());

  try {
    const disableBorrowingTxn1 = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
      HBARX.hedera_testnet.token.address
    );
    await disableBorrowingTxn1.wait();
  } catch (e) {
    console.log('Disable borrowing failed');
  }

  const disableBorrowing1 = await configuratorNew.disableBorrowingOnReserve(
    HBARX.hedera_testnet.token.address
  );
  await disableBorrowing1.wait();
  console.log('Disabled borrowing for HBARX');
}

async function main() {
  await configChanges();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
