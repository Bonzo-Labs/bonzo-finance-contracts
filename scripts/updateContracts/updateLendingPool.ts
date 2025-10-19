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
const owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateLendingPool() {
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );

  const LendingPoolFactory = await ethers.getContractFactory('LendingPool', {
    libraries: {
      ReserveLogic: ReserveLogic.hedera_testnet.address,
      ValidationLogic: ValidationLogic.hedera_testnet.address,
    },
  });
  const lendingPoolImpl = await LendingPoolFactory.deploy();
  await lendingPoolImpl.deployed();
  console.log('Lending pool implementation deployed to:', lendingPoolImpl.address);

  const currentLendingPool = await lendingPoolAddressesProviderContract.getLendingPool();
  console.log('Current lending pool:', currentLendingPool);
  const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  const raw = await ethers.provider.getStorageAt(currentLendingPool, IMPL_SLOT);
  const currentLendingPoolImpl = ethers.utils.getAddress('0x' + raw.slice(-40));
  console.log('Current lending pool implementation:', currentLendingPoolImpl);
  console.log('New lending pool implementation:', lendingPoolImpl.address);

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
