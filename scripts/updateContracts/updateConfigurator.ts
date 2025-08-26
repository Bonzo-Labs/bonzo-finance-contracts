import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  LendingPool,
} from '../outputReserveData.json';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
console.log('Signer:', owner.address);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateConfiguratorImpl() {
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_mainnet.address
  );

  // Deploy the new LendingPoolConfigurator implementation
  const NewLendingPoolConfiguratorImpl = await ethers.getContractFactory('LendingPoolConfigurator');
  const newImpl = await NewLendingPoolConfiguratorImpl.deploy();
  await newImpl.deployed();
  console.log('New implementation deployed at:', newImpl.address);

  const pool = await lendingPoolAddressesProviderContract.getLendingPool();
  console.log('LendingPool:', pool);

  // Set the new implementation and initialize it
  const tx = await lendingPoolAddressesProviderContract.setLendingPoolConfiguratorImpl(
    newImpl.address
  );
  await tx.wait();

  console.log('Configurator implementation updated and initialized');
}

async function updateDecimals(newDecimals) {
  const lendingPoolConfigurator = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  const currentDecimals = await lendingPoolConfigurator.getDecimals(
    '0x00000000000000000000000000000000003991ed'
  );
  console.log('Current decimals:', currentDecimals.toString());

  await lendingPoolConfigurator.setDecimals(
    '0x00000000000000000000000000000000003991ed',
    newDecimals
  );
  console.log('Decimals updated');

  const newDecimalsAfter = await lendingPoolConfigurator.getDecimals(
    '0x00000000000000000000000000000000003991ed'
  );
  console.log('New decimals:', newDecimalsAfter.toString());
}

async function updateReserveFactor() {
  const lendingPoolConfigurator = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  const reserveFactorTxn = await lendingPoolConfigurator.setReserveFactor(
    '0x0000000000000000000000000000000000003ad2',
    1800
  );
  await reserveFactorTxn.wait();
  console.log('Reserve factor updated');

  // const newReserveFactorAfter = await lendingPoolConfigurator.getReserveFactor(
  //   '0x00000000000000000000000000000000003991eD'
  // );
  // console.log('New reserve factor:', newReserveFactorAfter.toString());
}

async function updateReserveStrategyAddress() {
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_mainnet.address
  );
  const reserveData = await lendingPoolContract.getReserveData(
    '0x000000000000000000000000000000000006f89a'
  );
  console.log('Current Reserve data:', reserveData);

  // const lendingPoolConfigurator = await setupContract(
  //   'LendingPoolConfigurator',
  //   LendingPoolConfigurator.hedera_mainnet.address
  // );

  // const txn = await lendingPoolConfigurator.setReserveInterestRateStrategyAddress(
  //   '0x000000000000000000000000000000000006f89a',
  //   '0x0000000000000000000000000000000000928b25'
  // );
  // await txn.wait();
  // console.log('Reserve strategy address updated');

  // const newReserveData = await lendingPoolContract.getReserveData(
  //   '0x000000000000000000000000000000000006f89a'
  // );
  // console.log('New Reserve data:', newReserveData);
}

async function main() {
  // await updateConfiguratorImpl();
  // await updateDecimals(6);
  // await updateReserveFactor();
  await updateReserveStrategyAddress();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
