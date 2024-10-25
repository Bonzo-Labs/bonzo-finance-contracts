import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import { LendingPoolConfigurator } from '../deployed-contracts.json';
import HederaConfig from '../markets/hedera/index';
import { eHederaNetwork } from '../helpers/types';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

async function disableBorrowing() {
  let provider, wallet, contractAddress, ReserveAssets;

  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    wallet = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    contractAddress = LendingPoolConfigurator.hedera_testnet.address;
    ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_testnet];
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    wallet = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
    contractAddress = LendingPoolConfigurator.hedera_mainnet.address;
    ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_mainnet];
  }

  console.log('Owner address: ', wallet.address);

  const contractArtifacts = await hre.artifacts.readArtifact('LendingPoolConfigurator');
  const abi = contractArtifacts.abi;

  const lendingPoolConfiguratorContract = new ethers.Contract(contractAddress, abi, wallet);

  console.log('Reserve Assets: ', ReserveAssets);

  for (const key in ReserveAssets) {
    const assetAddress = ReserveAssets[key];
    console.log(`Disabling borrowing for asset: ${key} at address: ${assetAddress}`);
    try {
      const disableTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
        assetAddress
      );
      await disableTxn.wait();
      console.log(`Borrowing disabled for asset ${key}`);
    } catch (error) {
      console.error(`Error disabling borrowing for asset ${key}:`, error);
    }
  }
}

async function main() {
  await disableBorrowing();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in script execution:', error);
    process.exit(1);
  });
