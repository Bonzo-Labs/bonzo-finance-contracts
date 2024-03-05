import { ethers, network } from 'hardhat';
const hre = require('hardhat');

const oracleAddress = '0x97D61d8e1E69bb414742857A65cAcEd6fadFe672';

async function supraPrices() {
  const [deployer] = await ethers.getSigners();
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('SupraOracle');

  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;
  const supra = new ethers.Contract(oracleAddress, abi, deployer);

  const price1 = await supra.getAssetPrice('0x00000000000000000000000000000000000014F5');
  const formattedPrice = ethers.utils.formatUnits(price1.price, price1.decimals);
  console.log('Price of CLXY = ', formattedPrice);
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
