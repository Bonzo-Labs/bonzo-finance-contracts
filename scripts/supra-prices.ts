import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import { LendingPool, AaveProtocolDataProvider, PriceOracle } from './outputReserveData.json';
import { KARATE, SAUCE, WHBAR } from './outputReserveData.json';
const { BigNumber } = require('ethers');
require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

const api_key = process.env.QUICKNODE_API_KEY;
const quicknode_url = `https://serene-long-resonance.hedera-mainnet.quiknode.pro/${api_key}/`;

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_testnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);

  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}
async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function supraPrices() {
  const [deployer] = await ethers.getSigners();
  // const supra = await setupContract('SupraOracle', PriceOracle.hedera_testnet.address);
  const supra = await setupContract('SupraOracle', '0xAe9706419E60B5c4E92D45f6ab79439D266F87eD');

  // const lendingPoolContract = await setupContract(
  //   'LendingPool',
  //   LendingPool.hedera_testnet.address
  // );

  // const assetPriceDAI = await supra.getAssetPrice(DAI);
  // console.log('DAI price = ', ethers.utils.formatUnits(assetPriceDAI, 18));
  // const assetPriceDAIUSD = await supra.getAssetPriceInUSD(DAI);
  // console.log('DAI price in USD = ', ethers.utils.formatUnits(assetPriceDAIUSD, 18));

  // const assetPriceUSDC = await supra.getAssetPrice(USDC);
  // console.log('USDC price = ', ethers.utils.formatUnits(assetPriceUSDC, 18));
  // const assetPriceUSDCUSD = await supra.getAssetPriceInUSD(USDC);
  // console.log('USDC price in USD = ', ethers.utils.formatUnits(assetPriceUSDCUSD, 18));

  // const assetPriceHBARX = await supra.getAssetPrice(HBARX);
  // console.log('HBARX price = ', ethers.utils.formatUnits(assetPriceHBARX, 18));
  // const assetPriceHBARXUSD = await supra.getAssetPriceInUSD(HBARX);
  // console.log('HBARX price in USD = ', ethers.utils.formatUnits(assetPriceHBARXUSD, 18));

  console.log('Owner:', owner.address);

  const saucePriceIndex = await supra.getPriceFeed(SAUCE.hedera_testnet.token.address);
  console.log('SAUCE price index:', saucePriceIndex.toString());

  const assetPriceSAUCE = await supra.getAssetPrice(SAUCE.hedera_testnet.token.address);
  console.log('SAUCE price = ', ethers.utils.formatUnits(assetPriceSAUCE, 18));

  const assetPriceWHBAR = await supra.getAssetPrice(WHBAR.hedera_testnet.token.address);
  console.log('WHBAR price = ', ethers.utils.formatUnits(assetPriceWHBAR, 18));

  // const assetPriceSAUCEUSD = await supra.getAssetPriceInUSD(KARATE);
  // console.log('SAUCE price in USD = ', ethers.utils.formatUnits(assetPriceSAUCEUSD, 18));

  // const assetPriceWHBAR = await supra.getAssetPrice(WHBAR);
  // console.log('WHBAR price = ', ethers.utils.formatUnits(assetPriceWHBAR, 18));
  // const assetPriceWHBARUSD = await supra.getAssetPriceInUSD(WHBAR);
  // console.log('WHBAR price in USD = ', ethers.utils.formatUnits(assetPriceWHBARUSD, 18));

  // const HbarUSD = await supra.getHbarUSD(10);
  // console.log('HBAR price raw =', HbarUSD.toString());
  // console.log('HBAR USD formatted = ', ethers.utils.formatUnits(HbarUSD, 18));
}

async function getCollateralTokens() {
  const oracleContract = await setupContract('SupraOracle', oracleAddress);
  const aTokenContract = await setupContract('AToken', KARATE.aToken.address);
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_testnet.address
  );

  // Example configuration value from your data
  const configurationValue = BigNumber.from('36912873374162650469256');

  // Extract bits 48-55 (8 bits) for decimals
  const decimalBits = configurationValue.shr(48).and(0xff).toNumber();

  console.log(`Decimals: ${decimalBits}`);

  // const numTokens = await aTokenContract.balanceOf(owner.address);
  // console.log('Number of tokens = ', ethers.utils.formatUnits(numTokens, 8));
  // const tokenValueETH = await oracleContract.getAmountInEth(numTokens, KARATE.token.address);
  // console.log('Token value in ETH from Oracle = ', ethers.utils.formatUnits(tokenValueETH, 18));

  // const tokenValueETHLP = await lendingPoolContract.getAmountInEth(numTokens, KARATE.token.address);
  // console.log('Token value in ETH from LP = ', ethers.utils.formatUnits(tokenValueETHLP, 18));

  // const karatePrice = await oracleContract.getAssetPrice(KARATE.token.address);
  // console.log('KARATE price = ', ethers.utils.formatUnits(karatePrice, 18));
  // const realValue = Number(ethers.utils.formatUnits(numTokens, 8)) * karatePrice;
  // console.log('Real value = ', ethers.utils.formatUnits(realValue, 18));

  // const userAccountData = await lendingPoolContract.getUserAccountData(owner.address);
  // console.log(
  //   'User total collateral ETH = ',
  //   ethers.utils.formatUnits(userAccountData.totalCollateralETH, 18)
  // );

  // const userReserveData = await lendingPoolContract.getReserveData(
  //   '0x00000000000000000000000000000000003991ed'
  // );
  // console.log('Karate reserve data = ', userReserveData);
}

async function main() {
  await supraPrices();
  // await getCollateralTokens();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
