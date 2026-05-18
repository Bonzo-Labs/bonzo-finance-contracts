import BigNumber from 'bignumber.js';
import {
  oneEther,
  oneRay,
  RAY,
  ZERO_ADDRESS,
  MOCK_CHAINLINK_AGGREGATORS_PRICES,
} from '../../helpers/constants';
import { ICommonConfiguration, eHederaNetwork } from '../../helpers/types';

// ----------------
// PROTOCOL GLOBAL PARAMS
// ----------------

export const CommonsConfig: ICommonConfiguration = {
  MarketId: 'Commons',
  ATokenNamePrefix: 'Bonzo aToken',
  StableDebtTokenNamePrefix: 'Bonzo Stable Debt ',
  VariableDebtTokenNamePrefix: 'Bonzo variableDebt ',
  SymbolPrefix: 'm',
  ProviderId: 0, // Overriden in index.ts
  OracleQuoteCurrency: 'HBAR',
  // OracleQuoteUnit: '1000000000000000000',  //JSON-RPC relay msg.value returns 18 decimals and also gasPrice returns 18 decimals
  OracleQuoteUnit: '100000000',
  SupraPriceFeed: '0x9F1981afD19e2881A4Acb39aa144c7fBc4a6D8b3', // Mainnet
  // SupraPriceFeed: '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917', // Testnet
  SupraOracleFeeds: {
    [eHederaNetwork.hedera_testnet]: {
      SupraPriceFeed: '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917',
      HbarUsdChainlinkFeed: '0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a',
      UsdcUsdChainlinkFeed: '0xb632a7e7e02d76c0Ce99d9C62c7a2d1B5F92B6B5',
      EthUsdChainlinkFeed: ZERO_ADDRESS,
    },
    [eHederaNetwork.hedera_mainnet]: {
      SupraPriceFeed: '0xD02cc7a670047b6b012556A88e275c685d25e0c9',
      HbarUsdChainlinkFeed: '0xAF685FB45C12b92b5054ccb9313e135525F9b5d5',
      UsdcUsdChainlinkFeed: '0x2b358642c7C37b6e400911e4FE41770424a7349F',
      EthUsdChainlinkFeed: '0xd2D2CB0AEb29472C3008E291355757AD6225019e',
    },
  },
  ProtocolGlobalParams: {
    TokenDistributorPercentageBase: '10000',
    MockUsdPriceInWei: '5848466240000000',
    UsdAddress: '0x10F7Fc1F91Ba351f9C629c5947AD69bD03C05b96',
    NilAddress: '0x0000000000000000000000000000000000000000',
    OneAddress: '0x0000000000000000000000000000000000000001',
    AaveReferral: '0',
  },

  // ----------------
  // COMMON PROTOCOL PARAMS ACROSS POOLS AND NETWORKS
  // ----------------

  Mocks: {
    AllAssetsInitialPrices: {
      ...MOCK_CHAINLINK_AGGREGATORS_PRICES,
    },
  },

  LendingRateOracleRatesCommon: {
    WETH: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
    DAI: {
      borrowRate: oneRay.multipliedBy(0.039).toFixed(),
    },
    USDC: {
      borrowRate: oneRay.multipliedBy(0.039).toFixed(),
    },
    USDT: {
      borrowRate: oneRay.multipliedBy(0.035).toFixed(),
    },
    WBTC: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
    Whedera_mainnet: {
      borrowRate: oneRay.multipliedBy(0.05).toFixed(),
    },
    AAVE: {
      borrowRate: oneRay.multipliedBy(0.03).toFixed(),
    },
  },
  // ----------------
  // COMMON PROTOCOL ADDRESSES ACROSS POOLS
  // ----------------

  // If PoolAdmin/emergencyAdmin is set, will take priority over PoolAdminIndex/emergencyAdminIndex
  PoolAdmin: {
    [eHederaNetwork.hedera_testnet]: undefined,
    [eHederaNetwork.hedera_mainnet]: undefined,
  },
  PoolAdminIndex: 0,
  EmergencyAdminIndex: 0,
  EmergencyAdmin: {
    [eHederaNetwork.hedera_testnet]: undefined,
    [eHederaNetwork.hedera_mainnet]: undefined,
  },
  LendingPool: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  LendingPoolConfigurator: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  ProviderRegistry: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  ProviderRegistryOwner: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  LendingRateOracle: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  LendingPoolCollateralManager: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  TokenDistributor: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  WethGateway: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  WhbarHelper: {
    [eHederaNetwork.hedera_testnet]: '0x000000000000000000000000000000000050a8a7',
    [eHederaNetwork.hedera_mainnet]: '0x000000000000000000000000000000000058a2ba',
  },
  AaveOracle: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  FallbackOracle: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  ChainlinkAggregator: {
    [eHederaNetwork.hedera_testnet]: {
      DAI: ZERO_ADDRESS,
      USDC: ZERO_ADDRESS,
      USDT: ZERO_ADDRESS,
      WBTC: ZERO_ADDRESS,
      USD: ZERO_ADDRESS,
    },
    [eHederaNetwork.hedera_mainnet]: {
      DAI: ZERO_ADDRESS,
      USDC: ZERO_ADDRESS,
      USDT: ZERO_ADDRESS,
      WBTC: ZERO_ADDRESS,
      USD: ZERO_ADDRESS,
    },
  },
  ReserveAssets: {
    [eHederaNetwork.hedera_mainnet]: {},
    [eHederaNetwork.hedera_testnet]: {},
  },
  ReservesConfig: {},
  ATokenDomainSeparator: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.hedera_mainnet]: '',
  },
  WETH: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  WrappedNativeToken: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.hedera_mainnet]: ZERO_ADDRESS,
  },
  ReserveFactorTreasuryAddress: {
    [eHederaNetwork.hedera_testnet]: '0x5c865c43b1a92155dc2d3f50cfec0fa039ab15ae',
    [eHederaNetwork.hedera_mainnet]: '0x00000000000000000000000000000000005dc4d4',
  },
  IncentivesController: {
    [eHederaNetwork.hedera_testnet]: '0x40f1f4247972952ab1D276Cf552070d2E9880DA6',
    [eHederaNetwork.hedera_mainnet]: '0x0f3950d2fCbf62a2D79880E4fc251E4CB6625FBC',
  },
};
