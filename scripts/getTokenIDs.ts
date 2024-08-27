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
  const api_key = process.env.QUICKNODE_API_KEY;
  const quicknode_url = `https://serene-long-resonance.hedera-mainnet.quiknode.pro/${api_key}/`;

  const provider = new hre.ethers.providers.JsonRpcProvider(quicknode_url);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  console.log('Owner address: ', wallet.address);
  const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
  const abi = contractArtifacts.abi;
  const contractAddress = LendingPool.hedera_mainnet.address;
  const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);

  const ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_mainnet];
  console.log('Reserve Assets: ', ReserveAssets);

  let reserveDataOutput = {};

  for (const key in ReserveAssets) {
    const reserveData = await lendingPoolContract.getReserveData(ReserveAssets[key]);
    console.log('Reserve Data: ', reserveData);

    reserveDataOutput[key] = {
      hedera_testnet: {
        token: {
          address: '',
        },
        aToken: {
          address: '',
        },
        stableDebt: {
          address: '',
        },
        variableDebt: {
          address: '',
        },
      },
      hedera_mainnet: {
        token: {
          address: ReserveAssets[key],
        },
        aToken: {
          address: reserveData.aTokenAddress,
        },
        stableDebt: {
          address: reserveData.stableDebtTokenAddress,
        },
        variableDebt: {
          address: reserveData.variableDebtTokenAddress,
        },
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
