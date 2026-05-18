import { ethers } from 'hardhat';
const hre = require('hardhat');

import { LendingPoolConfigurator } from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';
import { eHederaNetwork } from '../../helpers/types';
import { resolveHederaNetwork } from '../lib/resolveHederaNetwork';

require('dotenv').config();

const chain_type = resolveHederaNetwork(hre);

let provider, owner;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
} else {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
}

const hederaNet =
  chain_type === 'hedera_mainnet' ? eHederaNetwork.hedera_mainnet : eHederaNetwork.hedera_testnet;

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function updateStableDebtToken(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator[chain_type].address
  );

  console.log('Owner:', owner.address);

  //   Implement new stable debt token contract
  const stableTokenFactory = await ethers.getContractFactory('StableDebtToken');
  const stableTokenImpl = await stableTokenFactory.deploy();
  await stableTokenImpl.deployed();
  console.log('Stable debt implementation deployed to:', stableTokenImpl.address);

  type DebtTokenInput = {
    asset: string;
    incentivesController: string;
    name: string;
    symbol: string;
    implementation: string;
    params: string;
  };

  const debtTokenInput: DebtTokenInput = {
    asset: tokenAddress,
    // @ts-ignore
    incentivesController: HederaConfig.IncentivesController[hederaNet],
    name: 'Bonzo stable debt Token WHBAR',
    symbol: 'stableDebtWHBAR',
    implementation: stableTokenImpl.address,
    params: '0x',
  };

  console.log('Updating stable Token Input -', debtTokenInput);
  const txn = await lendingPoolConfiguratorContract.updateStableDebtToken(debtTokenInput);
  await txn.wait();
  console.log('stable debet Token updated successfully');
}

async function main() {
  await updateStableDebtToken('0x0000000000000000000000000000000000003ad2');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
