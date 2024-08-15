const hre = require('hardhat');

async function main() {
  const api_key = process.env.QUICKNODE_API_KEY;
  const quicknode_url = `https://serene-long-resonance.hedera-mainnet.quiknode.pro/${api_key}/`;

  const provider = new hre.ethers.providers.JsonRpcProvider(quicknode_url);
  const deployer = new hre.ethers.Wallet(process.env.PRIVATE_KEY_MAINNET, provider);
  console.log('Deploying contracts with the account:', deployer.address);

  // Deploy Event contract
  const Supra = await hre.ethers.getContractFactory('SupraOracle');
  const supra = await Supra.deploy('0xD02cc7a670047b6b012556A88e275c685d25e0c9');
  await supra.deployed();
  console.log('Supra contract deployed to:', supra.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
  });
