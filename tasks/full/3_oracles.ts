import { task } from 'hardhat/config';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import {
  deployAaveOracle,
  deployLendingRateOracle,
  deploySupraOracle,
} from '../../helpers/contracts-deployments';
import { setInitialMarketRatesInRatesOracleByHelper } from '../../helpers/oracles-helpers';
import { ICommonConfiguration, eHederaNetwork, eNetwork, SymbolMap } from '../../helpers/types';
import { waitForTx, notFalsyOrZeroAddress } from '../../helpers/misc-utils';
import {
  ConfigNames,
  loadPoolConfig,
  getGenesisPoolAdmin,
  getLendingRateOracles,
  getQuoteCurrency,
} from '../../helpers/configuration';
import {
  getAaveOracle,
  getLendingPoolAddressesProvider,
  getLendingRateOracle,
  getPairsTokenAggregator,
} from '../../helpers/contracts-getters';
import { ZERO_ADDRESS } from '../../helpers/constants';
import { AaveOracle, LendingRateOracle } from '../../types';

const requireFeedAddress = (feedName: string, address: string, network: eNetwork) => {
  if (!notFalsyOrZeroAddress(address)) {
    throw new Error(`Missing ${feedName} feed for ${network}`);
  }
  return address;
};

task('full:deploy-oracles', 'Deploy oracles for dev enviroment')
  .addFlag('verify', 'Verify contracts at Etherscan')
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .setAction(async ({ verify, pool }, DRE) => {
    try {
      await DRE.run('set-DRE');
      const network = <eNetwork>DRE.network.name;
      const poolConfig = loadPoolConfig(pool);
      const {
        ProtocolGlobalParams: { UsdAddress },
        ReserveAssets,
        FallbackOracle,
        ChainlinkAggregator,
      } = poolConfig as ICommonConfiguration;

      const lendingRateOracles = getLendingRateOracles(poolConfig);
      const addressesProvider = await getLendingPoolAddressesProvider();
      const admin = await getGenesisPoolAdmin(poolConfig);
      const aaveOracleAddress = getParamPerNetwork(poolConfig.AaveOracle, network);
      const lendingRateOracleAddress = getParamPerNetwork(poolConfig.LendingRateOracle, network);
      const fallbackOracleAddress = await getParamPerNetwork(FallbackOracle, network);
      const reserveAssets = await getParamPerNetwork(ReserveAssets, network);
      const chainlinkAggregators = await getParamPerNetwork(ChainlinkAggregator, network);

      const tokensToWatch: SymbolMap<string> = {
        ...reserveAssets,
        USD: UsdAddress,
      };

      const [tokens, aggregators] = getPairsTokenAggregator(
        tokensToWatch,
        chainlinkAggregators,
        poolConfig.OracleQuoteCurrency
      );

      let aaveOracle: AaveOracle;
      let lendingRateOracle: LendingRateOracle;
      let fallbackOracle;
      let fallbackOracleAddressToUse = fallbackOracleAddress;

      if (!notFalsyOrZeroAddress(fallbackOracleAddress)) {
        const supraOracleFeeds = poolConfig.SupraOracleFeeds
          ? getParamPerNetwork(poolConfig.SupraOracleFeeds, network)
          : {
              SupraPriceFeed: poolConfig.SupraPriceFeed,
              HbarUsdChainlinkFeed: poolConfig.SupraPriceFeed,
              UsdcUsdChainlinkFeed: poolConfig.SupraPriceFeed,
              EthUsdChainlinkFeed: poolConfig.SupraPriceFeed,
            };
        const supraPriceFeed = requireFeedAddress(
          'Supra price',
          supraOracleFeeds.SupraPriceFeed,
          network
        );
        const hbarUsdChainlinkFeed = requireFeedAddress(
          'HBAR/USD Chainlink',
          supraOracleFeeds.HbarUsdChainlinkFeed,
          network
        );
        const usdcUsdChainlinkFeed = requireFeedAddress(
          'USDC/USD Chainlink',
          supraOracleFeeds.UsdcUsdChainlinkFeed,
          network
        );
        const ethUsdChainlinkFeed =
          network === eHederaNetwork.hedera_testnet
            ? supraOracleFeeds.EthUsdChainlinkFeed || ZERO_ADDRESS
            : requireFeedAddress(
                'ETH/USD Chainlink',
                supraOracleFeeds.EthUsdChainlinkFeed,
                network
              );

        fallbackOracle = await deploySupraOracle(
          supraPriceFeed,
          hbarUsdChainlinkFeed,
          usdcUsdChainlinkFeed,
          ethUsdChainlinkFeed,
          verify
        );
        fallbackOracleAddressToUse = fallbackOracle.address;
        console.log('===== Deployed Fallback Oracle: %s', fallbackOracle.address);
      }

      if (notFalsyOrZeroAddress(aaveOracleAddress)) {
        aaveOracle = await getAaveOracle(aaveOracleAddress);
        await waitForTx(await aaveOracle.setAssetSources(tokens, aggregators));
      } else {
        aaveOracle = await deployAaveOracle(
          [
            tokens,
            aggregators,
            fallbackOracleAddressToUse,
            await getQuoteCurrency(poolConfig),
            poolConfig.OracleQuoteUnit,
          ],
          verify
        );
        console.log('===== Deployed Aave Oracle: %s', aaveOracle.address);
        await waitForTx(await aaveOracle.setAssetSources(tokens, aggregators));
      }

      if (notFalsyOrZeroAddress(lendingRateOracleAddress)) {
        lendingRateOracle = await getLendingRateOracle(lendingRateOracleAddress);
      } else {
        lendingRateOracle = await deployLendingRateOracle(verify);
        const { USD, ...tokensAddressesWithoutUsd } = tokensToWatch;
        await setInitialMarketRatesInRatesOracleByHelper(
          lendingRateOracles,
          tokensAddressesWithoutUsd,
          lendingRateOracle,
          admin
        );
      }

      console.log('Aave Oracle: %s', aaveOracle.address);
      console.log('Lending Rate Oracle: %s', lendingRateOracle.address);

      // Register the proxy price provider on the addressesProvider
      await waitForTx(await addressesProvider.setPriceOracle(aaveOracle.address));
      await waitForTx(await addressesProvider.setLendingRateOracle(lendingRateOracle.address));
    } catch (error) {
      if (DRE.network.name.includes('tenderly')) {
        const transactionLink = `https://dashboard.tenderly.co/${DRE.config.tenderly.username}/${
          DRE.config.tenderly.project
        }/fork/${DRE.tenderly.network().getFork()}/simulation/${DRE.tenderly.network().getHead()}`;
        console.error('Check tx error:', transactionLink);
      }
      throw error;
    }
  });
