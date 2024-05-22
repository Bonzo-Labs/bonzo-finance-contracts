import { IHederaConfiguration, eHederaNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import {
  strategyKARATE,
  strategyXSAUCE,
  strategyUSDC,
  strategyHBARX,
  strategySAUCE,
  strategyCLXY,
} from './reservesConfigs';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const HederaConfig: IHederaConfiguration = {
  ...CommonsConfig,
  MarketId: 'Hedera Market',
  ProviderId: 5, //TODO - update this
  ReservesConfig: {
    XSAUCE: strategyXSAUCE,
    USDC: strategyUSDC,
    KARATE: strategyKARATE,
    HBARX: strategyHBARX,
    SAUCE: strategySAUCE,
    CLXY: strategyCLXY,
  },
  ReserveAssets: {
    [eHederaNetwork.hedera_testnet]: {
      USDC: '0x0000000000000000000000000000000000001549',
      HBARX: '0x0000000000000000000000000000000000220ced',
      SAUCE: '0x0000000000000000000000000000000000120f46',
      XSAUCE: '0x000000000000000000000000000000000015a59b',
      KARATE: '0x00000000000000000000000000000000003991ed',
      CLXY: '0x00000000000000000000000000000000000014f5',
    },
    [eHederaNetwork.mainnet]: {
      USDC: '',
      HBARX: '',
      SAUCE: '',
      XSAUCE: '',
      KARATE: '',
      CLXY: '',
    },
  },
};

export default HederaConfig;
