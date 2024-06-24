import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AToken,
  StableDebtToken,
} from '../outputReserveData.json';
import HederaConfig from '../../markets/hedera/index';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

type debtTokenInput = {
  asset: string;
  incentivesController: string;
  name: string;
  symbol: string;
  implementation: string;
  params: string;
};

async function updateStableDebtToken(tokenAddress: string) {
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );

  console.log('Owner:', owner.address);

  // Implement new stableDebtToken contract
  const stableDebtTokenFactory = await ethers.getContractFactory('StableDebtToken');
  const stableDebtTokenImpl = await stableDebtTokenFactory.deploy();
  await stableDebtTokenImpl.deployed();
  console.log('AToken implementation deployed to:', stableDebtTokenImpl.address);

  const aTokenImplAddress = '0xCfBc025d9ffCb049C091d823eaFB10c8638DDF77';

  const stableDebtTokenInput: debtTokenInput = {
    asset: tokenAddress,
    incentivesController: '0x0000000000000000000000000000000000000000',
    name: 'Bonzo Stable Debt Token HBARX',
    symbol: 'stableDebtBonzoHBARX',
    implementation: stableDebtTokenImpl.address,
    params: '0x',
  };

  console.log('Updating aToken Input -', stableDebtTokenInput);
  const txn = await lendingPoolConfiguratorContract.updateStableDebtToken(stableDebtTokenInput);
  await txn.wait();
  console.log('stable debt token updated successfully');
}

async function main() {
  await updateStableDebtToken('0x0000000000000000000000000000000000120f46');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
