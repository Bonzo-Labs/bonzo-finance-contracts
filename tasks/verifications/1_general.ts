import { task } from 'hardhat/config';
import {
  loadPoolConfig,
  ConfigNames,
  getTreasuryAddress,
  getWrappedNativeTokenAddress,
} from '../../helpers/configuration';
import { ZERO_ADDRESS } from '../../helpers/constants';
import {
  getAaveOracle,
  getAaveProtocolDataProvider,
  getAddressById,
  getAToken,
  getATokensAndRatesHelper,
  getGenericLogic,
  getLendingPool,
  getLendingPoolAddressesProvider,
  getLendingPoolAddressesProviderRegistry,
  getLendingPoolCollateralManager,
  getLendingPoolCollateralManagerImpl,
  getLendingPoolConfiguratorImpl,
  getLendingPoolConfiguratorProxy,
  getLendingPoolImpl,
  getLendingRateOracle,
  getPriceOracle,
  getProxy,
  getReserveLogic,
  getStableAndVariableTokensHelper,
  getStableDebtToken,
  getValidationLogic,
  getVariableDebtToken,
  getWalletProvider,
  getWETHGateway,
} from '../../helpers/contracts-getters';
import { verifyContract, getParamPerNetwork } from '../../helpers/contracts-helpers';
import { notFalsyOrZeroAddress } from '../../helpers/misc-utils';
import { eContractid, eNetwork, ICommonConfiguration } from '../../helpers/types';
import { ValidationLogic } from '../../types';

