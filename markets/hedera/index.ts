import { IHederaConfiguration, eHederaNetwork } from '../../helpers/types';

import { CommonsConfig } from './commons';
import {
  strategyKARATE,
  strategyXSAUCE,
  strategyUSDC,
  strategyHBARX,
  strategySAUCE,
  strategyDOVU,
  strategyHST,
  // strategyPACK,
  // strategySTEAM,
  strategyWHBAR,
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
    WHBAR: strategyWHBAR,
    DOVU: strategyDOVU,
    HST: strategyHST,
    // PACK: strategyPACK,
    // STEAM: strategySTEAM,
  },
  ReserveAssets: {
    [eHederaNetwork.hedera_testnet]: {
      USDC: '0x0000000000000000000000000000000000001549',
      HBARX: '0x0000000000000000000000000000000000220ced',
      SAUCE: '0x0000000000000000000000000000000000120f46',
      XSAUCE: '0x000000000000000000000000000000000015a59b',
      KARATE: '0x00000000000000000000000000000000003991ed',
      WHBAR: '0x0000000000000000000000000000000000003ad2',
      DOVU: '0x000000000000000000000000000000000015a59b',
      HST: '0x000000000000000000000000000000000015a59b',
      // PACK: '0x000000000000000000000000000000000015a59b',
      // STEAM: '0x0000000000000000000000000000000000220ced',
    },
    [eHederaNetwork.hedera_mainnet]: {
      USDC: '0x000000000000000000000000000000000006f89a',
      HBARX: '0x00000000000000000000000000000000000cba44',
      SAUCE: '0x00000000000000000000000000000000000b2ad5',
      XSAUCE: '0x00000000000000000000000000000000001647e8',
      KARATE: '0x000000000000000000000000000000000022d6de',
      WHBAR: '0x0000000000000000000000000000000000163b5a',
      DOVU: '0x000000000000000000000000000000000038b3db',
      HST: '0x00000000000000000000000000000000000ec585',
      // PACK: '0x0000000000000000000000000000000000492a28',
      // STEAM: '0x000000000000000000000000000000000030fb8b',
    },
  },
};

export default HederaConfig;
