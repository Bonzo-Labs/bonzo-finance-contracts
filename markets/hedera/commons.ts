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
  VariableDebtTokenNamePrefix: 'Bonzo Variable Debt ',
  SymbolPrefix: 'm',
  ProviderId: 0, // Overriden in index.ts
  OracleQuoteCurrency: 'HBAR',
  // OracleQuoteUnit: '1000000000000000000',  //JSON-RPC relay msg.value returns 18 decimals and also gasPrice returns 18 decimals
  OracleQuoteUnit: '100000000',
  SupraPriceFeed: '0x6Cd59830AAD978446e6cc7f6cc173aF7656Fb917',
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
    [eHederaNetwork.hedera_testnet]: undefined,
    [eHederaNetwork.mainnet]: undefined,
  },
  PoolAdminIndex: 0,
  EmergencyAdminIndex: 0,
  EmergencyAdmin: {
    [eHederaNetwork.hedera_testnet]: undefined,
    [eHederaNetwork.mainnet]: undefined,
  },
  LendingPool: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  LendingPoolConfigurator: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  ProviderRegistry: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  ProviderRegistryOwner: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  LendingRateOracle: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  LendingPoolCollateralManager: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  TokenDistributor: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  WethGateway: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  AaveOracle: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  FallbackOracle: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  ChainlinkAggregator: {
    [eHederaNetwork.hedera_testnet]: {
      DAI: ZERO_ADDRESS,
      USDC: ZERO_ADDRESS,
      USDT: ZERO_ADDRESS,
      WBTC: ZERO_ADDRESS,
      USD: ZERO_ADDRESS,
    },
    [eHederaNetwork.mainnet]: {
      DAI: ZERO_ADDRESS,
      USDC: ZERO_ADDRESS,
      USDT: ZERO_ADDRESS,
      WBTC: ZERO_ADDRESS,
      USD: ZERO_ADDRESS,
    },
  },
  ReserveAssets: {
    [eHederaNetwork.mainnet]: {},
    [eHederaNetwork.hedera_testnet]: {},
  },
  ReservesConfig: {},
  ATokenDomainSeparator: {
    [eHederaNetwork.hedera_testnet]: '',
    [eHederaNetwork.mainnet]: '',
  },
  WETH: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  WrappedNativeToken: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  ReserveFactorTreasuryAddress: {
    [eHederaNetwork.hedera_testnet]: '0x1e17A29D259fF4f78f02e97c7DECCc7EC3aea103', // TODO - add the deployer address here
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
  IncentivesController: {
    [eHederaNetwork.hedera_testnet]: ZERO_ADDRESS,
    [eHederaNetwork.mainnet]: ZERO_ADDRESS,
  },
};
