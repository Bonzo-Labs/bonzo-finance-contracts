import { ethers, network } from 'hardhat';
const hre = require('hardhat');

const flashloanContractAddress = '0x229576e662Fe99336A00Ee0349D69238b19B30d3';

async function getLoan() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer address: ', deployer.address);
  // Load the contract artifacts
  const contractArtifacts = await hre.artifacts.readArtifact('LiquidationFlashLoan');
  // The ABI is now available as a JavaScript object
  const abi = contractArtifacts.abi;
  const liquidationFLashLoanContract = new ethers.Contract(flashloanContractAddress, abi, deployer);
  console.log('LiquidationFlashLoan contract: ', liquidationFLashLoanContract);

  const getLoanTxn = await liquidationFLashLoanContract.myFlashLoanCall();
  await getLoanTxn.wait();
  console.log('Flashloan call hash = ', getLoanTxn.hash);
}

async function main() {
  await getLoan();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
