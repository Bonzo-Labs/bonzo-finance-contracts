const hardhat = require('hardhat');
require('dotenv').config();

const outputReserveData = require('./outputReserveData.json');

const chainType = process.env.CHAIN_TYPE || 'hedera_testnet';

async function deployWHBARGateway() {
  let provider, owner, whbarToken, lendingPool;

  if (chainType === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    whbarToken = '0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed';
    lendingPool = outputReserveData.LendingPool.hedera_testnet.address;
  } else if (chainType === 'hedera_mainnet') {
    provider = new hardhat.ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET);
    owner = new hardhat.ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
    whbarToken = '0xb1f616b8134f602c3bb465fb5b5e6565ccad37ed';
    lendingPool = outputReserveData.LendingPool.hedera_mainnet.address;
  }

  try {
    const Gateway = await hardhat.ethers.getContractFactory('WHBARGateway');
    const gateway = await Gateway.connect(owner).deploy(whbarToken, {
      gasLimit: 13800000,
    });
    console.log('Deploying WHBARGateway...');
    await gateway.deployed();
    console.log('WHBARGateway deployed to:', gateway.address);

    const whbarAddr = await gateway.getWHBARAddress();
    console.log('WHBAR token address:', whbarAddr);

    console.log('Authorizing LendingPool...');
    const authTx = await gateway
      .connect(owner)
      .authorizeLendingPool(lendingPool, { gasLimit: 1000000 });
    await authTx.wait();
    console.log('LendingPool authorized:', lendingPool);
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
