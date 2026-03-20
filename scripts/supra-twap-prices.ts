import { ethers } from 'ethers';
import hre from 'hardhat';
import { USDC, SAUCE, WETH, WHBAR } from './outputReserveData.json';
import 'dotenv/config';

interface NetworkConfig {
  providerUrl: string;
  ownerKey: string;
  chainId: number;
}

const networkConfigs: Record<string, NetworkConfig> = {
  hedera_testnet: {
    providerUrl: 'https://testnet.hashio.io/api',
    ownerKey: process.env.PRIVATE_KEY2 || '',
    chainId: 296,
  },
  hedera_mainnet: {
    providerUrl: process.env.PROVIDER_URL_MAINNET || '',
    ownerKey: process.env.PRIVATE_KEY_MAINNET || '',
    chainId: 295,
  },
};

const PRICE_DECIMALS = 18;

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
    return {
      address: ethers.utils.getAddress(rawAddress),
    };
  }
  return null;
};

function uniqAddresses(addrs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of addrs) {
    const key = a.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(a);
    }
  }
  return out;
}

async function printGlobalConfig(oracle: ethers.Contract) {
  try {
    const [
      maxPriceStaleness,
      twapWindow,
      maxDeviationBps,
      minObservationsForEnforcement,
      recorderDeviationMultiplierBps,
      recoveryConfirmationCount,
      recoveryStabilityBps,
      recoveryMinDuration,
      maxReanchorDeviationBps,
    ] = await Promise.all([
      oracle.maxPriceStaleness(),
      oracle.twapWindow(),
      oracle.maxDeviationBps(),
      oracle.minObservationsForEnforcement(),
      oracle.recorderDeviationMultiplierBps(),
      oracle.recoveryConfirmationCount(),
      oracle.recoveryStabilityBps(),
      oracle.recoveryMinDuration(),
      oracle.maxReanchorDeviationBps(),
    ]);

    console.log('\n=== SupraOracleTWAP config ===');
    console.log('maxPriceStaleness (s):', maxPriceStaleness.toString());
    console.log('twapWindow (s):', twapWindow.toString());
    console.log('maxDeviationBps:', maxDeviationBps.toString());
    console.log('minObservationsForEnforcement:', minObservationsForEnforcement.toString());
    console.log('recorderDeviationMultiplierBps:', recorderDeviationMultiplierBps.toString());
    console.log('recoveryConfirmationCount:', recoveryConfirmationCount.toString());
    console.log('recoveryStabilityBps:', recoveryStabilityBps.toString());
    console.log('recoveryMinDuration (s):', recoveryMinDuration.toString());
    console.log('maxReanchorDeviationBps:', maxReanchorDeviationBps.toString());
  } catch (e) {
    console.warn('Could not read global TWAP config:', (e as Error).message);
  }
}

async function inspectAsset(oracle: ethers.Contract, label: string, assetAddress: string) {
  console.log(`\n--- ${label} (${assetAddress}) ---`);

  try {
    const price = await oracle.getAssetPrice(assetAddress);
    console.log('getAssetPrice (HBAR, 18 dec):', ethers.utils.formatUnits(price, PRICE_DECIMALS));
  } catch (error: any) {
    console.error('getAssetPrice:', decodeOracleError(error));
  }

  try {
    const usd = await oracle.getAssetPriceInUSD(assetAddress);
    console.log('getAssetPriceInUSD (18 dec):', ethers.utils.formatUnits(usd, PRICE_DECIMALS));
  } catch (error: any) {
    console.error('getAssetPriceInUSD:', decodeOracleError(error));
  }

  try {
    const twap = await oracle.getTWAP(assetAddress);
    console.log('getTWAP (18 dec):', ethers.utils.formatUnits(twap, PRICE_DECIMALS));
  } catch (error: any) {
    console.error('getTWAP:', decodeOracleError(error));
  }

  try {
    const count = await oracle.getObservationCount(assetAddress);
    console.log('getObservationCount:', count.toString());
  } catch (error: any) {
    console.error('getObservationCount:', decodeOracleError(error));
  }

  try {
    const [obsPrice, obsTs] = await oracle.getLatestObservation(assetAddress);
    console.log(
      'getLatestObservation price (18 dec):',
      obsPrice.isZero() ? '0' : ethers.utils.formatUnits(obsPrice, PRICE_DECIMALS),
      'timestamp:',
      obsTs.toString()
    );
  } catch (error: any) {
    console.error('getLatestObservation:', decodeOracleError(error));
  }

  try {
    const lastValid = await oracle.getLastValidPrice(assetAddress);
    console.log(
      'getLastValidPrice (18 dec):',
      lastValid.isZero() ? '0' : ethers.utils.formatUnits(lastValid, PRICE_DECIMALS)
    );
  } catch (error: any) {
    console.error('getLastValidPrice:', decodeOracleError(error));
  }

  try {
    const [cand, candCount, firstSeen, lastFeedTs, inRecovery] = await oracle.getRecoveryState(
      assetAddress
    );
    console.log(
      'getRecoveryState candidate / count / firstSeen / lastFeedTs / inRecovery:',
      cand.toString(),
      candCount.toString(),
      firstSeen.toString(),
      lastFeedTs.toString(),
      inRecovery
    );
  } catch (error: any) {
    console.error('getRecoveryState:', decodeOracleError(error));
  }

  try {
    const [spot, twapPrice, deviationBps, wouldBlock] = await oracle.checkCurrentDeviation(
      assetAddress
    );
    console.log(
      'checkCurrentDeviation spot (raw) / twap (raw) / deviationBps / wouldBlock:',
      spot.toString(),
      twapPrice.toString(),
      deviationBps.toString(),
      wouldBlock
    );
  } catch (error: any) {
    console.error('checkCurrentDeviation:', decodeOracleError(error));
  }
}

