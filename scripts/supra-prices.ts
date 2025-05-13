import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import { LendingPool, AaveProtocolDataProvider, PriceOracle } from './outputReserveData.json';
import {
  KARATE,
  SAUCE,
  WHBAR,
  DOVU,
  STEAM,
  USDC,
  BONZO,
  KBL,
  GRELF,
  HBARX,
  XPACK,
} from './outputReserveData.json';
const { BigNumber } = require('ethers');
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner, newOwner;
let oracleAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  newOwner = new ethers.Wallet(process.env.PRIVATE_KEY3 || '', provider);
  // oracleAddress = PriceOracle.hedera_testnet.address;
  oracleAddress = '0x2ed0B2C432ABC7e8124D180Aa28950703c071ED6';
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  // oracleAddress = PriceOracle.hedera_mainnet.address;
  // oracleAddress = '0x24D08A1b5902C4c5e42956F786D3582e732e9E8d';
  oracleAddress = '0xA40a801E4F6Adc1Bb589ADc4f1999519C635dE50';
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}
async function setupContract(artifactName: string, contractAddress: string, owner: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function supraPrices() {
  console.log('Supra oracle address = ', oracleAddress);

  const supra = await setupContract('SupraOracle', oracleAddress, owner);
  // const usdcPrice = await supra.getUSDCPrice();
  // console.log('USDC price from Chainlink = ', usdcPrice.toString());

  // const lendingPoolContract = await setupContract(
  //   'LendingPool',
  //   LendingPool.hedera_testnet.address
  // );

  // const assetPriceUSDCUSD = await supra.getAssetPriceInUSD(USDC);
  // console.log('USDC price in USD = ', ethers.utils.formatUnits(assetPriceUSDCUSD, 18));

  const assetPriceHBARX = await supra.getAssetPrice(HBARX.hedera_testnet.token.address);
  console.log('HBARX price = ', ethers.utils.formatUnits(assetPriceHBARX, 18));
  // const assetPriceHBARXUSD = await supra.getAssetPriceInUSD(HBARX);
  // console.log('HBARX price in USD = ', ethers.utils.formatUnits(assetPriceHBARXUSD, 18));

  // console.log('Owner:', owner.address);
  // console.log('SAUCE token address: ', SAUCE.hedera_testnet.token.address);

  // const saucePriceIndex = await supra.getPriceFeed(SAUCE.hedera_testnet.token.address);
  // console.log('SAUCE price index:', saucePriceIndex.toString());

  // const assetPriceSAUCE = await supra.getAssetPrice(SAUCE.hedera_mainnet.token.address);
  // console.log('SAUCE price = ', ethers.utils.formatUnits(assetPriceSAUCE, 18));

  // const assetPriceKARATE = await supra.getAssetPrice(KARATE.hedera_mainnet.token.address);
  // console.log('KARATE price = ', ethers.utils.formatUnits(assetPriceKARATE, 18));

  // const assetPriceUSDCSupra = await supra.getAssetPriceLegacy(USDC.hedera_mainnet.token.address);
  // console.log('USDC price from Supra = ', ethers.utils.formatUnits(assetPriceUSDCSupra, 18));

  // const assetPriceUSDCChainlink = await supra.getAssetPrice(USDC.hedera_mainnet.token.address);
  // console.log(
  //   'USDC price from Chainlink = ',
  //   ethers.utils.formatUnits(assetPriceUSDCChainlink, 18)
  // );

  // const priceFeed = await supra.getPriceFeed('0x00000000000000000000000000000000000Ec585');
  // console.log('USDC price feed = ', priceFeed.toString());

  // const assetPriceDOVU = await supra.getAssetPrice(DOVU.hedera_mainnet.token.address);
  // console.log('DOVU price = ', ethers.utils.formatUnits(assetPriceDOVU, 18));

  // const assetPriceWSTEAM = await supra.getAssetPrice(STEAM.hedera_mainnet.token.address);
  // console.log('WSTEAM price = ', ethers.utils.formatUnits(assetPriceWSTEAM, 18));

  // const assetPriceBONZO = await supra.getAssetPrice(BONZO.hedera_mainnet.token.address);
  // console.log('BONZO price = ', ethers.utils.formatUnits(assetPriceBONZO, 18));

  // const assetPriceKBL = await supra.getAssetPrice(KBL.hedera_mainnet.token.address);
  // console.log('KBL price = ', ethers.utils.formatUnits(assetPriceKBL, 18));

  // const assetPriceGRELF = await supra.getAssetPrice(GRELF.hedera_mainnet.token.address);
  // console.log('GRELF price = ', ethers.utils.formatUnits(assetPriceGRELF, 18));

  // const assetPriceSAUCEUSD = await supra.getAssetPriceInUSD(SAUCE.hedera_mainnet.token.address);
  // console.log('SAUCE price in USD = ', ethers.utils.formatUnits(assetPriceSAUCEUSD, 18));

  // const assetPriceWHBAR = await supra.getAssetPrice(WHBAR.hedera_mainnet.token.address);
  // console.log('WHBAR price = ', ethers.utils.formatUnits(assetPriceWHBAR, 18));
  // const assetPriceWHBARUSD = await supra.getAssetPriceInUSD(WHBAR.hedera_mainnet.token.address);
  // console.log('WHBAR price in USD = ', ethers.utils.formatUnits(assetPriceWHBARUSD, 18));

  // const HbarUSD = await supra.getHbarUSD(10);
  // console.log('HBAR price raw =', HbarUSD.toString());
  // console.log('HBAR USD formatted = ', ethers.utils.formatUnits(HbarUSD, 18));

  // const supraOwner = await supra.owner();
  // console.log('Supra current owner = ', supraOwner);

  // const transferOwnershipTxn = await supra.transferOwnership(newOwner.address);
  // await transferOwnershipTxn.wait();
  // console.log('Ownership transferred initiated...');

  // console.log('Pending owner = ', await supra.pendingOwner());

  // const newSupraContract = await setupContract('SupraOracle', oracleAddress, newOwner);
  // const acceptOwnershipTxn = await newSupraContract.acceptOwnership();
  // await acceptOwnershipTxn.wait();
  // console.log('Ownership accepted...');
}

async function updateSupra() {
  // function updateAsset(
  //   string memory _name,
  //   address _asset,
  //   uint16 _newIndex,
  //   uint16 _newDecimals
  // ) external onlyOwner {
  const supra = await setupContract('SupraOracle', oracleAddress, owner);
  const supraOwner = await supra.owner();
  console.log('Supra current owner = ', supraOwner);

  // const updateAssetTxn = await supra.updateAsset('USDC', USDC.hedera_mainnet.token.address, 505, 6);
  // await updateAssetTxn.wait();
  // console.log('Asset updated...');
}

async function main() {
  await supraPrices();
  // await updateSupra();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
