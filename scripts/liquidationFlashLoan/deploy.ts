import hre, { ethers } from 'hardhat';
import { LendingPoolAddressesProvider } from '../outputReserveData.json';
import { resolveHederaNetwork } from '../lib/resolveHederaNetwork';

async function main() {
  const chainType = resolveHederaNetwork(hre);

  const provider =
    chainType === 'hedera_testnet'
      ? new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api')
      : new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');
  const deployer =
    chainType === 'hedera_testnet'
      ? new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider)
      : new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);

  console.log('Deployer address: ', deployer.address);
  console.log('Deploying contracts with the account:', deployer.address);

  const addressesProvider = LendingPoolAddressesProvider[chainType].address;

  const liquidationFLashLoanFactory = await hre.ethers.getContractFactory('Liquidator');
  const liquidationFLashLoanContract = await liquidationFLashLoanFactory
    .connect(deployer)
    .deploy(addressesProvider, '0x0000000000000000000000000000000000004b40');
  await liquidationFLashLoanContract.deployed();
  console.log(
    'liquidationFLashLoanContract contract deployed to:',
    liquidationFLashLoanContract.address
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
  });
