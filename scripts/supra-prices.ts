import { ethers, network } from 'hardhat';
const hre = require('hardhat');

const oracleAddress = '0x29D62848c8fF12Eb68e200249138CE02819Ed4Be';

async function supraPrices() {
  const [deployer] = await ethers.getSigners();
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('SupraOracle');

  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;
  const supra = new ethers.Contract(oracleAddress, abi, deployer);

  const owner = await supra.owner();
  console.log('Owner = ', owner);

  // const txn = await supra.updateSupraSvalueFeed('0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917');
  // await txn.wait();
  // console.log('Supra S value feed updated');

  const valueFeed = await supra.getSupraSvalueFeed();
  console.log('Value feed = ', valueFeed);

  const price = await supra.getAssetPrice('0x0000000000000000000000000000000000220ced');
  const decimals = await supra.decimals();
  console.log('Price of SAUCE raw = ', price);
  const formattedPrice = ethers.utils.formatUnits(price, decimals);
  console.log('Price of SAUCE = ', formattedPrice);
  // const priceInUSD = await supra.getAssetPriceInUSD('0x0000000000000000000000000000000000120f46');
  // console.log('Price of SAUCE in USD = ', priceInUSD);
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
