import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import { LendingPoolConfigurator } from '../deployed-contracts.json';
import HederaConfig from '../markets/hedera/index';
import { eHederaNetwork } from '../helpers/types';
import {
  BKARATE,
  BDOVU,
  BPACK,
  WHBAR,
  HBARX,
  USDC,
  SAUCE,
  XSAUCE,
  KARATE,
  DOVU,
  PACK,
  HST,
  STEAM,
} from './outputReserveData.json';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
let provider, wallet, contractAddress, ReserveAssets;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  contractAddress = LendingPoolConfigurator.hedera_testnet.address;
  // ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_testnet];
  ReserveAssets = [
    BKARATE.hedera_testnet.token.address,
    BDOVU.hedera_testnet.token.address,
    BPACK.hedera_testnet.token.address,
  ];
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
  contractAddress = LendingPoolConfigurator.hedera_mainnet.address;
  ReserveAssets = [
    // WHBAR.hedera_mainnet.token.address,
    // HBARX.hedera_mainnet.token.address,
    USDC.hedera_mainnet.token.address,
    // SAUCE.hedera_mainnet.token.address,
    // XSAUCE.hedera_mainnet.token.address,
    // KARATE.hedera_mainnet.token.address,
    // DOVU.hedera_mainnet.token.address,
    // PACK.hedera_mainnet.token.address,
    // HST.hedera_mainnet.token.address,
    // STEAM.hedera_mainnet.token.address,
  ];
}

async function disableBorrowing() {
  console.log('Owner address: ', wallet.address);

  const contractArtifacts = await hre.artifacts.readArtifact('LendingPoolConfigurator');
  const abi = contractArtifacts.abi;

  const lendingPoolConfiguratorContract = new ethers.Contract(contractAddress, abi, wallet);

  console.log('Reserve Assets: ', ReserveAssets);

  for (const reserve of ReserveAssets) {
    console.log(`Disabling borrowing for asset: ${reserve}`);
    try {
      const disableTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(reserve);
      await disableTxn.wait();
      console.log(`Borrowing disabled for asset ${reserve}`);
    } catch (error) {
      console.error(`Error disabling borrowing for asset ${reserve}:`, error);
    }
  }
}

async function enableBorrowing() {
  console.log('Owner address: ', wallet.address);

  const contractArtifacts = await hre.artifacts.readArtifact('LendingPoolConfigurator');
  const abi = contractArtifacts.abi;

  const lendingPoolConfiguratorContract = new ethers.Contract(contractAddress, abi, wallet);

  console.log('Reserve Assets: ', ReserveAssets);

  for (const reserve of ReserveAssets) {
    console.log(`Enabling borrowing for asset: ${reserve}`);
    try {
      const enableTxn = await lendingPoolConfiguratorContract.enableBorrowingOnReserve(
        reserve,
        false
      );
      await enableTxn.wait();
      console.log(`Borrowing enabled for asset ${reserve}`);
    } catch (error) {
      console.error(`Error enabling borrowing for asset ${reserve}:`, error);
    }
  }
}

async function main() {
  // await disableBorrowing();
  await enableBorrowing();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in script execution:', error);
    process.exit(1);
  });
