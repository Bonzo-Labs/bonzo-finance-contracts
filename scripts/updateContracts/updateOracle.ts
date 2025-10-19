import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolAddressesProvider } from '../outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
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

  const contractOwner = await lendingPoolAddressesProviderContract.owner();
  console.log('Lending Pool Addresses Provider Owner:', contractOwner);
  console.log('Signer:', owner.address);

  // 0x24D08A1b5902C4c5e42956F786D3582e732e9E8d
  console.log('Oracle before = ', await lendingPoolAddressesProviderContract.getPriceOracle());

  await lendingPoolAddressesProviderContract.setPriceOracle(oracleAddress);
  console.log('Oracle after = ', await lendingPoolAddressesProviderContract.getPriceOracle());
}

async function main() {
  await updateOracle('0x16e55AF5576502e05ed18fD265F8dF7fC6f8ACbd');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
