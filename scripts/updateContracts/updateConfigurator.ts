import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolAddressesProvider, LendingPoolConfigurator } from '../outputReserveData.json';

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
    LendingPoolAddressesProvider.hedera_testnet.address
  );

  // // Ensure the owner of the contract
  // const contractOwner = await lendingPoolAddressesProviderContract.owner();
  // console.log('Contract Owner:', contractOwner);
  // if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
  //   throw new Error('Caller is not the owner');
  // }

  // // Deploy the new LendingPoolConfigurator implementation
  // const NewLendingPoolConfiguratorImpl = await ethers.getContractFactory('LendingPoolConfigurator');
  // const newImpl = await NewLendingPoolConfiguratorImpl.deploy();
  // await newImpl.deployed();
  // console.log('New implementation deployed at:', newImpl.address);

  // const pool = await lendingPoolAddressesProviderContract.getLendingPool();
  // console.log('LendingPool:', pool);

  // // Set the new implementation and initialize it
  // const tx = await lendingPoolAddressesProviderContract.setLendingPoolConfiguratorImpl(
  //   '0x760f9A0e5939e57B8253A969CF2151fFa1Bf8A4e'
  // );
  // await tx.wait();

  console.log('Configurator implementation updated and initialized');
}

async function updateDecimals(newDecimals) {
  const lendingPoolConfigurator = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );
  const currentDecimals = await lendingPoolConfigurator.getDecimals();
  console.log('Current decimals:', currentDecimals.toString());
  await lendingPoolConfigurator.setDecimals(newDecimals);
  console.log('Decimals updated');
  const newDecimalsAfter = await lendingPoolConfigurator.getDecimals();
  console.log('New decimals:', newDecimalsAfter.toString());
}

async function main() {
  await updateConfiguratorImpl();
  //   await updateDecimals(8);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
