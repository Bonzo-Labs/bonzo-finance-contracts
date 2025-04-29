const hre = require('hardhat');
const { ethers } = require('hardhat');
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

// WSTEAM testnet contract deployed to: 0x06da3554b380de078027157C4DDcef5E2056D82D
// WSteam testnet Token: 0x00000000000000000000000000000000004d6427

// WSTEAM mainnet contract deployed to: 0xED613fb9b890fd14024EaB338b7595B81Dd60aF9
// WSteam mainnet Token: 0x0000000000000000000000000000000000737a3F

async function main() {
  let provider, owner, steamToken;
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider(
      'https://testnet.hedera.validationcloud.io/v1/ViRFHy6Qx3lJYrY5NI76S8oHwMcRiQxnJBQ_5g-C25A'
    );
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    steamToken = '0x00000000000000000000000000000000004d50fe';
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
    steamToken = '0x000000000000000000000000000000000030fb8b';
  }

  try {
    // Deploy WSTEAM contract
    const WSTEAM = await hre.ethers.getContractFactory('WSTEAM');
    const wsteam = await WSTEAM.connect(owner).deploy(steamToken, {
      gasLimit: 13800000,
      value: ethers.utils.parseEther('30'),
    });
    console.log('Deploying WSTEAM contract...');
    await wsteam.deployed();
    console.log('WSTEAM contract deployed to:', wsteam.address);

    const WSteamToken = await wsteam.token();
    console.log('WSteam Token:', WSteamToken);
  } catch (error: any) {
    console.error('An error occurred during deployment:', error);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
  });
