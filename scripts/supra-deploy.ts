const hre = require('hardhat');
import { ethers, network } from 'hardhat';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

async function main() {
  let provider, owner;
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  }

  // Deploy Event contract
  const Supra = await hre.ethers.getContractFactory('SupraOracle');
  const supra = await Supra.deploy('0xD02cc7a670047b6b012556A88e275c685d25e0c9');
  await supra.deployed();
  console.log('Supra contract deployed to:', supra.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
  });
