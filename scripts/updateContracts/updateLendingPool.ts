import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AToken,
  ReserveLogic,
  ValidationLogic,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateLendingPool() {
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );
  console.log('Owner:', owner.address);

  const LendingPoolFactory = await ethers.getContractFactory('LendingPool', {
    libraries: {
      ReserveLogic: ReserveLogic.hedera_testnet.address,
      ValidationLogic: ValidationLogic.hedera_testnet.address,
    },
  });
  const lendingPoolImpl = await LendingPoolFactory.deploy();
  await lendingPoolImpl.deployed();
  console.log('Lending pool implementation deployed to:', lendingPoolImpl.address);

  console.log('Updating Lending pool');
  // Set the new implementation and initialize it
  const tx = await lendingPoolAddressesProviderContract.setLendingPoolImpl(lendingPoolImpl.address);
  await tx.wait();
  console.log('Lending pool updated successfully');
}

async function main() {
  await updateLendingPool();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
