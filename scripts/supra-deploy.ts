const hre = require('hardhat');

async function main() {
  const provider = new hre.ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  const deployer = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log('Deploying contracts with the account:', deployer.address);

  // Deploy Event contract
  const Supra = await hre.ethers.getContractFactory('SupraOracle');
  const supra = await Supra.deploy('0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917');
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
