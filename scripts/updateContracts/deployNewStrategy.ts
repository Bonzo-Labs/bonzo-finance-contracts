import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolAddressesProvider } from '../outputReserveDataCurrent.json';
import { rateStrategyVolatileThree } from '../../markets/hedera/rateStrategies';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function deployNewStrategy(strategy: any) {
  const [deployer] = await ethers.getSigners();

  //     ILendingPoolAddressesProvider provider,
  //     uint256 optimalUtilizationRate,
  //     uint256 baseVariableBorrowRate,
  //     uint256 variableRateSlope1,
  //     uint256 variableRateSlope2,
  //     uint256 stableRateSlope1,
  //     uint256 stableRateSlope2
  const deploymentArgs = {
    provider: LendingPoolAddressesProvider.hedera_testnet.address,
    optimalUtilizationRate: strategy.optimalUtilizationRate,
    baseVariableBorrowRate: strategy.baseVariableBorrowRate,
    variableRateSlope1: strategy.variableRateSlope1,
    variableRateSlope2: strategy.variableRateSlope2,
    stableRateSlope1: strategy.stableRateSlope1,
    stableRateSlope2: strategy.stableRateSlope2,
  };

  console.log('Owner:', owner.address);

  const rateStrategyContract = await hre.ethers.getContractFactory(
    'DefaultReserveInterestRateStrategy'
  );
  const rateStrategy = await rateStrategyContract.deploy(
    deploymentArgs.provider,
    deploymentArgs.optimalUtilizationRate,
    deploymentArgs.baseVariableBorrowRate,
    deploymentArgs.variableRateSlope1,
    deploymentArgs.variableRateSlope2,
    deploymentArgs.stableRateSlope1,
    deploymentArgs.stableRateSlope2
  );
  await rateStrategy.deployed();
  console.log('Rate Strategy deployed to:', rateStrategy.address);
}

async function main() {
  await deployNewStrategy(rateStrategyVolatileThree);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
