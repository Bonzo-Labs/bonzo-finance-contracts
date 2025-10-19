import { ethers } from 'ethers';
import hre from 'hardhat';
import { USDC, SAUCE } from './outputReserveData.json';
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
    oracleAddress: '0x16e55AF5576502e05ed18fD265F8dF7fC6f8ACbd',
  },
  hedera_mainnet: {
    providerUrl: process.env.PROVIDER_URL_MAINNET || '',
    ownerKey: process.env.PRIVATE_KEY_MAINNET || '',
    oracleAddress: '0xA40a801E4F6Adc1Bb589ADc4f1999519C635dE50',
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
    return {
      address: assetData[networkName].token.address,
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
  ];

  for (const asset of assetsToCheck) {
    const assetInfo = getAssetInfo(asset.data, networkName);
    if (assetInfo) {
      console.log(`\n--- Checking ${asset.name} ---`);
      console.log(`${asset.name} token address: `, assetInfo.address);
      try {
        const price = await supraOracle.getAssetPrice(assetInfo.address);
        console.log(`${asset.name} price = `, ethers.utils.formatUnits(price, 18));
      } catch (error) {
        console.error(`Error fetching price for ${asset.name}:`, (error as Error).message);
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
