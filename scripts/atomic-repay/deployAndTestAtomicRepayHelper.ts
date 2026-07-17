/**
 * Read-only mainnet preflight by default. A confirmed run deploys and validates
 * the Atomic repay helper but never changes protocol roles or pause state.
 *
 * PRIVATE_KEY_MAINNET_PROXY signs and pays only for the deployment. The helper
 * CONTROLLER remains the real AddressesProvider owner read from chain, so the
 * proxy deployer does not need to hold a protocol role.
 */
import fs from 'fs';
import { providers } from 'ethers';
const dotenv = require('dotenv');

// dotenv 8 does not support override=true. Copy only this script's configured
// values into process.env so the checked deployment configuration is
// authoritative even when the parent shell contains an empty or stale value.
const configuredEnvironment = dotenv.config().parsed || {};
for (const key of [
  'PROVIDER_URL_MAINNET',
  'PRIVATE_KEY_MAINNET_PROXY',
  'CONFIRM_DEPLOY_ATOMIC_REPAY',
]) {
  if (typeof configuredEnvironment[key] === 'string') {
    process.env[key] = configuredEnvironment[key];
  }
}

const hre = require('hardhat');
const { ethers } = hre;
import {
  ADDITIONAL_AUTHORIZED_CALLERS,
  ASSET_BY_SYMBOL,
  BORROWER,
  HTS_SETTLEMENT_SYMBOLS,
  MAINNET_CHAIN_ID,
  PROTOCOL_ADDRESSES,
  SETTLEMENT_SYMBOLS,
  STATE_PATH,
  VARIABLE_DEBT_BY_SYMBOL,
  WHBAR_HELPER,
} from './atomicRepayConfig';
import {
  assertReviewedDeploymentPayload,
  verifyAtomicRepayHelperRuntime,
} from './atomicRepayVerification';
import {
  conciseRpcError,
  contractAs,
  eqAddress,
  withRetry,
  writeJson,
} from '../lower-borrow-rates/scriptUtils';

const CHAIN = 'hedera_mainnet';
const rpcUrl = process.env.PROVIDER_URL_MAINNET || '';
const deployerKey = process.env.PRIVATE_KEY_MAINNET_PROXY || '';
const deployConfirmation = (process.env.CONFIRM_DEPLOY_ATOMIC_REPAY || '').trim();
if (!rpcUrl || !deployerKey) {
  throw new Error(
    'Missing mainnet provider or proxy deployer signer. Set PROVIDER_URL_MAINNET and PRIVATE_KEY_MAINNET_PROXY.'
  );
}

const provider = withRetry(new ethers.providers.JsonRpcProvider(rpcUrl));
const deployer = new ethers.Wallet(deployerKey, provider);
const PUBLIC_HASHIO_MAINNET_RPC = 'https://mainnet.hashio.io/api';

async function estimateDeploymentGas(
  estimationProvider: providers.JsonRpcProvider,
  unsignedDeployment: providers.TransactionRequest,
  deployerAddress: string
) {
  try {
    const network = await estimationProvider.getNetwork();
    if (network.chainId !== MAINNET_CHAIN_ID) {
      throw new Error(
        `Public Hashio returned chain ID ${network.chainId}, expected ${MAINNET_CHAIN_ID}.`
      );
    }
    return await estimationProvider.estimateGas({
      from: deployerAddress,
      data: unsignedDeployment.data,
      value: 0,
    });
  } catch (error) {
    console.warn(`Public Hashio deployment estimate failed: ${conciseRpcError(error)}`);
    return undefined;
  }
}

function fixedAuthorizedCallers(controller: string) {
  const configured = [BORROWER, controller, ...ADDITIONAL_AUTHORIZED_CALLERS];
  for (const caller of configured) {
    if (!ethers.utils.isAddress(caller) || eqAddress(caller, ethers.constants.AddressZero)) {
      throw new Error(`Invalid authorised caller: ${caller}`);
    }
  }
  return configured.filter(
    (caller, index) => configured.findIndex((candidate) => eqAddress(candidate, caller)) === index
  );
}

