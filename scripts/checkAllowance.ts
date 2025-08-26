import { ethers } from 'hardhat';
const hre = require('hardhat');
import { WHBAR } from './outputReserveData.json';

require('dotenv').config();

// Configuration
const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
const WHBAR_TOKEN_ADDRESS = '0x0000000000000000000000000000000000163b5a'; // Mainnet WHBAR token
const WHBAR_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000163b59'; // WHBAR contract (spender)

// Account address to check (can be passed as command line argument)
const ACCOUNT_ADDRESS = process.argv[2] || process.env.ACCOUNT_ADDRESS;

let provider, wallet;

if (chain_type === 'hedera_testnet') {
  provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);
} else if (chain_type === 'hedera_mainnet') {
  const url = process.env.PROVIDER_URL_MAINNET || '';
  provider = new ethers.providers.JsonRpcProvider(url);
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
}

async function setupContract(artifactName: string, contractAddress: string) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, wallet);
}

async function checkAllowance() {
  if (!ACCOUNT_ADDRESS) {
    console.error(
      'Please provide an account address as a command line argument or set ACCOUNT_ADDRESS environment variable'
    );
    console.log('Usage: npx hardhat run scripts/checkAllowance.ts -- <account_address>');
    console.log(
      'Example: npx hardhat run scripts/checkAllowance.ts -- 0x1234567890123456789012345678901234567890'
    );
    console.log(
      'Or set environment variable: ACCOUNT_ADDRESS=0x1234567890123456789012345678901234567890 npx hardhat run scripts/checkAllowance.ts'
    );
    process.exit(1);
  }

  try {
    // Get WHBAR token address based on chain type
    const whbarTokenAddress =
      chain_type === 'hedera_mainnet'
        ? WHBAR.hedera_mainnet.token.address
        : WHBAR.hedera_testnet.token.address;

    console.log('Chain type:', chain_type);
    console.log('WHBAR Token Address:', whbarTokenAddress);
    console.log('WHBAR Contract Address (Spender):', WHBAR_CONTRACT_ADDRESS);
    console.log('Account Address (Owner):', ACCOUNT_ADDRESS);
    console.log('---');

    // Create ERC20 contract instance for WHBAR token
    const erc20Abi = [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function balanceOf(address account) view returns (uint256)',
    ];

    const whbarTokenContract = new ethers.Contract(whbarTokenAddress, erc20Abi, provider);

    // Get token details
    const [name, symbol, decimals] = await Promise.all([
      whbarTokenContract.name(),
      whbarTokenContract.symbol(),
      whbarTokenContract.decimals(),
    ]);

    console.log(`Token Details: ${name} (${symbol}), Decimals: ${decimals}`);

    // Get account balance
    const balance = await whbarTokenContract.balanceOf(ACCOUNT_ADDRESS);
    console.log(`Account Balance: ${ethers.utils.formatUnits(balance, decimals)} ${symbol}`);

    // Check allowance
    const allowance = await whbarTokenContract.allowance(ACCOUNT_ADDRESS, WHBAR_CONTRACT_ADDRESS);
    console.log(`Current Allowance: ${ethers.utils.formatUnits(allowance, decimals)} ${symbol}`);
    console.log(`Raw Allowance Value: ${allowance.toString()}`);

    if (allowance.gt(0)) {
      console.log('✅ Account has allowance for WHBAR contract');
    } else {
      console.log('❌ Account has no allowance for WHBAR contract');
    }
  } catch (error) {
    console.error('Error checking allowance:', error);
    process.exit(1);
  }
}

async function main() {
  await checkAllowance();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
