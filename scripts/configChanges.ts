import { ethers, network } from 'hardhat';
const hre = require('hardhat');
import {
  LendingPool,
  LendingPoolAddressesProvider,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from './outputReserveData.json';
import { SAUCE, HBARX, WHBAR } from './outputReserveData.json';

const provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
const owner = new ethers.Wallet(process.env.PRIVATE_KEY2 || '', provider);

async function setupContract(artifactName, contractAddress) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, owner);
}

async function configChanges() {
  const [deployer] = await ethers.getSigners();
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
  const dataProviderContract = await setupContract(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_testnet.address
  );

  //   const disableHBARXTxn = await lendingPoolConfiguratorContract.freezeReserve(HBARX.token.address);
  //   await disableHBARXTxn.wait();
  //   console.log('HBARX borrowing enabled');

  const disableWHBARTxn = await lendingPoolConfiguratorContract.unfreezeReserve(
    WHBAR.token.address
  );
  await disableWHBARTxn.wait();
  console.log('WHBAR borrowing enabled');

  //   const disableSAUCETxn = await lendingPoolConfiguratorContract.deactivateReserve(
  //     SAUCE.token.address
  //   );
  //   await disableSAUCETxn.wait();
  //   console.log('SAUCE reserve deactivated');

  // Check if borrowing is enabled on a reserve
  const reserveData = await dataProviderContract.getReserveConfigurationData(HBARX.token.address);
  console.log('HBARX reserve data:', reserveData);

  const reserveData2 = await dataProviderContract.getReserveConfigurationData(WHBAR.token.address);
  console.log('WHBAR reserve data:', reserveData2);

  const reserveData3 = await dataProviderContract.getReserveConfigurationData(SAUCE.token.address);
  console.log('SAUCE reserve data:', reserveData3);
}

async function main() {
  await configChanges();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
