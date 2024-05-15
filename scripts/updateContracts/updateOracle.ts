import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateOracle(oracleAddress: string) {
  const [deployer] = await ethers.getSigners();

  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );

  console.log('Owner:', owner.address);
  console.log('Oracle before = ', await lendingPoolAddressesProviderContract.getOracle());
  await lendingPoolAddressesProviderContract.setOracle(oracleAddress);
  console.log('Oracle after = ', await lendingPoolAddressesProviderContract.getOracle());
}

async function main() {
  await updateOracle('0x0000000000000000000000000000000000120f46');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
