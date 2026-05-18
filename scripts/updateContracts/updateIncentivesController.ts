import { ethers } from 'hardhat';
const hre = require('hardhat');

import {
  LendingPoolConfigurator,
  USDC,
  HBARX,
  SAUCE,
  XSAUCE,
  KARATE,
  WHBAR,
  DOVU,
  HST,
  PACK,
  STEAM,
} from '../outputReserveData.json';
import { resolveHederaNetwork } from '../lib/resolveHederaNetwork';

require('dotenv').config();

const EMISSION_MANAGER_PROXY = '0x539710E97e2264a13159d475FFE74C23602810ac';
const REWARDS_CONTROLLER_PROXY = '0xe27C3ef37A8061F34ac0C8E12D1b334744fE85EC';
const TRANSFER_STRATEGY = '0xFBfb510BF91e49379A42A325B2c2CF9f86bDc66C';
const REWARD_ORACLE = ethers.constants.AddressZero;
const REWARD_EMISSION_PER_SECOND = '0';
const REWARD_DISTRIBUTION_END = 0;

const reserves = [
  { symbol: 'USDC', data: USDC },
  { symbol: 'HBARX', data: HBARX },
  { symbol: 'SAUCE', data: SAUCE },
  { symbol: 'XSAUCE', data: XSAUCE },
  { symbol: 'KARATE', data: KARATE },
  { symbol: 'WHBAR', data: WHBAR },
  { symbol: 'DOVU', data: DOVU },
  { symbol: 'HST', data: HST },
  { symbol: 'PACK', data: PACK },
  { symbol: 'STEAM', data: STEAM },
];

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function getIncentivesController() view returns (address)',
  'function RESERVE_TREASURY_ADDRESS() view returns (address)',
];

/** Matches configure-assets.ts: a/debt tokens expose scaled supply for rewards indexing. */
const IScaledBalanceTokenABI = [
  'function scaledTotalSupply() external view returns (uint256)',
];

/** Decimals of the reward token (USDC on mainnet in this script). */
const REWARD_DECIMALS = 6;

const EMISSION_MANAGER_ABI = [
  'function getRewardsController() view returns (address)',
  'function getEmissionAdmin(address reward) view returns (address)',
  'function configureAssets((uint88 emissionPerSecond,uint256 totalSupply,uint32 distributionEnd,address asset,address reward,address transferStrategy,address rewardOracle)[] config)',
];

const REWARDS_CONTROLLER_ABI = ['function isCallerAsset(address asset) view returns (bool)'];

type ReserveConfig = {
  token: { address: string };
  aToken: { address: string };
  variableDebt: { address: string };
};

function assertAddress(label: string, address: string): string {
  if (!address || !ethers.utils.isAddress(address)) {
    throw new Error(`${label} is not a valid address: ${address}`);
  }

  return ethers.utils.getAddress(address);
}

function getMainnetReserve(symbol: string, data: any): ReserveConfig {
  const reserve = data.hedera_mainnet;
  if (!reserve) {
    throw new Error(`Missing hedera_mainnet reserve data for ${symbol}`);
  }

  return {
    token: { address: assertAddress(`${symbol}.token`, reserve.token?.address) },
    aToken: { address: assertAddress(`${symbol}.aToken`, reserve.aToken?.address) },
    variableDebt: {
      address: assertAddress(`${symbol}.variableDebt`, reserve.variableDebt?.address),
    },
  };
}

