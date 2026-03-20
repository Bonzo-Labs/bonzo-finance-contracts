import hre from 'hardhat';
import { ethers } from 'ethers';
import 'dotenv/config';

/**
 * Deploy `SupraOracleTWAP` (same feed wiring as `scripts/supra-deploy.ts`).
 *
 * Usage:
 *   CHAIN_TYPE=hedera_testnet npx hardhat run scripts/supra-twap-deploy.ts --network hedera_testnet
 *   CHAIN_TYPE=hedera_mainnet npx hardhat run scripts/supra-twap-deploy.ts --network hedera_mainnet
 */
const chainType = process.env.CHAIN_TYPE || 'hedera_testnet';

async function main() {
  console.log(`\n=== Deploying SupraOracleTWAP for ${chainType} ===\n`);

  let provider: ethers.providers.JsonRpcProvider;
  let owner: ethers.Wallet;
  let supraFeed: string;
  let hbarUsdChainlinkFeed: string;
  let usdcUsdChainlinkFeed: string;
  let ethUsdChainlinkFeed: string;
  let chainId: number;

  if (chainType === 'hedera_testnet') {
    chainId = 296;
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api', {
      name: 'hedera_testnet',
      chainId,
    });
    owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
    supraFeed = '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917';
    hbarUsdChainlinkFeed = '0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a';
    usdcUsdChainlinkFeed = '0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5';
    ethUsdChainlinkFeed = ethers.constants.AddressZero;
  } else if (chainType === 'hedera_mainnet') {
    const url = process.env.PROVIDER_URL_MAINNET || '';
    if (!url) {
      throw new Error(
        'PROVIDER_URL_MAINNET environment variable is required for mainnet deployment'
      );
    }
    chainId = 295;
    provider = new ethers.providers.JsonRpcProvider(url, {
      name: 'hedera_mainnet',
      chainId,
    });
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
    hbarUsdChainlinkFeed = '0xAF685FB45C12b92b5054ccb9313e135525F9b5d5';
    usdcUsdChainlinkFeed = '0x2b358642c7C37b6e400911e4FE41770424a7349F';
    ethUsdChainlinkFeed = '0xd2D2CB0AEb29472C3008E291355757AD6225019e';
    supraFeed = '0xD02cc7a670047b6b012556A88e275c685d25e0c9';
  } else {
    throw new Error(
      `Unsupported CHAIN_TYPE: ${chainType}. Must be 'hedera_testnet' or 'hedera_mainnet'`
    );
  }

  if (!supraFeed || !hbarUsdChainlinkFeed || !usdcUsdChainlinkFeed) {
    throw new Error('Missing required feed addresses for deployment');
  }
  if (chainType === 'hedera_mainnet' && !ethUsdChainlinkFeed) {
    throw new Error('ETH_USD Chainlink feed is required for mainnet deployment');
  }

  console.log('Chain Type:', chainType);
  console.log('Owner:', owner.address);
  console.log('Supra Feed:', supraFeed);
  console.log('HBAR/USD Chainlink Feed:', hbarUsdChainlinkFeed);
  console.log('USDC/USD Chainlink Feed:', usdcUsdChainlinkFeed);
  console.log('ETH/USD Chainlink Feed:', ethUsdChainlinkFeed);
  console.log('');

  const Factory = await hre.ethers.getContractFactory('SupraOracleTWAP', owner);
  const oracle = await Factory.deploy(
    supraFeed,
    hbarUsdChainlinkFeed,
    usdcUsdChainlinkFeed,
    ethUsdChainlinkFeed
  );
  await oracle.deployed();

  console.log('\n✅ SupraOracleTWAP deployed successfully!');
  console.log('Contract Address:', oracle.address);
  console.log('\nSet SUPRA_TWAP_ORACLE_ADDRESS for scripts/supra-twap-prices.ts');
  console.log(
    'Built-in assets match constructor in SupraOracleTWAP.sol (mainnet-style addresses).\n'
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
