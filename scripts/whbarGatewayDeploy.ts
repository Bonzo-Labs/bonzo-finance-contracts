const hardhat = require('hardhat');
const { ethers } = hardhat;
require('dotenv').config();

const outputReserveData = require('./outputReserveData.json');
const { HederaConfig } = require('../markets/hedera');
const { resolveHederaNetwork } = require('./lib/resolveHederaNetwork');

const chainType = resolveHederaNetwork(hardhat);
const reserveDataForChain = outputReserveData.WHBAR[chainType];

async function deployWHBARGateway() {
  let provider, owner, whbarHelper, lendingPool, addressesProvider, expectedWhbarToken;

  if (chainType === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
    whbarHelper = HederaConfig.WhbarHelper[chainType];
    lendingPool = outputReserveData.LendingPool.hedera_testnet.address;
    addressesProvider = outputReserveData.LendingPoolAddressesProvider.hedera_testnet.address;
    expectedWhbarToken = reserveDataForChain.token.address;
  } else if (chainType === 'hedera_mainnet') {
    provider = new hardhat.ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET);
    owner = new hardhat.ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
    whbarHelper = HederaConfig.WhbarHelper[chainType];
    lendingPool = outputReserveData.LendingPool.hedera_mainnet.address;
    addressesProvider = outputReserveData.LendingPoolAddressesProvider.hedera_mainnet.address;
    expectedWhbarToken = reserveDataForChain.token.address;
  } else {
    throw new Error(
      `Unsupported chain type: ${chainType}. Must be 'hedera_testnet' or 'hedera_mainnet'`
    );
  }

  try {
    if (!whbarHelper || !ethers.utils.isAddress(whbarHelper)) {
      throw new Error('WHBAR helper address not configured or invalid');
    }

    if (!addressesProvider || !ethers.utils.isAddress(addressesProvider)) {
      throw new Error('Addresses provider address not configured or invalid');
    }

    const Gateway = await hardhat.ethers.getContractFactory('WHBARGateway');
    const gateway = await Gateway.connect(owner).deploy(whbarHelper, addressesProvider, {
      gasLimit: 14500000,
    });
    console.log('Deploying WHBARGateway...');
    await gateway.deployed();
    console.log('WHBARGateway deployed to:', gateway.address);

    const whbarAddr = await gateway.getWHBARAddress();
    console.log('WHBAR token address:', whbarAddr);
    if (whbarAddr.toLowerCase() !== expectedWhbarToken.toLowerCase()) {
      throw new Error(`WHBAR token mismatch: expected ${expectedWhbarToken}, got ${whbarAddr}`);
    }

    console.log('Authorizing LendingPool...');
    const authTx = await gateway
      .connect(owner)
      .authorizeLendingPool(lendingPool, { gasLimit: 6000000 });
    await authTx.wait();
    console.log('LendingPool authorized:', lendingPool);

    const lendingPoolInGateway = await gateway.getLendingPool();
    console.log('LendingPool in Gateway:', lendingPoolInGateway);
    const authorizedLendingPool = await gateway.lendingPool();
    console.log('Authorized LendingPool in Gateway:', authorizedLendingPool);

    if (lendingPoolInGateway.toLowerCase() !== lendingPool.toLowerCase()) {
      throw new Error('LendingPool in Gateway does not match the expected lending pool');
    }
    if (authorizedLendingPool.toLowerCase() !== lendingPool.toLowerCase()) {
      throw new Error('Authorized LendingPool in Gateway does not match the expected lending pool');
    }

    console.log('LendingPool in Gateway matches the expected lending pool');
  } catch (error) {
    console.error('An error occurred during deployment:', error);
  }
}

deployWHBARGateway()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
  });

export {};
