import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import { SAUCE, WHBAR, USDC, KARATE, HBARX } from './outputReserveData.json';

require('dotenv').config();

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';

let provider, owner;
let dataProviderAddress;
if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
  dataProviderAddress = AaveProtocolDataProvider.hedera_testnet.address;
} else if (chain_type === 'hedera_testnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  // console.log('Provider = ', provider);
  owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
  dataProviderAddress = AaveProtocolDataProvider.hedera_testnet.address;
}

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function lendingPool() {
  console.log('Deploying contracts with the account:', owner.address);
  // Load the contract artifacts
  const lendingPoolContract = await setupContract(
    'LendingPool',
    LendingPool.hedera_testnet.address
  );
  const lendingPoolConfiguratorContract = await setupContract(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_testnet.address
  );
  const lendingPoolAddressesProviderContract = await setupContract(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_testnet.address
  );
  const dataProviderContract = await setupContract('AaveProtocolDataProvider', dataProviderAddress);

  // console.log('Pool admin = ', await lendingPoolAddressesProviderContract.getPoolAdmin());
  // console.log('Emergency admin = ', await lendingPoolAddressesProviderContract.getEmergencyAdmin());

  // const sauceAToken = await setupContract('AToken', WHBAR.hedera_testnet.aToken.address);

  // console.log('Owner:', owner.address);

  // const disableTxn = await lendingPoolConfiguratorContract.disableBorrowingOnReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await disableTxn.wait();
  // console.log('Borrowing disabled');

  // const deactivateTxn = await lendingPoolConfiguratorContract.deactivateReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await deactivateTxn.wait();
  // console.log('Reserve deactivated');

  // const freezeTxn = await lendingPoolConfiguratorContract.unfreezeReserve(
  //   BSTEAM.hedera_testnet.token.address
  // );
  // await freezeTxn.wait();
  // console.log('Reserve frozen');

  // 0x103aADF590b249dFc2424c0d499bA406902EE60a
  // console.log('Old Oracle = ', await lendingPoolAddressesProviderContract.getPriceOracle());
  // const oracleUpdate = await lendingPoolAddressesProviderContract.setPriceOracle(
  //   '0x103aADF590b249dFc2424c0d499bA406902EE60a'
  // );
  // await oracleUpdate.wait();
  // console.log('Oracle updated...');
  // console.log('New oracle = ', await lendingPoolAddressesProviderContract.getPriceOracle());

  // const reservesList = await lendingPoolContract.getReservesList();
  // console.log('Reserves:', reservesList);

  // const positionManager = await lendingPoolContract.getPositionManager();
  // console.log('Position Manager:', positionManager);

  // Step 1 - Need to unpause the contract
  // console.log('Paused before:', await lendingPoolContract.paused());
  // const txn = await lendingPoolConfiguratorContract.setPoolPause(true);
  // await txn.wait();
  // console.log('Paused after:', await lendingPoolContract.paused());

  // const configureTxn = await lendingPoolConfiguratorContract.configureReserveAsCollateral(
  //   BHST.hedera_testnet.token.address,
  //   0,
  //   0,
  //   0
  // );
  // await configureTxn.wait();
  // console.log('Reserve configured as collateral');

  // // Enable or disable an asset as a collateral
  // const userReserveData = await dataProviderContract.getUserReserveData(
  //   USDC.hedera_testnet.token.address,
  //   '0xbe058ee0884696653E01cfC6F34678f2762d84db'
  // );
  // console.log('User Reserve Data for USDC:', userReserveData);
  console.log(
    'user account data:',
    await lendingPoolContract.getUserAccountData('0xbe058ee0884696653E01cfC6F34678f2762d84db')
  );
  // const amountInEth = await lendingPoolContract.getAmountInEth(
  //   100000000,
  //   WSTEAM.hedera_testnet.token.address
  // );
  // console.log('Amount in ETH:', ethers.utils.formatUnits(amountInEth.toString(), 18));
  // console.log('Collateral enabled:', userReserveData.usageAsCollateralEnabled);
  // const enableTXN = await lendingPoolContract.setUserUseReserveAsCollateral(
  //   BSTEAM.hedera_testnet.token.address,
  //   false
  // );
  // await enableTXN.wait();
  // console.log('Collateral disabled');

  // const reserveData = await dataProviderContract.getReserveConfigurationData(
  //   USDC.hedera_testnet.token.address
  // );
  // console.log('USDC Reserve Data:', reserveData);
  // const allReserveTokens = await dataProviderContract.getAllReservesTokens();
  // console.log('All Reserve Tokens:', allReserveTokens);

  // Get the Bonzo asset reserve data
  // const usdcReserveData = await dataProviderContract.getReserveData(
  //   USDC.hedera_testnet.token.address
  // );
  // console.log('USDC Reserve Data:', usdcReserveData);
  // console.log(
  //   'Bonzo Total Debt:',
  //   ethers.utils.formatUnits(bonzoReserveData.totalVariableDebt.toString(), 8)
  // );

  // // Get the total supply of the Bonzo variable debt token directly
  // const variableDebtTokenContract = await setupContract(
  //   'VariableDebtToken',
  //   BONZO.hedera_testnet.variableDebt.address
  // );

  // const totalSupply = await variableDebtTokenContract.totalSupply();
  // console.log(
  //   'Bonzo Variable Debt Token Total Supply:',
  //   ethers.utils.formatUnits(totalSupply.toString(), 8)
  // );

  console.log('Provider oracle:', await lendingPoolAddressesProviderContract.getPriceOracle());
  console.log(
    'SAUCE 0.1 in HBAR:',
    await lendingPoolContract.getAmountInEth(
      ethers.utils.parseUnits('0.1', 6),
      SAUCE.hedera_testnet.token.address
    )
  );

  // // Fetch and print reserve data for all current reserves in the pool
  // const reservesList = await lendingPoolContract.getReservesList();
  // console.log('Reserves List:', reservesList);

  // // Build a symbol lookup for nicer logs
  // const allReservesTokens = await dataProviderContract.getAllReservesTokens();
  // const symbolByAddress = new Map<string, string>();
  // for (const t of allReservesTokens) {
  //   // t: { symbol: string, tokenAddress: string }
  //   symbolByAddress.set(t.tokenAddress.toLowerCase(), t.symbol);
  // }

  // for (const reserve of reservesList) {
  //   const sym = symbolByAddress.get(reserve.toLowerCase()) || 'UNKNOWN';
  //   console.log(`\n===== Reserve ${sym} (${reserve}) =====`);
  //   try {
  //     const reserveCfg = await dataProviderContract.getReserveConfigurationData(reserve);
  //     console.log(`${sym} Reserve Configuration:`, reserveCfg);

  //     const reserveData = await dataProviderContract.getReserveData(reserve);
  //     console.log(`${sym} Reserve Data:`, reserveData);
  //   } catch (e) {
  //     console.error(`Failed fetching data for reserve ${sym} (${reserve})`, e);
  //   }
  // }
}

async function main() {
  await lendingPool();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