async function preflight() {
  const ap = await contractAs(
    hre,
    'LendingPoolAddressesProvider',
    PROTOCOL_ADDRESSES.provider,
    provider
  );
  const pool = await contractAs(hre, 'LendingPool', PROTOCOL_ADDRESSES.pool, provider);
  const dp = await contractAs(
    hre,
    'AaveProtocolDataProvider',
    PROTOCOL_ADDRESSES.dataProvider,
    provider
  );
  const [network, owner, emergencyAdmin, poolAdmin, livePool, liveConfigurator, paused] =
    await Promise.all([
      provider.getNetwork(),
      ap.owner(),
      ap.getEmergencyAdmin(),
      ap.getPoolAdmin(),
      ap.getLendingPool(),
      ap.getLendingPoolConfigurator(),
      pool.paused(),
    ]);

  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(
      `Expected Hedera mainnet chain ID ${MAINNET_CHAIN_ID}, got ${network.chainId}.`
    );
  }
  if (!eqAddress(livePool, PROTOCOL_ADDRESSES.pool)) throw new Error('Live pool changed.');
  if (!eqAddress(liveConfigurator, PROTOCOL_ADDRESSES.configurator)) {
    throw new Error('Live configurator changed.');
  }
  if (!eqAddress(owner, emergencyAdmin)) {
    throw new Error(`Emergency admin ${emergencyAdmin} is not the provider owner ${owner}.`);
  }
  if (!eqAddress(owner, poolAdmin)) {
    throw new Error(`Pool admin ${poolAdmin} is not the provider owner ${owner}.`);
  }
  if (!paused) throw new Error('LendingPool is not paused.');

  const whbarHelper = new ethers.Contract(
    WHBAR_HELPER,
    ['function whbarToken() view returns (address)'],
    provider
  );
  const liveWhbarToken = await whbarHelper.whbarToken();
  if (!eqAddress(liveWhbarToken, ASSET_BY_SYMBOL.WHBAR)) {
    throw new Error(`WHBAR helper token changed: ${liveWhbarToken}.`);
  }

  const settlements: Array<{
    symbol: string;
    asset: string;
    decimals: number;
    variableDebtToken: string;
    currentDebt: any;
  }> = [];

  for (const symbol of SETTLEMENT_SYMBOLS) {
    const asset = ASSET_BY_SYMBOL[symbol];
    const [reserve, cfg] = await Promise.all([
      pool.getReserveData(asset),
      dp.getReserveConfigurationData(asset),
    ]);
    if (!cfg.isActive || !cfg.isFrozen || cfg.stableBorrowRateEnabled) {
      throw new Error(`${symbol}: reserve must be active, frozen, and stable borrowing disabled.`);
    }
    if (!eqAddress(reserve.variableDebtTokenAddress, VARIABLE_DEBT_BY_SYMBOL[symbol])) {
      throw new Error(`${symbol}: variable debt token changed.`);
    }
    const token = new ethers.Contract(
      asset,
      ['function decimals() view returns (uint8)'],
      provider
    );
    const debtToken = new ethers.Contract(
      reserve.variableDebtTokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    const [decimals, currentDebt] = await Promise.all([
      token.decimals().then((value: any) => Number(value)),
      debtToken.balanceOf(BORROWER),
    ]);
    settlements.push({
      symbol,
      asset,
      decimals,
      variableDebtToken: reserve.variableDebtTokenAddress,
      currentDebt,
    });
  }

  console.log(
    'Preflight passed: chain, owner/admin roles, pool pause, reserve configuration, and debt tokens.'
  );
  return {
    ap,
    pool,
    controllerAddress: owner,
    emergencyAdmin,
    poolAdmin,
    settlements,
  };
}

