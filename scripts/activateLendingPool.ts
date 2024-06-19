import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import { SAUCE } from './outputReserveData.json';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function lendingPool() {
  const [deployer] = await ethers.getSigners();
  // Load the contract artifacts
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

  // Step 1 - Need to unpause the contract
  console.log('Paused before:', await lendingPoolContract.paused());
  const txn = await lendingPoolConfiguratorContract.setPoolPause(false);
  await txn.wait();
  console.log('Paused after:', await lendingPoolContract.paused());

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
