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
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);

  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}
async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

// AToken implementation deployed to: 0x88DeEAA4A4Ad9Fb937DE179Ee629840e14A1690E

async function updateAToken(tokenAddress: string, tokenName: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address
  );

  console.log('Owner:', owner.address);

  // //   Implement new aToken contract
  // const aTokenFactory = await ethers.getContractFactory('AToken');
  // const aTokenImpl = await aTokenFactory.deploy();
  // await aTokenImpl.deployed();
  // console.log('AToken implementation deployed to:', aTokenImpl.address);
  const aTokenImpl = AToken.hedera_mainnet;

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
    // @ts-ignore
    treasury: HederaConfig.ReserveFactorTreasuryAddress.hedera_mainnet,
    // @ts-ignore
    incentivesController: HederaConfig.IncentivesController.hedera_mainnet,
    name: `Bonzo aToken ${tokenName}`,
    symbol: `am${tokenName}`,
    implementation: aTokenImpl.address,
    params: '0x',
  };

  console.log('Updating aToken Input -', aTokenInput);
  const txn = await lendingPoolConfiguratorContract.updateAToken(aTokenInput);
  await txn.wait();
  console.log('aToken updated successfully');
}

async function main() {
  await updateAToken('0x00000000000000000000000000000000001647e8', 'XSAUCE');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
