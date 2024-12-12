import { ethers } from 'hardhat';
const hre = require('hardhat');
import { LendingPoolConfigurator } from './outputReserveData.json';
import {
  USDC,
  HBARX,
  SAUCE,
  XSAUCE,
  KARATE,
  WHBAR,
  BUSDC,
  BDOVU,
  BHBARX,
  BHST,
  BKARATE,
  BPACK,
  BSAUCE,
  BSTEAM,
  BxSAUCE,
  DOVU,
  PACK,
  HST,
  STEAM,
} from './outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let reserves, supplyCaps, borrowCaps;

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
  reserves = [WHBAR, HBARX, USDC, SAUCE, XSAUCE, KARATE, DOVU, PACK, HST, STEAM];
  borrowCaps = [
    9268455, 14975362, 961042, 2455823, 13917964, 117808061, 89258923, 873709, 12065370, 5585154,
  ];
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

const MAX_VALID_SUPPLY_CAP = 68719476735;

async function setSupplyAndBorrowCaps() {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator[chain_type].address
  );
  console.log('Owner:', owner.address);

  const reserveAssets =
    chain_type === 'hedera_testnet'
      ? [BUSDC, BDOVU, BHBARX, BHST, BKARATE, BPACK, BSAUCE, BSTEAM, BxSAUCE]
      : [BUSDC, BDOVU, BHBARX, BHST, BKARATE, BPACK, BSAUCE, BSTEAM, BxSAUCE];

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

async function supplyCap() {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator[chain_type].address
  );
  console.log('Owner:', owner.address);

  const reserveAssets = [BHBARX];

  for (let i = 0; i < reserveAssets.length; i++) {
    const asset = reserveAssets[i];
    const assetAddress = asset[chain_type].token.address;
    const supplyCap = supplyCaps[i];

    console.log(`Setting caps for ${Object.keys(reserveAssets)[i]}:`);

    // Set and get Supply Cap
    const currentSupplyCap = await lendingPoolConfiguratorContract.getSupplyCap(assetAddress);
    console.log('Current Supply Cap:', currentSupplyCap.toString());

    const setSupplyCapTxn = await lendingPoolConfiguratorContract.setSupplyCap(
      assetAddress,
      MAX_VALID_SUPPLY_CAP
    );
    await setSupplyCapTxn.wait();

    const newSupplyCap = await lendingPoolConfiguratorContract.getSupplyCap(assetAddress);
    console.log('New Supply Cap:', newSupplyCap.toString());
  }
}

async function borrowCap() {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator[chain_type].address
  );
  console.log('Owner:', owner.address);

  for (let i = 0; i < reserves.length; i++) {
    const asset = reserves[i];
    const assetAddress = asset[chain_type].token.address;
    const borrowCap = borrowCaps[i];

    console.log(`Setting borrow cap of ${borrowCaps[i]} for ${assetAddress}:`);

    // Set and get Borrow Cap
    const currentBorrowCap = await lendingPoolConfiguratorContract.getBorrowCap(assetAddress);
    console.log('Current borrow Cap:', currentBorrowCap.toString());

    const setBorrowCapTxn = await lendingPoolConfiguratorContract.setBorrowCap(
      assetAddress,
      borrowCap
    );
    await setBorrowCapTxn.wait();

    const newBorrowCap = await lendingPoolConfiguratorContract.getBorrowCap(assetAddress);
    console.log('New borrow Cap:', newBorrowCap.toString());
  }
}

async function main() {
  // await setSupplyAndBorrowCaps();
  // await supplyCap();
  await borrowCap();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
