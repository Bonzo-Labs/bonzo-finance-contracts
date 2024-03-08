import { ethers, network } from 'hardhat';
const hre = require('hardhat');

const oracleAddress = '0x4dFBBca56682dC1Dc7672D98F0dadf6f5818Fea8';

async function supraPrices() {
  const [deployer] = await ethers.getSigners();
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('SupraOracle');

  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;
  const supra = new ethers.Contract(oracleAddress, abi, deployer);

  const price = await supra.getAssetPrice('0x00000000000000000000000000000000000014F5');
  const decimals = await supra.decimals();
  console.log('Price of CLXY raw = ', price);
  const formattedPrice = ethers.utils.formatUnits(price, decimals);
  console.log('Price of CLXY = ', formattedPrice);
  const priceInUSD = await supra.getAssetPriceInUSD('0x00000000000000000000000000000000000014F5');
  console.log('Price of CLXY in USD = ', priceInUSD);
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
