const hre = require('hardhat');
import { ethers, network } from 'hardhat';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

async function main() {
  let provider, owner, supraFeed, hbar_usd_chainlinkFeed, usdc_usd_chainlinkFeed;
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    supraFeed = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
    hbar_usd_chainlinkFeed = '0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a';
    usdc_usd_chainlinkFeed = '0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5';
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
    hbar_usd_chainlinkFeed = '0xAF685FB45C12b92b5054ccb9313e135525F9b5d5';
    usdc_usd_chainlinkFeed = '0x2b358642c7C37b6e400911e4FE41770424a7349F';
    supraFeed = '0xD02cc7a670047b6b012556A88e275c685d25e0c9';
  }

  console.log('Owner:', owner.address);
  console.log('Provider = ', provider);
  console.log('Supra Feed = ', supraFeed);
  // Deploy Event contract
  const Supra = await hre.ethers.getContractFactory('SupraOracle');
  const supra = await Supra.deploy(supraFeed, hbar_usd_chainlinkFeed, usdc_usd_chainlinkFeed);
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
