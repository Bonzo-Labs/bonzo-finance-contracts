import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import { LendingPool } from './outputReserveData.json';

const oracleAddress = '0xB09f2276b26E890b363355a07Fe5c29D30C1e832';

async function supraPrices() {
  const [deployer] = await ethers.getSigners();
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('SupraOracle');
  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;
  const supra = new ethers.Contract(oracleAddress, abi, deployer);

  const lendingPoolArtifact = await hre.artifacts.readArtifact('LendingPool');
  const lendingPoolABI = lendingPoolArtifact.abi;
  const lendingPoolContract = new ethers.Contract(
    LendingPool.hedera_testnet.address,
    lendingPoolABI,
    deployer
  );

  // const DAI = '0x0000000000000000000000000000000000001599';
  const USDC = '0x0000000000000000000000000000000000001549';
  // const CLXY = '0x00000000000000000000000000000000000014f5';
  const HBARX = '0x0000000000000000000000000000000000220ced';
  const SAUCE = '0x0000000000000000000000000000000000120f46';
  const KARATE = '0x00000000000000000000000000000000003991ed';

  // const assetPriceDAI = await supra.getAssetPrice(DAI);
  // console.log('DAI price = ', ethers.utils.formatUnits(assetPriceDAI, 18));
  // const assetPriceDAIUSD = await supra.getAssetPriceInUSD(DAI);
  // console.log('DAI price in USD = ', ethers.utils.formatUnits(assetPriceDAIUSD, 18));

  // const assetPriceUSDC = await supra.getAssetPrice(USDC);
  // console.log('USDC price = ', ethers.utils.formatUnits(assetPriceUSDC, 18));
  // const assetPriceUSDCUSD = await supra.getAssetPriceInUSD(USDC);
  // console.log('USDC price in USD = ', ethers.utils.formatUnits(assetPriceUSDCUSD, 18));

  // const assetPriceCLXY = await supra.getAssetPrice(CLXY);
  // console.log('CLXY price = ', ethers.utils.formatUnits(assetPriceCLXY, 18));
  // const assetPriceCLXYUSD = await supra.getAssetPriceInUSD(CLXY);
  // console.log('CLXY price in USD = ', ethers.utils.formatUnits(assetPriceCLXYUSD, 18));

  // const assetPriceHBARX = await supra.getAssetPrice(HBARX);
  // console.log('HBARX price = ', ethers.utils.formatUnits(assetPriceHBARX, 18));
  // const assetPriceHBARXUSD = await supra.getAssetPriceInUSD(HBARX);
  // console.log('HBARX price in USD = ', ethers.utils.formatUnits(assetPriceHBARXUSD, 18));

  const assetPriceSAUCE = await supra.getAssetPrice(SAUCE);
  console.log('SAUCE price = ', ethers.utils.formatUnits(assetPriceSAUCE, 18));
  const assetPriceSAUCEUSD = await supra.getAssetPriceInUSD(SAUCE);
  console.log('SAUCE price in USD = ', ethers.utils.formatUnits(assetPriceSAUCEUSD, 18));

  const assetPriceKARATE = await supra.getAssetPrice(KARATE);
  console.log('KARATE price = ', ethers.utils.formatUnits(assetPriceKARATE, 18));
  const assetPriceKARATEUSD = await supra.getAssetPriceInUSD(KARATE);
  console.log('KARATE price in USD = ', ethers.utils.formatUnits(assetPriceKARATEUSD, 18));

  // const karatePriceFromLP = await lendingPoolContract.getAmountInEth(KARATE, 1);
  // console.log('KARATE price from LP = ', ethers.utils.formatUnits(karatePriceFromLP, 18));

  // const HbarUSD = await supra.getHbarUSD(10);
  // console.log('HBAR price raw =', HbarUSD.toString());
  // console.log('HBAR USD formatted = ', ethers.utils.formatUnits(HbarUSD, 18));
}

async function main() {
  await supraPrices();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
