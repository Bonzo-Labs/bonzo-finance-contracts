import { ethers, network } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
import { LendingPool } from '../deployed-contracts.json';
import HederaConfig from '../markets/hedera/index';
import { eHederaNetwork } from '../helpers/types';
import { USDC, HBARX, SAUCE, XSAUCE, KARATE, WHBAR, DOVU, HST } from './outputReserveData.json';
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

async function getTokenIDs() {
  const api_key = process.env.QUICKNODE_API_KEY;
  const quicknode_url = `https://serene-long-resonance.hedera-mainnet.quiknode.pro/${api_key}/`;

  let provider, wallet, contractAddress, ReserveAssets;
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    wallet = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    contractAddress = LendingPool.hedera_testnet.address;
    ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_testnet];
  } else if (chain_type === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    provider = new ethers.providers.JsonRpcProvider(url);
    wallet = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
    contractAddress = LendingPool.hedera_mainnet.address;
    ReserveAssets = HederaConfig.ReserveAssets[eHederaNetwork.hedera_mainnet];
  }

  console.log('Owner address: ', wallet.address);
  const contractArtifacts = await hre.artifacts.readArtifact('LendingPool');
  const abi = contractArtifacts.abi;

  const lendingPoolContract = new ethers.Contract(contractAddress, abi, wallet);

  console.log('Reserve Assets: ', ReserveAssets);

  let reserveDataOutput = {};

  for (const key in ReserveAssets) {
    console.log('Reserve Asset: ', ReserveAssets[key]);

    const reserveData = await lendingPoolContract.getReserveData(ReserveAssets[key]);
    console.log('Reserve Data: ', reserveData);

    const assetData = {
      USDC,
      HBARX,
      SAUCE,
      XSAUCE,
      KARATE,
      WHBAR,
      DOVU,
      HST,
    }[key];

    if (chain_type === 'hedera_testnet') {
      reserveDataOutput[key] = {
        hedera_testnet: {
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
        hedera_mainnet: {
          token: {
            address: assetData?.hedera_mainnet?.token?.address || '',
          },
          aToken: {
            address: assetData?.hedera_mainnet?.aToken?.address || '',
          },
          stableDebt: {
            address: assetData?.hedera_mainnet?.stableDebt?.address || '',
          },
          variableDebt: {
            address: assetData?.hedera_mainnet?.variableDebt?.address || '',
          },
        },
      };
    } else if (chain_type === 'hedera_mainnet') {
      reserveDataOutput[key] = {
        hedera_testnet: {
          token: {
            address: assetData?.hedera_testnet?.token?.address || '',
          },
          aToken: {
            address: assetData?.hedera_testnet?.aToken?.address || '',
          },
          stableDebt: {
            address: assetData?.hedera_testnet?.stableDebt?.address || '',
          },
          variableDebt: {
            address: assetData?.hedera_testnet?.variableDebt?.address || '',
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
