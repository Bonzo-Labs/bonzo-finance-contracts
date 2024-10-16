import { ethers } from 'hardhat';
const hre = require('hardhat');
import { LendingPoolConfigurator } from './outputReserveData.json';
import { USDC, HBARX, SAUCE, XSAUCE, KARATE, WHBAR, DOVU, HST } from './outputReserveData.json';

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

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

// Define arrays for supply and borrow caps
const supplyCaps = [500, 500, 500, 500, 500, 500];
const borrowCaps = [300, 300, 300, 300, 300, 300];

async function setSupplyAndBorrowCaps() {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator[chain_type].address
  );
  console.log('Owner:', owner.address);

  const reserveAssets =
    chain_type === 'hedera_testnet'
      ? [USDC, HBARX, SAUCE, XSAUCE, KARATE, WHBAR]
      : [USDC, HBARX, SAUCE, XSAUCE, KARATE, WHBAR];

  for (let i = 0; i < reserveAssets.length; i++) {
    const asset = reserveAssets[i];
    const assetAddress = asset[chain_type].token.address;
    const supplyCap = supplyCaps[i];
    const borrowCap = borrowCaps[i];

    console.log(`Setting caps for ${Object.keys(reserveAssets)[i]}:`);

    // Set and get Supply Cap
    const currentSupplyCap = await lendingPoolConfiguratorContract.getSupplyCap(assetAddress);
    console.log('Current Supply Cap:', currentSupplyCap.toString());

    const setSupplyCapTxn = await lendingPoolConfiguratorContract.setSupplyCap(
      assetAddress,
      supplyCap
    );
    await setSupplyCapTxn.wait();

    const newSupplyCap = await lendingPoolConfiguratorContract.getSupplyCap(assetAddress);
    console.log('New Supply Cap:', newSupplyCap.toString());

    // Set and get Borrow Cap
    const currentBorrowCap = await lendingPoolConfiguratorContract.getBorrowCap(assetAddress);
    console.log('Current Borrow Cap:', currentBorrowCap.toString());

    const setBorrowCapTxn = await lendingPoolConfiguratorContract.setBorrowCap(
      assetAddress,
      borrowCap
    );
    await setBorrowCapTxn.wait();

    const newBorrowCap = await lendingPoolConfiguratorContract.getBorrowCap(assetAddress);
    console.log('New Borrow Cap:', newBorrowCap.toString());

    console.log('---');
    // Sleep for 30 sec
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

async function main() {
  await setSupplyAndBorrowCaps();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
