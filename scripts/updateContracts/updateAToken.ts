import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AToken,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

// AToken implementation deployed to: 0x88DeEAA4A4Ad9Fb937DE179Ee629840e14A1690E

async function updateAToken(tokenAddress: string) {
  // const lendingPoolAddressesProviderContract = await setupContract(
  //   'LendingPoolAddressesProvider',
  //   LendingPoolAddressesProvider.hedera_testnet.address
  // );

  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  //   Implement new aToken contract
  const aTokenFactory = await ethers.getContractFactory('AToken');
  const aTokenImpl = await aTokenFactory.deploy();
  await aTokenImpl.deployed();
  console.log('AToken implementation deployed to:', aTokenImpl.address);

  type ATokenInput = {
    asset: string;
    treasury: string;
    incentivesController: string;
    name: string;
    symbol: string;
    implementation: string;
    params: string;
  };

  const aTokenInput: ATokenInput = {
    asset: tokenAddress,
    treasury: owner.address,
    // @ts-ignore
    incentivesController: HederaConfig.IncentivesController.hedera_testnet,
    name: 'Bonzo aToken WHBAR',
    symbol: 'aBonzoWHBAR',
    implementation: aTokenImpl.address,
    params: '0x',
  };

  console.log('Updating aToken Input -', aTokenInput);
  const txn = await lendingPoolConfiguratorContract.updateAToken(aTokenInput);
  await txn.wait();
  console.log('aToken updated successfully');
}

async function main() {
  await updateAToken('0x0000000000000000000000000000000000003ad2');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