task('verify:general', 'Verify contracts at Etherscan')
  .addFlag('all', 'Verify all contracts at Etherscan')
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .setAction(async ({ all, pool }, localDRE) => {
    await localDRE.run('set-DRE');
    const network = localDRE.network.name as eNetwork;
    const poolConfig = loadPoolConfig(pool);
    const {
      ReserveAssets,
      ReservesConfig,
      ProviderRegistry,
      MarketId,
      LendingPoolCollateralManager,
      LendingPoolConfigurator,
      LendingPool,
      WethGateway,
    } = poolConfig as ICommonConfiguration;
    const treasuryAddress = await getTreasuryAddress(poolConfig);

    const registryAddress = getParamPerNetwork(ProviderRegistry, network);
    const addressesProvider = await getLendingPoolAddressesProvider();
    const addressesProviderRegistry = notFalsyOrZeroAddress(registryAddress)
      ? await getLendingPoolAddressesProviderRegistry(registryAddress)
      : await getLendingPoolAddressesProviderRegistry();
    const lendingPoolAddress = await addressesProvider.getLendingPool();
    const lendingPoolConfiguratorAddress = await addressesProvider.getLendingPoolConfigurator(); //getLendingPoolConfiguratorProxy();
    const lendingPoolCollateralManagerAddress =
      await addressesProvider.getLendingPoolCollateralManager();

    const lendingPoolProxy = await getProxy(lendingPoolAddress);
    const lendingPoolConfiguratorProxy = await getProxy(lendingPoolConfiguratorAddress);
    const lendingPoolCollateralManagerProxy = await getProxy(lendingPoolCollateralManagerAddress);

    const lendingRateOracleAddress = getParamPerNetwork(poolConfig.LendingRateOracle, network);
    const lendingRateOracle = notFalsyOrZeroAddress(lendingRateOracleAddress)
      ? await getLendingRateOracle(lendingRateOracleAddress)
      : await getLendingRateOracle();

    const aveOracleAddress = getParamPerNetwork(poolConfig.AaveOracle, network);
    const aveOracle = notFalsyOrZeroAddress(aveOracleAddress)
      ? await getAaveOracle(aveOracleAddress)
      : await getAaveOracle();

    const reserveLogic = await getReserveLogic();
    const genericLogic = await getGenericLogic();
    const validationLogic = await getValidationLogic();
    const stableAndVariableTokensHelper = await getStableAndVariableTokensHelper();
    const aTokensAndRatesHelper = await getATokensAndRatesHelper();
    const aToken = await getAToken();
    const stableDebtToken = await getStableDebtToken();
    const variableDebtToken = await getVariableDebtToken();
    const priceOracle = await getPriceOracle();

    if (all) {
      const lendingPoolImplAddress = getParamPerNetwork(LendingPool, network);
      const lendingPoolImpl = notFalsyOrZeroAddress(lendingPoolImplAddress)
        ? await getLendingPoolImpl(lendingPoolImplAddress)
        : await getLendingPoolImpl();

      const lendingPoolConfiguratorImplAddress = getParamPerNetwork(
        LendingPoolConfigurator,
        network
      );
      const lendingPoolConfiguratorImpl = notFalsyOrZeroAddress(lendingPoolConfiguratorImplAddress)
        ? await getLendingPoolConfiguratorImpl(lendingPoolConfiguratorImplAddress)
        : await getLendingPoolConfiguratorImpl();

      const lendingPoolCollateralManagerImplAddress = getParamPerNetwork(
        LendingPoolCollateralManager,
        network
      );
      const lendingPoolCollateralManagerImpl = notFalsyOrZeroAddress(
        lendingPoolCollateralManagerImplAddress
      )
        ? await getLendingPoolCollateralManagerImpl(lendingPoolCollateralManagerImplAddress)
        : await getLendingPoolCollateralManagerImpl();

      const dataProvider = await getAaveProtocolDataProvider();
      const walletProvider = await getWalletProvider();

      const wethGatewayAddress = getParamPerNetwork(WethGateway, network);
      const wethGateway = notFalsyOrZeroAddress(wethGatewayAddress)
        ? await getWETHGateway(wethGatewayAddress)
        : await getWETHGateway();

      // Address Provider
      console.log('\n- Verifying address provider...\n');
      await verifyContract(eContractid.LendingPoolAddressesProvider, addressesProvider, [MarketId]);

      // Address Provider Registry
      console.log('\n- Verifying address provider registry...\n');
      await verifyContract(
        eContractid.LendingPoolAddressesProviderRegistry,
        addressesProviderRegistry,
        []
      );

      // Lending Pool implementation
      console.log('\n- Verifying LendingPool Implementation...\n');
      await verifyContract(eContractid.LendingPool, lendingPoolImpl, []);

      // Lending Pool Configurator implementation
      console.log('\n- Verifying LendingPool Configurator Implementation...\n');
      await verifyContract(eContractid.LendingPoolConfigurator, lendingPoolConfiguratorImpl, []);

      // Lending Pool Collateral Manager implementation
      console.log('\n- Verifying LendingPool Collateral Manager Implementation...\n');
      await verifyContract(
        eContractid.LendingPoolCollateralManager,
        lendingPoolCollateralManagerImpl,
        []
      );

      // Test helpers
      console.log('\n- Verifying  Aave  Provider Helpers...\n');
      await verifyContract(eContractid.AaveProtocolDataProvider, dataProvider, [
        addressesProvider.address,
      ]);

      // Wallet balance provider
      console.log('\n- Verifying  Wallet Balance Provider...\n');
      await verifyContract(eContractid.WalletBalanceProvider, walletProvider, []);

      // WETHGateway
      console.log('\n- Verifying  WETHGateway...\n');
      await verifyContract(eContractid.WETHGateway, wethGateway, [
        await getWrappedNativeTokenAddress(poolConfig),
      ]);

      console.log('\n- Verifying  Reserve Logic...\n');
      await verifyContract(eContractid.ReserveLogic, reserveLogic, []);

      console.log('\n- Verifying  Generic Logic...\n');
      await verifyContract(eContractid.GenericLogic, genericLogic, []);

      console.log('\n- Verifying  Validation Logic...\n');
      await verifyContract(eContractid.ValidationLogic, validationLogic, []);

      console.log('\n- Verifying  Stable and Variable Tokens Helper...\n');
      await verifyContract(
        eContractid.StableAndVariableTokensHelper,
        stableAndVariableTokensHelper,
        []
      );

      console.log('\n- Verifying  A Token and Rates Helper...\n');
      await verifyContract(eContractid.ATokensAndRatesHelper, aTokensAndRatesHelper, []);

      console.log('\n- Verifying  A Token...\n');
      await verifyContract(eContractid.AToken, aToken, []);

      console.log('\n- Verifying  Stable Debt Token...\n');
      await verifyContract(eContractid.StableDebtToken, stableDebtToken, []);

      console.log('\n- Verifying  Variable Debt Token...\n');
      await verifyContract(eContractid.VariableDebtToken, variableDebtToken, []);

      console.log('\n- Verifying  Price Oracle...\n');
      await verifyContract(eContractid.PriceOracle, priceOracle, []);

      console.log('\n- Verifying  Ave Oracle...\n');
      await verifyContract(eContractid.AaveOracle, aveOracle, []);

      console.log('\n- Verifying  Lending Rate Oracle...\n');
      await verifyContract(eContractid.LendingRateOracle, lendingRateOracle, []);
    }
    // Lending Pool proxy
    console.log('\n- Verifying  Lending Pool Proxy...\n');
    await verifyContract(eContractid.InitializableAdminUpgradeabilityProxy, lendingPoolProxy, [
      addressesProvider.address,
    ]);

    // LendingPool Conf proxy
    console.log('\n- Verifying  Lending Pool Configurator Proxy...\n');
    await verifyContract(
      eContractid.InitializableAdminUpgradeabilityProxy,
      lendingPoolConfiguratorProxy,
      [addressesProvider.address]
    );

    // Proxy collateral manager
    console.log('\n- Verifying  Lending Pool Collateral Manager Proxy...\n');
    await verifyContract(
      eContractid.InitializableAdminUpgradeabilityProxy,
      lendingPoolCollateralManagerProxy,
      []
    );

    console.log('Finished verifications.');
  });
