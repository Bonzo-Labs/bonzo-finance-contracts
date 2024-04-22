// const hre = require('hardhat');
import { LendingPoolAddressesProvider } from '../outputReserveData.json';

async function main() {
  const provider = new hre.ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  const deployer = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log('Deployer address: ', deployer.address);
  console.log('Deploying contracts with the account:', deployer.address);

  // Deploy LiquidationFlashLoan contract
  const liquidationFLashLoanFactory = await hre.ethers.getContractFactory('LiquidationFlashLoan');
  const liquidationFLashLoanContract = await liquidationFLashLoanFactory.deploy(
    LendingPoolAddressesProvider.hedera_testnet.address
  );
  await liquidationFLashLoanContract.deployed();
  console.log(
    'liquidationFLashLoanContract contract deployed to:',
    liquidationFLashLoanContract.address
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
  });
