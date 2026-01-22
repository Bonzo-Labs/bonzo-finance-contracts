const hre = require('hardhat');
import { ethers, network } from 'hardhat';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

async function main() {
  console.log(`\n=== Deploying SupraOracle for ${chain_type} ===\n`);

  let provider,
    owner,
    supraFeed,
    hbar_usd_chainlinkFeed,
    usdc_usd_chainlinkFeed,
    eth_usd_chainlinkFeed;

  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    supraFeed = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
    hbar_usd_chainlinkFeed = '0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a';
    usdc_usd_chainlinkFeed = '0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5';
    eth_usd_chainlinkFeed = ethers.constants.AddressZero; // Not used on testnet
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    if (!url) {
      throw new Error(
        'PROVIDER_URL_MAINNET environment variable is required for mainnet deployment'
      );
    }
    provider = new ethers.providers.JsonRpcProvider(url);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
    hbar_usd_chainlinkFeed = '0xAF685FB45C12b92b5054ccb9313e135525F9b5d5';
    usdc_usd_chainlinkFeed = '0x2b358642c7C37b6e400911e4FE41770424a7349F';
    eth_usd_chainlinkFeed = '0xd2D2CB0AEb29472C3008E291355757AD6225019e';
    supraFeed = '0xD02cc7a670047b6b012556A88e275c685d25e0c9';
  } else {
    throw new Error(
      `Unsupported chain_type: ${chain_type}. Must be 'hedera_testnet' or 'hedera_mainnet'`
    );
  }

  // Validate that all required addresses are set
  if (!supraFeed || !hbar_usd_chainlinkFeed || !usdc_usd_chainlinkFeed) {
    throw new Error('Missing required feed addresses for deployment');
  }
  if (chain_type === 'hedera_mainnet' && !eth_usd_chainlinkFeed) {
    throw new Error('ETH_USD Chainlink feed is required for mainnet deployment');
  }

  console.log('Chain Type:', chain_type);
  console.log('Owner:', owner.address);
  console.log('Supra Feed:', supraFeed);
  console.log('HBAR/USD Chainlink Feed:', hbar_usd_chainlinkFeed);
  console.log('USDC/USD Chainlink Feed:', usdc_usd_chainlinkFeed);
  console.log('ETH/USD Chainlink Feed:', eth_usd_chainlinkFeed);
  console.log('');
  // Deploy Event contract
  const Supra = await hre.ethers.getContractFactory('SupraOracle');
  const supra = await Supra.deploy(
    supraFeed,
    hbar_usd_chainlinkFeed,
    usdc_usd_chainlinkFeed,
    eth_usd_chainlinkFeed
  );
  await supra.deployed();
  console.log('\n✅ SupraOracle deployed successfully!');
  console.log('Contract Address:', supra.address);
  console.log('\nNote: The contract is configured with mainnet token addresses:');
  console.log('  - USDC: 0x000000000000000000000000000000000006f89a');
  console.log('  - WHBAR: 0x0000000000000000000000000000000000163B5a');
  console.log('  - WETH: 0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2');
  console.log('And mainnet asset addresses (KARATE, HBARX, SAUCE, etc.)\n');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
  });
