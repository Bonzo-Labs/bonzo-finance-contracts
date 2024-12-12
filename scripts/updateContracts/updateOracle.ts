import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolAddressesProvider } from '../outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_testnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateOracle(oracleAddress: string) {
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  await lendingPoolAddressesProviderContract.setPriceOracle(oracleAddress);
  console.log('Oracle after = ', await lendingPoolAddressesProviderContract.getPriceOracle());
}

async function main() {
  await updateOracle('0xBb626B1fc8cBcdB24AAE0070691cecc26Ce59A8B');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
