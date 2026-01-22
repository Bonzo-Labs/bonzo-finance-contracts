import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { ContractCreateFlow, ContractFunctionParameters, Hbar } from '@hashgraph/sdk';
const { Client, PrivateKey, AccountId } = require('@hashgraph/sdk');

import { LendingPoolAddressesProvider } from '../outputReserveData.json';
import { LendingPool, LendingPoolConfigurator } from '../outputReserveData.json';
import {
  WHBAR,
  HBARX,
  SAUCE,
  XSAUCE,
  USDC,
  DOVU,
  HST,
  KARATE,
  PACK,
  STEAM,
  WETH,
} from '../outputReserveData.json';
import {
  rateStrategyDOVU,
  rateStrategyHBAR,
  rateStrategyHBARX,
  rateStrategyHST,
  rateStrategyKARATE,
  rateStrategyPACK,
  rateStrategySAUCE,
  rateStrategyXSAUCE,
  rateStrategySTEAM,
  rateStrategyUSDC,
  rateStrategyUSDCNew,
  rateStrategyWETH,
} from '../../markets/hedera/rateStrategies';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
console.log('Chain is = ', chain_type);
let reserves, assetConfigurations;
let lendingPoolContract, lendingPoolConfiguratorContract;
let lendingPoolAddress, lendingPoolConfiguratorAddress;
let provider, owner;

if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  // reserves = [
  //   BKARATE.hedera_testnet.token.address,
  //   BDOVU.hedera_testnet.token.address,
  //   BPACK.hedera_testnet.token.address,
  // ];

  // assetConfigurations = {
  //   '0x00000000000000000000000000000000004d50f2': {
  //     strategy: strategyKARATE,
  //   },
  //   '0x00000000000000000000000000000000004e892f': {
  //     strategy: strategyDOVU,
  //   },
  //   '0x00000000000000000000000000000000004e8931': {
  //     strategy: strategyPACK,
  //   },
  // };

  lendingPoolAddress = LendingPool.hedera_testnet.address;
  lendingPoolConfiguratorAddress = LendingPoolConfigurator.hedera_testnet.address;
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

  assetConfigurations = {
    '0x0000000000000000000000000000000000163b5a': {
      strategy: rateStrategyHBAR,
    },
    '0x00000000000000000000000000000000000cba44': {
      strategy: rateStrategyHBARX,
    },
    '0x000000000000000000000000000000000006f89a': {
      strategy: rateStrategyUSDCNew,
    },
    '0x00000000000000000000000000000000000b2ad5': {
      strategy: rateStrategySAUCE,
    },
    '0x00000000000000000000000000000000001647e8': {
      strategy: rateStrategyXSAUCE,
    },
    '0x000000000000000000000000000000000022d6de': {
      strategy: rateStrategyKARATE,
    },
    '0x000000000000000000000000000000000038b3db': {
      strategy: rateStrategyDOVU,
    },
    '0x0000000000000000000000000000000000492a28': {
      strategy: rateStrategyPACK,
    },
    '0x00000000000000000000000000000000000ec585': {
      strategy: rateStrategyHST,
    },
    '0x000000000000000000000000000000000030fb8b': {
      strategy: rateStrategySTEAM,
    },
    '0xca367694cdac8f152e33683bb36cc9d6a73f1ef2': {
      strategy: rateStrategyWETH,
    },
  };

  lendingPoolAddress = LendingPool.hedera_mainnet.address;
  lendingPoolConfiguratorAddress = LendingPoolConfigurator.hedera_mainnet.address;

  reserves = [
    // WHBAR.hedera_mainnet.token.address,
    // HBARX.hedera_mainnet.token.address,
    // USDC.hedera_mainnet.token.address,
    // SAUCE.hedera_mainnet.token.address,
    // XSAUCE.hedera_mainnet.token.address,
    // KARATE.hedera_mainnet.token.address,
    // DOVU.hedera_mainnet.token.address,
    // PACK.hedera_mainnet.token.address,
    // HST.hedera_mainnet.token.address,
    // STEAM.hedera_mainnet.token.address,
    WETH.hedera_mainnet.token.address,
  ];
}

