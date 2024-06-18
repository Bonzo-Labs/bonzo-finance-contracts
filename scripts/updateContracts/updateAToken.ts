import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AToken,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateAToken(tokenAddress: string) {
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );

  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  //   //   Implement new aToken contract
  //   const aTokenFactory = await ethers.getContractFactory('AToken');
  //   const aTokenImpl = await aTokenFactory.deploy();
  //   await aTokenImpl.deployed();
  //   console.log('AToken implementation deployed to:', aTokenImpl.address);

  //   const aTokenImplAddress = '0xCfBc025d9ffCb049C091d823eaFB10c8638DDF77';

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
    incentivesController: HederaConfig.IncentivesController.hedera_testnet,
    name: 'Bonzo aToken HBARX',
    symbol: 'aBonzoHBARX',
    // implementation: aTokenImpl.address,
    implementation: aTokenImplAddress,
    params: '0x',
  };

  console.log('Updating aToken Input -', aTokenInput);
  const txn = await lendingPoolConfiguratorContract.updateAToken(aTokenInput);
  //   await txn.wait();
  console.log('aToken updated successfully');
}

async function main() {
  await updateAToken('0x0000000000000000000000000000000000220ced');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
