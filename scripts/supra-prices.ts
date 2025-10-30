import { ethers } from 'ethers';
import hre from 'hardhat';
import { USDC, SAUCE, WETH, WHBAR } from './outputReserveData.json';
import 'dotenv/config';

interface NetworkConfig {
  providerUrl: string;
  ownerKey: string;
  oracleAddress: string;
}

const networkConfigs: Record<string, NetworkConfig> = {
  hedera_testnet: {
    providerUrl: 'https://testnet.hashio.io/api',
    ownerKey: process.env.PRIVATE_KEY2 || '',
    oracleAddress: '0x8D1F2367D94933044046a10d9A3Fb1CdcC6cb01F',
  },
  hedera_mainnet: {
    providerUrl: process.env.PROVIDER_URL_MAINNET || '',
    ownerKey: process.env.PRIVATE_KEY_MAINNET || '',
    oracleAddress: '0x2e78BedD7175dEC675949f50a2604bC835A47a03',
  },
};

const setupContract = async (
  artifactName: string,
  contractAddress: string,
  signer: ethers.Wallet
) => {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(contractAddress, artifact.abi, signer);
};

const getAssetInfo = (assetData: any, networkName: string) => {
  if (assetData && assetData[networkName] && assetData[networkName].token) {
    const rawAddress = assetData[networkName].token.address;
    // Normalize address to checksum format to ensure consistent casing
    const normalizedAddress = ethers.utils.getAddress(rawAddress);
    return {
      address: normalizedAddress,
    };
  }
  return null;
};

const checkSupraPrices = async () => {
  const networkName = process.env.CHAIN_TYPE || 'hedera_testnet';
  if (!networkConfigs[networkName]) {
    throw new Error(`Configuration for network "${networkName}" not found.`);
  }
  const config = networkConfigs[networkName];

  const provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
  const owner = new ethers.Wallet(config.ownerKey, provider);

  console.log(`Running on ${networkName}`);
  console.log('Supra oracle address = ', config.oracleAddress);
  console.log('Owner address = ', owner.address);

  const supraOracle = await setupContract('SupraOracle', config.oracleAddress, owner);

  const assetsToCheck = [
    { name: 'USDC', data: USDC },
    { name: 'SAUCE', data: SAUCE },
    { name: 'WETH', data: WETH },
    { name: 'WHBAR', data: WHBAR },
  ];

  for (const asset of assetsToCheck) {
    const assetInfo = getAssetInfo(asset.data, networkName);
    if (assetInfo) {
      console.log(`\n--- Checking ${asset.name} ---`);
      console.log(`${asset.name} token address: `, assetInfo.address);
      try {
        const price = await supraOracle.getAssetPrice(assetInfo.address);
        console.log(`${asset.name} price = `, ethers.utils.formatUnits(price, 18));
      } catch (error: any) {
        // Try to decode the error
        let errorMessage = 'Unknown error';
        let errorName = '';

        if (error.error) {
          errorName = error.error.name || '';
          errorMessage = error.error.message || error.message || String(error);
        } else if (error.reason) {
          errorMessage = error.reason;
        } else if (error.errorName) {
          errorName = error.errorName;
          errorMessage = error.message || String(error);
        } else {
          errorMessage = error.message || String(error);
        }

        // Check for common custom errors
        const errorStr = String(errorMessage).toLowerCase();
        if (errorName === 'UnsupportedAsset' || errorStr.includes('unsupportedasset')) {
          console.error(
            `Error: ${asset.name} is not registered in the oracle contract. Asset needs to be added via addNewAsset().`
          );
        } else if (errorName === 'DivisionByZero' || errorStr.includes('divisionbyzero')) {
          console.error(
            `Error: Division by zero when fetching ${asset.name} price (feed may be stale or invalid)`
          );
        } else if (errorStr.includes('call revert exception')) {
          console.error(`Error: Contract call reverted for ${asset.name}. This usually means:`);
          console.error(`  1. Asset is not registered in the oracle`);
          console.error(`  2. Price feed data is unavailable`);
          console.error(`  3. Address mismatch (check if address is correct)`);
        } else {
          console.error(`Error fetching price for ${asset.name}:`, errorMessage);
        }
      }
    } else {
      console.log(`\n--- Skipping ${asset.name} (no config for ${networkName}) ---`);
    }
  }
};

const checkSaucePriceIndex = async () => {
  const networkName = process.env.CHAIN_TYPE || 'hedera_testnet';
  if (!networkConfigs[networkName]) {
    console.log(`\n--- Skipping SAUCE price index (no config for ${networkName}) ---`);
    return;
  }
  const config = networkConfigs[networkName];
  const provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
  const owner = new ethers.Wallet(config.ownerKey, provider);
  const supraOracle = await setupContract('SupraOracle', config.oracleAddress, owner);
  const sauceInfo = getAssetInfo(SAUCE, networkName);

  if (sauceInfo) {
    console.log(`\n--- Checking SAUCE Price Index ---`);
    try {
      const priceIndex = await supraOracle.getPriceFeed(sauceInfo.address);
      console.log(`SAUCE price index:`, priceIndex.toString());
    } catch (error) {
      console.error(`Error fetching price index for SAUCE:`, (error as Error).message);
    }
  }
};

const main = async () => {
  await checkSupraPrices();
  // await checkSaucePriceIndex();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
