const hre = require('hardhat');
const { ethers } = require('hardhat');
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

// WSTEAM contract deployed to: 0x9dA63E6639544f95407aEaFBBEafe026a23C49D0
// WSteam Token: 0x00000000000000000000000000000000004d6303

async function main() {
  let provider, owner;
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider(
      'https://testnet.hedera.validationcloud.io/v1/ViRFHy6Qx3lJYrY5NI76S8oHwMcRiQxnJBQ_5g-C25A'
    );
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  }

  try {
    // Deploy WSTEAM contract
    const WSTEAM = await hre.ethers.getContractFactory('WSTEAM');
    const wsteam = await WSTEAM.connect(owner).deploy(
      '0x00000000000000000000000000000000004d50fe',
      {
        gasLimit: 13800000,
        value: ethers.utils.parseEther('30'),
      }
    );
    console.log('Deploying WSTEAM contract...');
    await wsteam.deployed();
    console.log('WSTEAM contract deployed to:', wsteam.address);

    const WSteamToken = await wsteam.token();
    console.log('WSteam Token:', WSteamToken);
  } catch (error: any) {
    console.error('An error occurred during deployment:');
    if (error.error && error.error.data) {
      console.error('Error data:', error.error.data);
    } else if (error.data) {
      console.error('Error data:', error.data);
    } else if (error.message) {
      console.error('Error message:', error.message);
    } else {
      console.error('Unknown error:', error);
    }
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('An unexpected error occurred:');
    if (error.message) {
      console.error('Error message:', error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