function decodeOracleError(error: any): string {
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

  const errorStr = String(errorMessage).toLowerCase();
  if (errorName === 'UnsupportedAsset' || errorStr.includes('unsupportedasset')) {
    return 'UnsupportedAsset — asset not registered in oracle';
  }
  if (errorName === 'DivisionByZero' || errorStr.includes('divisionbyzero')) {
    return 'DivisionByZero — feed may be stale or invalid';
  }
  if (errorName === 'StalePrice' || errorStr.includes('staleprice')) {
    return 'StalePrice — feed older than maxPriceStaleness';
  }
  if (errorName === 'InvalidPrice' || errorStr.includes('invalidprice')) {
    return 'InvalidPrice';
  }
  return errorMessage;
}

const checkSupraTwapPrices = async () => {
  const networkName =
    hre.network.name !== 'hardhat' ? hre.network.name : process.env.CHAIN_TYPE || 'hedera_testnet';

  if (!networkConfigs[networkName]) {
    throw new Error(`Configuration for network "${networkName}" not found.`);
  }

  const oracleAddress = (process.env.SUPRA_TWAP_ORACLE_ADDRESS || '').trim();
  if (!oracleAddress || !ethers.utils.isAddress(oracleAddress)) {
    throw new Error(
      'Set SUPRA_TWAP_ORACLE_ADDRESS to a deployed SupraOracleTWAP address (see .env.example).'
    );
  }

  const config = networkConfigs[networkName];
  if (!config.providerUrl) {
    throw new Error(
      networkName === 'hedera_mainnet'
        ? 'PROVIDER_URL_MAINNET is required for hedera_mainnet'
        : 'providerUrl missing'
    );
  }

  const provider = new ethers.providers.JsonRpcProvider(config.providerUrl, {
    name: networkName,
    chainId: config.chainId,
  });
  const owner = new ethers.Wallet(config.ownerKey, provider);

  console.log(`Running on ${networkName}`);
  console.log('SupraOracleTWAP address =', ethers.utils.getAddress(oracleAddress));
  console.log('Signer address =', owner.address);

  const oracle = await setupContract('SupraOracleTWAP', oracleAddress, owner);

  await printGlobalConfig(oracle);

  const staticAssets: { name: string; data: any }[] = [
    { name: 'USDC', data: USDC },
    { name: 'SAUCE', data: SAUCE },
    { name: 'WETH', data: WETH },
    { name: 'WHBAR', data: WHBAR },
  ];

  const addresses: string[] = [];

  for (const asset of staticAssets) {
    const info = getAssetInfo(asset.data, networkName);
    if (info) {
      addresses.push(info.address);
      await inspectAsset(oracle, asset.name, info.address);
    } else {
      console.log(`\n--- Skipping ${asset.name} (no config for ${networkName}) ---`);
    }
  }

  try {
    const supraAssets: string[] = await oracle.getSupraAssets();
    const normalized = supraAssets.map((a: string) => ethers.utils.getAddress(a));
    const extras = normalized.filter(
      (a) => !addresses.some((x) => x.toLowerCase() === a.toLowerCase())
    );

    if (extras.length > 0) {
      console.log('\n=== Additional Supra-fed assets (from getSupraAssets) ===');
      let i = 0;
      for (const addr of uniqAddresses(extras)) {
        i += 1;
        await inspectAsset(oracle, `supraAsset[${i}]`, addr);
      }
    }
  } catch (e) {
    console.warn('getSupraAssets failed:', (e as Error).message);
  }
};

const main = async () => {
  await checkSupraTwapPrices();
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
