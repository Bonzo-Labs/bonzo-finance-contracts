import { ethers, network } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import {
  AccountId,
  PrivateKey,
  TokenAssociateTransaction,
  Client,
  AccountBalanceQuery,
  Mnemonic,
  ContractId,
} from '@hashgraph/sdk';
import { LendingPool } from '../deployed-contracts.json';
import HederaConfig from '../markets/hedera/index';
import { eHederaNetwork } from '../helpers/types';
const fs = require('fs');
const path = require('path');

async function getTokenIDs() {
  const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
  console.log('Owner address: ', wallet.address);
  const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
  const abi = contractArtifacts.abi;
  const contractAddress = LendingPool.hedera_testnet.address;
  const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);

  const ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_testnet];
  console.log('Reserve Assets: ', ReserveAssets);

  let reserveDataOutput = {};

  for (const key in ReserveAssets) {
    const reserveData = await lendingPoolContract.getReserveData(ReserveAssets[key]);
    console.log('Reserve Data: ', reserveData);

    const tokenContractId = await ContractId.fromEvmAddress(0, 0, ReserveAssets[key]).toString();
    const aTokenContractId = await ContractId.fromEvmAddress(
      0,
      0,
      reserveData.aTokenAddress
    ).toString();
    const stableDebtContractId = await ContractId.fromEvmAddress(
      0,
      0,
      reserveData.stableDebtTokenAddress
    ).toString();
    const variableDebtContractId = await ContractId.fromEvmAddress(
      0,
      0,
      reserveData.variableDebtTokenAddress
    ).toString();

    reserveDataOutput[key] = {
      token: {
        address: ReserveAssets[key],
        accountId: tokenContractId,
      },
      aToken: {
        address: reserveData.aTokenAddress,
        accountId: aTokenContractId,
      },
      stableDebt: {
        address: reserveData.stableDebtTokenAddress,
        accountId: stableDebtContractId,
      },
      variableDebt: {
        address: reserveData.variableDebtTokenAddress,
        accountId: variableDebtContractId,
      },
    };
  }

  const filePath = path.join(__dirname, 'outputReserveData.json');
  fs.writeFileSync(filePath, JSON.stringify(reserveDataOutput, null, 2), 'utf8');
  console.log('Reserve data has been written to outputReserveData.json');
}

async function main() {
  await getTokenIDs();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
