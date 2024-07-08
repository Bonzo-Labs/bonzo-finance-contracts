import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolAddressesProvider } from '../outputReserveData.json';

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

  await lendingPoolAddressesProviderContract.setPriceOracle(oracleAddress);
  console.log('Oracle after = ', await lendingPoolAddressesProviderContract.getPriceOracle());
}

async function main() {
  await updateOracle('0xfac891666D590E277D8F4ff601C50D51B57179c4');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
