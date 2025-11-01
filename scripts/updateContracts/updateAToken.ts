import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AToken,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY3 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
}
async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateAToken(tokenAddress: string, tokenName: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  console.log('Owner:', owner.address);

  //   Implement new aToken contract
  const aTokenFactory = await ethers.getContractFactory('AToken');
  const aTokenImpl = await aTokenFactory.deploy();
  await aTokenImpl.deployed();
  console.log('AToken implementation deployed to:', aTokenImpl.address);
  // const aTokenImpl = AToken.hedera_testnet.address;

  // type ATokenInput = {
  //   asset: string;
  //   treasury: string;
  //   incentivesController: string;
  //   name: string;
  //   symbol: string;
  //   implementation: string;
  //   params: string;
  // };

  // const aTokenInput: ATokenInput = {
  //   asset: tokenAddress,
  //   // @ts-ignore
  //   treasury: HederaConfig.ReserveFactorTreasuryAddress.hedera_testnet,
  //   // @ts-ignore
  //   incentivesController: '0x39b98c21d9B4821d775Ab5c1F0F7a9cBA279f9Bc',
  //   name: `Bonzo aToken ${tokenName}`,
  //   symbol: `am${tokenName}`,
  //   implementation: aTokenImpl.address,
  //   params: '0x',
  // };

  // console.log('Updating aToken Input -', aTokenInput);
  // const txn = await lendingPoolConfiguratorContract.updateAToken(aTokenInput);
  // await txn.wait();
  // console.log('aToken updated successfully');
}

async function main() {
  // "address": "0xe97f8ED6eeE331954ADA0F8056412262Aa7fa975", - Old testnet atoken impl
  await updateAToken('0xca367694cdac8f152e33683bb36cc9d6a73f1ef2', 'WETH');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
