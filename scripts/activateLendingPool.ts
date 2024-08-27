import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import { SAUCE, WHBAR } from './outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  // console.log('Provider = ', provider);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function lendingPool() {
  const [deployer] = await ethers.getSigners();
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
  const dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address
  );
  const sauceAToken = await setupContract('AToken', WHBAR.hedera_mainnet.aToken.address);

  console.log('Owner:', owner.address);

  // const disableTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
  //   SAUCE.hedera_mainnet.token.address
  // );
  // await disableTxn.wait();

  // const reserveData = await dataProviderContract.getReserveConfigurationData(
  //   SAUCE.hedera_mainnet.token.address
  // );
  // console.log('Reserve Data:', reserveData);

  const name = await sauceAToken.name();
  console.log('Name:', name);
  const symbol = await sauceAToken.symbol();
  console.log('Symbol:', symbol);
  const decimals = await sauceAToken.decimals();
  console.log('Decimals:', decimals);

  // const reservesList = await lendingPoolContract.getReservesList();
  // console.log('Reserves:', reservesList);

  // const positionManager = await lendingPoolContract.getPositionManager();
  // console.log('Position Manager:', positionManager);

  // // Step 1 - Need to unpause the contract
  // console.log('Paused before:', await lendingPoolContract.paused());
  // const txn = await lendingPoolConfiguratorContract.setPoolPause(false);
  // await txn.wait();
  // console.log('Paused after:', await lendingPoolContract.paused());

  // Enable or disable an asset as a collateral
  // const userReserveData = await dataProviderContract.getUserReserveData(
  //   SAUCE.token.address,
  //   '0x000000000000000000000000000000000037c708'
  // );
  // console.log('Collateral enabled:', userReserveData.usageAsCollateralEnabled);
  // const enableTXN = await lendingPoolContract.setUserUseReserveAsCollateral(
  //   SAUCE.token.address,
  //   !userReserveData.usageAsCollateralEnabled
  // );
  // await enableTXN.wait();
  // const userReserveData1 = await dataProviderContract.getUserReserveData(
  //   SAUCE.token.address,
  //   owner.address
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
