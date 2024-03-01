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
  ATokenNamePrefix: 'Hedera testnet Market',
  StableDebtTokenNamePrefix: 'Hedera testnet Market stable debt',
  VariableDebtTokenNamePrefix: 'Hedera testnet Market variable debt',
  SymbolPrefix: 'm',
  ProviderId: 0, // Overriden in index.ts
  OracleQuoteCurrency: 'HBAR',
  OracleQuoteUnit: oneEther.toString(),
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
  // TODO: reorg alphabetically, checking the reason of tests failing
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
    Wmainnet: {
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
    [eHederaNetwork.testnet]: undefined,
    [eHederaNetwork.mainnet]: undefined,
  },
  PoolAdminIndex: 0,
  EmergencyAdminIndex: 0,
  EmergencyAdmin: {
    [eHederaNetwork.testnet]: undefined,
    [eHederaNetwork.mainnet]: undefined,
  },
  LendingPool: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  LendingPoolConfigurator: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  ProviderRegistry: {
    [eHederaNetwork.testnet]: '0xE6ef11C967898F9525D550014FDEdCFAB63536B5',
    [eHederaNetwork.mainnet]: '0x3ac4e9aa29940770aeC38fe853a4bbabb2dA9C19',
  },
  ProviderRegistryOwner: {
    [eHederaNetwork.testnet]: '0x943E44157dC0302a5CEb172374d1749018a00994',
    [eHederaNetwork.mainnet]: '0xD7D86236d6c463521920fCC50A9CB56f8C8Bf008',
  },
  LendingRateOracle: {
    [eHederaNetwork.testnet]: '0xC661e1445F9a8E5FD3C3dbCa0A0A2e8CBc79725D',
    [eHederaNetwork.mainnet]: '0x17F73aEaD876CC4059089ff815EDA37052960dFB',
  },
  LendingPoolCollateralManager: {
    [eHederaNetwork.testnet]: '0x2A7004B21c49253ca8DF923406Fed9a02AA86Ba0',
    [eHederaNetwork.mainnet]: '0xA39599424642D9fD35e475EF802EddF798dc555B',
  },
  TokenDistributor: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  WethGateway: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  AaveOracle: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  FallbackOracle: {
    [eHederaNetwork.testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  ChainlinkAggregator: {
    [eHederaNetwork.testnet]: {
      DAI: '0x0000000000000000000000000000000000001599',
      USDC: '0x0000000000000000000000000000000000001549',
      CLXY: '0x00000000000000000000000000000000000014f5',
      HBARX: '0x0000000000000000000000000000000000220ced',
      SAUCE: '0x0000000000000000000000000000000000120f46',
    },
    [eHederaNetwork.mainnet]: {
      DAI: ZERO_ADDRESS,
      USDC: ZERO_ADDRESS,
      USDT: ZERO_ADDRESS,
      WBTC: ZERO_ADDRESS,
      Wmainnet: ZERO_ADDRESS,
      USD: ZERO_ADDRESS,
    },
  },
  ReserveAssets: {
    [eHederaNetwork.mainnet]: {},
    [eHederaNetwork.testnet]: {},
  },
  ReservesConfig: {},
  ATokenDomainSeparator: {
    [eHederaNetwork.testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  WETH: {
    [eHederaNetwork.testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  },
  WrappedNativeToken: {
    [eHederaNetwork.testnet]: '0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889',
    [eHederaNetwork.mainnet]: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  },
  ReserveFactorTreasuryAddress: {
    [eHederaNetwork.testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: '0x7734280A4337F37Fbf4651073Db7c28C80B339e9',
  },
  IncentivesController: {
    [eHederaNetwork.testnet]: '0xd41aE58e803Edf4304334acCE4DC4Ec34a63C644',
    [eHederaNetwork.mainnet]: '0x357D51124f59836DeD84c8a1730D72B749d8BC23',
  },
};