async function setupContract(artifactName: string, contractAddress: string, owner: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function deployImplementation(artifactName: string, owner: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
  const implementation = await factory.deploy();
  await implementation.deployed();
  console.log(`${artifactName} implementation deployed to:`, implementation.address);
  return implementation.address;
}

async function main() {
  const chain_type = resolveHederaNetwork(hre);
  if (chain_type !== 'hedera_mainnet') {
    throw new Error(
      `Unsupported CHAIN_TYPE "${chain_type}". This script only runs on hedera_mainnet.`
    );
  }

  const url = process.env.PROVIDER_URL_MAINNET || '';
  if (!url) {
    throw new Error('PROVIDER_URL_MAINNET environment variable is required');
  }

  const privateKey = process.env.PRIVATE_KEY_MAINNET;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY_MAINNET is required');
  }
  // EmissionManager / RewardsController are transparent proxies whose admin is
  // PRIVATE_KEY_MAINNET. Calls from the admin hit the proxy fallback guard
  // ("Cannot call fallback function from the proxy admin"), so we must use a
  // separate non-admin signer for those contracts.
  const proxyCallerKey = process.env.PRIVATE_KEY_MAINNET_PROXY;
  if (!proxyCallerKey) {
    throw new Error('PRIVATE_KEY_MAINNET_PROXY is required (non-admin caller)');
  }

  const provider = new ethers.providers.JsonRpcProvider(url);
  const owner = new ethers.Wallet(privateKey, provider);
  const proxyCaller = new ethers.Wallet(proxyCallerKey, provider);

  const lendingPoolConfiguratorAddress = assertAddress(
    'LendingPoolConfigurator.hedera_mainnet',
    LendingPoolConfigurator.hedera_mainnet.address
  );
  const rewardToken = assertAddress('USDC.hedera_mainnet.token', USDC.hedera_mainnet.token.address);

  console.log('Chain Type:', chain_type);
  console.log('Owner (proxy admin / pool admin):', owner.address);
  console.log('Proxy caller (non-admin):', proxyCaller.address);
  console.log('LendingPoolConfigurator:', lendingPoolConfiguratorAddress);
  console.log('EmissionManager proxy:', EMISSION_MANAGER_PROXY);
  console.log('RewardsController proxy:', REWARDS_CONTROLLER_PROXY);
  console.log('TransferStrategy:', TRANSFER_STRATEGY);
  console.log('Reward token:', rewardToken);

  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    lendingPoolConfiguratorAddress,
    owner
  );
  // IMPORTANT: connect proxy contracts with the non-admin signer.
  const emissionManager = new ethers.Contract(
    EMISSION_MANAGER_PROXY,
    EMISSION_MANAGER_ABI,
    proxyCaller
  );
  const rewardsController = new ethers.Contract(
    REWARDS_CONTROLLER_PROXY,
    REWARDS_CONTROLLER_ABI,
    proxyCaller
  );

  const configuredRewardsController = await emissionManager.getRewardsController();
  if (configuredRewardsController.toLowerCase() !== REWARDS_CONTROLLER_PROXY.toLowerCase()) {
    throw new Error(
      `EmissionManager rewards controller mismatch: expected ${REWARDS_CONTROLLER_PROXY}, got ${configuredRewardsController}`
    );
  }

  const emissionAdmin = await emissionManager.getEmissionAdmin(rewardToken);
  if (emissionAdmin.toLowerCase() !== proxyCaller.address.toLowerCase()) {
    throw new Error(
      `proxyCaller is not the emission admin for ${rewardToken}. Current admin: ${emissionAdmin}. Set the emission admin to ${proxyCaller.address} first.`
    );
  }

  const aTokenImplementation = await deployImplementation('AToken', owner);
  const variableDebtTokenImplementation = await deployImplementation('VariableDebtToken', owner);

  const rewardConfigs: any[] = [];

  for (const reserveInfo of reserves) {
    const reserve = getMainnetReserve(reserveInfo.symbol, reserveInfo.data);
    const underlyingAsset = reserve.token.address;
    const aTokenAddress = reserve.aToken.address;
    const variableDebtTokenAddress = reserve.variableDebt.address;
    const aToken = new ethers.Contract(aTokenAddress, TOKEN_ABI, owner);
    const variableDebtToken = new ethers.Contract(variableDebtTokenAddress, TOKEN_ABI, owner);

    const aTokenName = await aToken.name();
    const aTokenSymbol = await aToken.symbol();
    const aTokenTreasury = await aToken.RESERVE_TREASURY_ADDRESS();
    const variableDebtName = await variableDebtToken.name();
    const variableDebtSymbol = await variableDebtToken.symbol();
    const currentATokenIncentivesController = await aToken.getIncentivesController();
    const currentVariableDebtIncentivesController =
      await variableDebtToken.getIncentivesController();

    console.log('\nReserve:', reserveInfo.symbol);
    console.log('Underlying asset:', underlyingAsset);
    console.log('aToken address:', aTokenAddress);
    console.log('Variable debt token address:', variableDebtTokenAddress);
    console.log('Current aToken incentives controller:', currentATokenIncentivesController);
    console.log(
      'Current variable debt incentives controller:',
      currentVariableDebtIncentivesController
    );

    const updateATokenInput = {
      asset: underlyingAsset,
      treasury: aTokenTreasury,
      incentivesController: REWARDS_CONTROLLER_PROXY,
      name: aTokenName,
      symbol: aTokenSymbol,
      implementation: aTokenImplementation,
      params: '0x',
    };

    console.log('Updating aToken Input -', updateATokenInput);
    const updateATokenTx = await lendingPoolConfiguratorContract.updateAToken(updateATokenInput);
    await updateATokenTx.wait();

    const updateVariableDebtTokenInput = {
      asset: underlyingAsset,
      incentivesController: REWARDS_CONTROLLER_PROXY,
      name: variableDebtName,
      symbol: variableDebtSymbol,
      implementation: variableDebtTokenImplementation,
      params: '0x',
    };

    console.log('Updating variable debt token Input -', updateVariableDebtTokenInput);
    const updateVariableDebtTokenTx = await lendingPoolConfiguratorContract.updateVariableDebtToken(
      updateVariableDebtTokenInput
    );
    await updateVariableDebtTokenTx.wait();

    const updatedATokenIncentivesController = await aToken.getIncentivesController();
    const updatedVariableDebtIncentivesController =
      await variableDebtToken.getIncentivesController();
    console.log('Updated aToken incentives controller:', updatedATokenIncentivesController);
    console.log(
      'Updated variable debt incentives controller:',
      updatedVariableDebtIncentivesController
    );

    if (
      updatedATokenIncentivesController.toLowerCase() !== REWARDS_CONTROLLER_PROXY.toLowerCase()
    ) {
      throw new Error(`aToken incentives controller was not updated for ${reserveInfo.symbol}`);
    }
    if (
      updatedVariableDebtIncentivesController.toLowerCase() !==
      REWARDS_CONTROLLER_PROXY.toLowerCase()
    ) {
      throw new Error(
        `Variable debt incentives controller was not updated for ${reserveInfo.symbol}`
      );
    }

    const scaledBalance = (address: string) =>
      new ethers.Contract(address, IScaledBalanceTokenABI, owner);
    const aScaledTotalSupply = await scaledBalance(aTokenAddress).scaledTotalSupply();
    const variableDebtScaledTotalSupply = await scaledBalance(
      variableDebtTokenAddress
    ).scaledTotalSupply();

    rewardConfigs.push(
      {
        emissionPerSecond: REWARD_EMISSION_PER_SECOND,
        totalSupply: ethers.utils.parseUnits(aScaledTotalSupply.toString(), REWARD_DECIMALS),
        distributionEnd: REWARD_DISTRIBUTION_END,
        asset: aTokenAddress,
        reward: rewardToken,
        transferStrategy: TRANSFER_STRATEGY,
        rewardOracle: REWARD_ORACLE,
      },
      {
        emissionPerSecond: REWARD_EMISSION_PER_SECOND,
        totalSupply: ethers.utils.parseUnits(
          variableDebtScaledTotalSupply.toString(),
          REWARD_DECIMALS
        ),
        distributionEnd: REWARD_DISTRIBUTION_END,
        asset: variableDebtTokenAddress,
        reward: rewardToken,
        transferStrategy: TRANSFER_STRATEGY,
        rewardOracle: REWARD_ORACLE,
      }
    );
  }

  console.log('\nConfiguring rewards assets:', rewardConfigs.length);
  const configureAssetsTx = await emissionManager.configureAssets(rewardConfigs);
  await configureAssetsTx.wait();
  console.log('Rewards assets configured');

  for (const config of rewardConfigs) {
    const isCallerAsset = await rewardsController.isCallerAsset(config.asset);
    console.log('RewardsController.isCallerAsset:', config.asset, isCallerAsset);
    if (!isCallerAsset) {
      throw new Error(`RewardsController did not register caller asset ${config.asset}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
