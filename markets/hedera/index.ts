import { IHederaConfiguration, eHederaNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import {
  strategyDAI,
  strategyUSDC,
  strategyCLXY,
  strategyHBARX,
  strategySAUCE,
} from './reservesConfigs';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const HederaConfig: IHederaConfiguration = {
  ...CommonsConfig,
  MarketId: 'Hedera Market',
  ProviderId: 5, //TODO - update this
  ReservesConfig: {
    DAI: strategyDAI,
    USDC: strategyUSDC,
    CLXY: strategyCLXY,
    HBARX: strategyHBARX,
    SAUCE: strategySAUCE,
  },
  ReserveAssets: {
    [eHederaNetwork.hedera_testnet]: {
      DAI: '0x0000000000000000000000000000000000001599',
      USDC: '0x0000000000000000000000000000000000001549',
      CLXY: '0x00000000000000000000000000000000000014f5',
      HBARX: '0x0000000000000000000000000000000000220ced',
      SAUCE: '0x0000000000000000000000000000000000120f46',
    },
    [eHederaNetwork.mainnet]: {
      // Mock tokens with a simple "mint" external function, except wmatic
      DAI: '',
      USDC: '',
      CLXY: '',
      HBARX: '',
      SAUCE: '',
    },
  },
};

export default HederaConfig;