export async function deployNewStrategySDK(reserve: string, strategy: any) {
  //     ILendingPoolAddressesProvider provider,
  //     uint256 optimalUtilizationRate,
  //     uint256 baseVariableBorrowRate,
  //     uint256 variableRateSlope1,
  //     uint256 variableRateSlope2,
  //     uint256 stableRateSlope1,
  //     uint256 stableRateSlope2
  const deploymentArgs = {
    provider: LendingPoolAddressesProvider.hedera_mainnet.address,
    optimalUtilizationRate: strategy.optimalUtilizationRate,
    baseVariableBorrowRate: strategy.baseVariableBorrowRate,
    variableRateSlope1: strategy.variableRateSlope1,
    variableRateSlope2: strategy.variableRateSlope2,
    stableRateSlope1: strategy.stableRateSlope1,
    stableRateSlope2: strategy.stableRateSlope2,
  };

  console.log('Hedera JS SDK deployment args: ', deploymentArgs);

  // 1. Read the Hardhat artifact for DefaultReserveInterestRateStrategy
  const artifact = await hre.artifacts.readArtifact('DefaultReserveInterestRateStrategy');
  const bytecode = artifact.bytecode;

  // 2. Build constructor parameters for Hedera
  //    - The order must match the contract's constructor in solidity
  const functionParameters = new ContractFunctionParameters()
    .addAddress(deploymentArgs.provider)
    .addUint256(deploymentArgs.optimalUtilizationRate)
    .addUint256(deploymentArgs.baseVariableBorrowRate)
    .addUint256(deploymentArgs.variableRateSlope1)
    .addUint256(deploymentArgs.variableRateSlope2)
    .addUint256(deploymentArgs.stableRateSlope1)
    .addUint256(deploymentArgs.stableRateSlope2);

  const client = Client.forMainnet();
  const operatorPrKey = PrivateKey.fromStringECDSA(process.env.PRIVATE_KEY_MAINNET_ADMIN!);
  const operatorAccountId = AccountId.fromString(process.env.MAINNET_ADMIN_ACCOUNT_ID!);

  client.setOperator(operatorAccountId, operatorPrKey);

  const evmAddress = operatorAccountId.toSolidityAddress(); // 40-hex-character address without the '0x'
  console.log(`EVM address of the deployer: 0x${evmAddress}`);

  // 4. Create the contract on Hedera
  console.log(`\nDeploying DefaultReserveInterestRateStrategy to Hedera for reserve: ${reserve}`);
  const contractCreateTx = new ContractCreateFlow()
    .setGas(2_000_000) // Adjust gas as needed
    .setBytecode(bytecode)
    .setConstructorParameters(functionParameters);

  // 5. Execute the transaction and get the receipt
  const contractCreateResponse = await contractCreateTx.execute(client);
  const contractCreateReceipt = await contractCreateResponse.getReceipt(client);

  // 6. Grab the new Contract ID
  const newContractId = contractCreateReceipt.contractId;
  if (!newContractId) {
    throw new Error('Failed to retrieve new contract ID from receipt');
  }

  // 7. Log the new contract info
  console.log(
    `Successfully deployed DefaultReserveInterestRateStrategy for reserve ${reserve}.
    Contract ID = ${newContractId.toString()}`
  );
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function deployNewStrategy(reserve: any, strategy: any) {
  //     ILendingPoolAddressesProvider provider,
  //     uint256 optimalUtilizationRate,
  //     uint256 baseVariableBorrowRate,
  //     uint256 variableRateSlope1,
  //     uint256 variableRateSlope2,
  //     uint256 stableRateSlope1,
  //     uint256 stableRateSlope2
  const deploymentArgs = {
    provider: LendingPoolAddressesProvider.hedera_mainnet.address,
    optimalUtilizationRate: strategy.optimalUtilizationRate,
    baseVariableBorrowRate: strategy.baseVariableBorrowRate,
    variableRateSlope1: strategy.variableRateSlope1,
    variableRateSlope2: strategy.variableRateSlope2,
    stableRateSlope1: strategy.stableRateSlope1,
    stableRateSlope2: strategy.stableRateSlope2,
  };
  console.log('Deployment args = ', deploymentArgs);

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
  console.log(`Deployed strategy for reserve = ${reserve}`);
  console.log('Rate Strategy deployed to:', rateStrategy.address);
}

async function main() {
  console.log('Owner:', owner.address);
  for (const reserve of reserves) {
    const strategy = assetConfigurations[reserve].strategy;
    // await deployNewStrategy(reserve, strategy);
    await deployNewStrategySDK(reserve, strategy);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