async function main() {
  console.log('Chain:', CHAIN);
  console.log('Deployer (pays for deploy tx):', deployer.address);
  const roles = await preflight();
  console.log('Controller/admin (helper CONTROLLER, read from chain):', roles.controllerAddress);

  const authorizedCallers = fixedAuthorizedCallers(roles.controllerAddress);
  console.log('Borrower:', BORROWER);
  console.log('Authorised callers:', authorizedCallers.join(', '));
  console.log(
    'Wallet paths: native ContractExecuteTransaction, or payer allowance plus controller repayTokenFrom.'
  );
  for (const item of roles.settlements) {
    console.log(
      `${item.symbol}: debt=${ethers.utils.formatUnits(item.currentDebt, item.decimals)}`
    );
  }

  if (deployConfirmation !== 'DEPLOY') {
    console.log(
      `Dry run only. Loaded CONFIRM_DEPLOY_ATOMIC_REPAY=${JSON.stringify(
        deployConfirmation || '<unset>'
      )}; expected "DEPLOY".`
    );
    return;
  }
  if (fs.existsSync(STATE_PATH)) {
    throw new Error(
      `State file already exists at ${STATE_PATH}. Review and archive it before another deployment.`
    );
  }

  const factory = await ethers.getContractFactory('AtomicRepayHelper', deployer);
  const assets = roles.settlements.map((item) => item.asset);
  const htsAssets = HTS_SETTLEMENT_SYMBOLS.map((symbol) => ASSET_BY_SYMBOL[symbol]);
  const constructorArguments: [string, string, string, string[]] = [
    PROTOCOL_ADDRESSES.provider,
    roles.controllerAddress,
    BORROWER,
    authorizedCallers,
  ];
  const unsigned = factory.getDeployTransaction(...constructorArguments);
  if (!unsigned.data) throw new Error('Helper deployment has no creation payload.');
  assertReviewedDeploymentPayload(unsigned.data, factory.bytecode, constructorArguments);

  // The configured relay may read and broadcast successfully while rejecting
  // contract-creation estimates. Public Hashio is used only for this read-only
  // estimate, matching the atomic rate-poke deployment path.
  const publicHashioProvider = withRetry(
    new ethers.providers.JsonRpcProvider(PUBLIC_HASHIO_MAINNET_RPC),
    2
  );
  const estimate = await estimateDeploymentGas(publicHashioProvider, unsigned, deployer.address);
  if (!estimate) throw new Error('Cannot estimate helper deployment gas through public Hashio.');
  const gasLimit = estimate.mul(110).div(100);
  console.log(
    `Deployment gas estimate=${estimate.toString()} source=public Hashio RPC ` +
      `limit=${gasLimit.toString()}.`
  );

  const helper = await factory.deploy(...constructorArguments, { gasLimit });
  console.log('Deployment transaction:', helper.deployTransaction.hash);
  writeJson(STATE_PATH, {
    network: CHAIN,
    chainId: MAINNET_CHAIN_ID,
    helper: helper.address,
    deploymentTxHash: helper.deployTransaction.hash,
    validated: false,
  });
  const receipt = await helper.deployTransaction.wait();
  if (receipt.status !== 1) throw new Error('Atomic repay helper deployment failed.');
  console.log(
    `Deployment receipt confirmed: block=${receipt.blockNumber} gasUsed=${
      receipt.gasUsed?.toString?.() || 'unknown'
    } status=${receipt.status}.`
  );

  const code = await provider.getCode(helper.address);
  if (code === '0x') throw new Error('Atomic repay helper has no runtime bytecode.');
  const verified = await verifyAtomicRepayHelperRuntime(hre, code);

  const [
    providerAddress,
    poolAddress,
    configuratorAddress,
    controller,
    borrower,
    whbarHelper,
    callerCount,
    assetCount,
    htsAssetCount,
    repaymentsPaused,
    closed,
    liveAdmin,
  ] = await Promise.all([
    helper.ADDRESSES_PROVIDER(),
    helper.LENDING_POOL(),
    helper.CONFIGURATOR(),
    helper.CONTROLLER(),
    helper.BORROWER(),
    helper.WHBAR_HELPER(),
    helper.callerCount(),
    helper.assetCount(),
    helper.htsAssetCount(),
    helper.repaymentsPaused(),
    helper.closed(),
    roles.ap.getEmergencyAdmin(),
  ]);
  const immutableChecks = [
    [providerAddress, PROTOCOL_ADDRESSES.provider],
    [poolAddress, PROTOCOL_ADDRESSES.pool],
    [configuratorAddress, PROTOCOL_ADDRESSES.configurator],
    [controller, roles.controllerAddress],
    [borrower, BORROWER],
    [whbarHelper, WHBAR_HELPER],
  ];
  for (const [actual, expected] of immutableChecks) {
    if (!eqAddress(actual, expected)) {
      throw new Error(`Immutable mismatch: ${actual} != ${expected}`);
    }
  }
  if (!callerCount.eq(authorizedCallers.length)) throw new Error('Helper caller count mismatch.');
  if (!assetCount.eq(assets.length)) throw new Error('Helper asset count mismatch.');
  if (!htsAssetCount.eq(htsAssets.length)) throw new Error('Helper HTS asset count mismatch.');
  if (repaymentsPaused) throw new Error('New helper repayments are unexpectedly paused.');
  if (closed) throw new Error('New helper is unexpectedly closed.');
  if (eqAddress(liveAdmin, helper.address)) {
    throw new Error('Deploy script unexpectedly changed the emergency admin.');
  }
  for (let i = 0; i < authorizedCallers.length; i++) {
    const [caller, allowed] = await Promise.all([
      helper.AUTHORIZED_CALLERS(i),
      helper.authorizedCaller(authorizedCallers[i]),
    ]);
    if (!eqAddress(caller, authorizedCallers[i]) || !allowed) {
      throw new Error(`Helper caller configuration mismatch at index ${i}.`);
    }
  }
  for (let i = 0; i < assets.length; i++) {
    const [asset, allowed, repaid] = await Promise.all([
      helper.ASSETS(i),
      helper.allowedAsset(assets[i]),
      helper.totalRepaid(assets[i]),
    ]);
    if (!eqAddress(asset, assets[i]) || !allowed || !repaid.isZero()) {
      throw new Error(`Helper settlement configuration mismatch at index ${i}.`);
    }
  }
  for (let i = 0; i < htsAssets.length; i++) {
    if (!eqAddress(await helper.HTS_ASSETS(i), htsAssets[i])) {
      throw new Error(`Helper HTS association configuration mismatch at index ${i}.`);
    }
  }

  writeJson(STATE_PATH, {
    network: CHAIN,
    chainId: MAINNET_CHAIN_ID,
    helper: helper.address,
    deploymentTxHash: helper.deployTransaction.hash,
    deploymentBlock: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    validated: true,
    deployer: deployer.address,
    controller: roles.controllerAddress,
    originalEmergencyAdmin: roles.emergencyAdmin,
    poolAdmin: roles.poolAdmin,
    borrower: BORROWER,
    authorizedCallers,
    htsAssets,
    whbarHelper: WHBAR_HELPER,
    protocol: PROTOCOL_ADDRESSES,
    settlements: Object.fromEntries(
      roles.settlements.map((item) => [
        item.symbol,
        {
          asset: item.asset,
          decimals: item.decimals,
          variableDebtToken: item.variableDebtToken,
          debtAtDeployment: item.currentDebt.toString(),
        },
      ])
    ),
    ...verified,
  });
  console.log('Atomic repay helper deployed and validated:', helper.address);
  console.log('Emergency admin remains unchanged:', liveAdmin);
}

main().catch((error) => {
  console.error(`Deployment or validation FAILED: ${conciseRpcError(error)}`);
  process.exit(1);
});
