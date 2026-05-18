/**
 * DAO execution-layer runtime config (protocol addresses from `outputReserveData.json`
 * plus MultiSend addresses for multi-action bundles).
 *
 * **Executor / Guardian Safe EVM addresses** are the single object
 * `SAFE_ADDRESSES` in `scripts/multisig/config.ts` and are re-exported from here
 * so `getAddresses()` / `getRuntime()` can stay one import for encode / simulate /
 * submit. Owner lists, thresholds, and multisig smoke settings live only under
 * `scripts/multisig/`.
 *
 * CHAIN_TYPE is authoritative; --network must match for operator sanity and
 * artifact/runtime consistency (see `assertNetworkConsistent`).
 */
import { ethers } from 'ethers';
import * as hre from 'hardhat';
import reserveData from '../outputReserveData.json';
import type { ChainAddresses, ChainType, NetworkRuntime } from './types';
import { SAFE_ADDRESSES } from '../multisig/config';

export { SAFE_ADDRESSES };

export const CHAIN_IDS: Record<ChainType, number> = {
  hedera_testnet: 296,
  hedera_mainnet: 295,
};

export const RPC_URLS: Record<ChainType, string> = {
  hedera_testnet: 'https://testnet.hashio.io/api',
  hedera_mainnet: process.env.PROVIDER_URL_MAINNET || '',
};

// MultiSendCallOnly (pre-deployed by Safe/Palmera on Hedera).
// Operator fills after §0.2.3 resolves. (Multisig-only settings stay in scripts/multisig/config.ts.)
export const MULTI_SEND_ADDRESSES: Record<ChainType, string> = {
  hedera_testnet: '',
  hedera_mainnet: '',
};

const getReserveAddress = (contractKey: string, chain_type: ChainType): string => {
  const entry = (reserveData as any)[contractKey];
  if (!entry || !entry[chain_type] || !entry[chain_type].address) {
    throw new Error(
      `Missing ${contractKey}.${chain_type}.address in scripts/outputReserveData.json`
    );
  }
  return entry[chain_type].address;
};

export const getAddresses = (chain_type: ChainType): ChainAddresses => ({
  lendingPool: getReserveAddress('LendingPool', chain_type),
  lendingPoolConfigurator: getReserveAddress('LendingPoolConfigurator', chain_type),
  lendingPoolAddressesProvider: getReserveAddress('LendingPoolAddressesProvider', chain_type),
  aaveProtocolDataProvider: getReserveAddress('AaveProtocolDataProvider', chain_type),
  aaveOracle: getReserveAddress('AaveOracle', chain_type),
  lendingRateOracle: getReserveAddress('LendingRateOracle', chain_type),
  lendingPoolCollateralManager: getReserveAddress('LendingPoolCollateralManager', chain_type),
  executorSafe: SAFE_ADDRESSES[chain_type].executor,
  guardianSafe: SAFE_ADDRESSES[chain_type].guardian,
  multiSendCallOnly: MULTI_SEND_ADDRESSES[chain_type],
});

export const resolveChainType = (): ChainType => {
  const raw = process.env.CHAIN_TYPE || 'hedera_testnet';
  if (raw !== 'hedera_testnet' && raw !== 'hedera_mainnet') {
    throw new Error(
      `Unsupported CHAIN_TYPE: ${raw}. Must be 'hedera_testnet' or 'hedera_mainnet'.`
    );
  }
  return raw;
};

export const assertNetworkConsistent = (chain_type: ChainType): void => {
  const name = (hre as any).network?.name;
  // Allow default 'hardhat' only when explicitly opted in (e.g. unit tests use mock providers)
  if (!name || name === 'hardhat') return;
  if (name !== chain_type) {
    throw new Error(
      `hre.network.name (${name}) does not match CHAIN_TYPE (${chain_type}). ` +
        `Re-run with --network ${chain_type}.`
    );
  }
};

export const getRuntime = (): NetworkRuntime => {
  const chain_type = resolveChainType();
  assertNetworkConsistent(chain_type);
  const url = RPC_URLS[chain_type];
  if (!url) {
    throw new Error(
      `Missing RPC URL for ${chain_type}. Set PROVIDER_URL_MAINNET for mainnet.`
    );
  }
  const provider = new ethers.providers.JsonRpcProvider(url, {
    name: chain_type,
    chainId: CHAIN_IDS[chain_type],
  });
  const pk =
    chain_type === 'hedera_testnet'
      ? process.env.PRIVATE_KEY || process.env.PRIVATE_KEY2 || ''
      : process.env.PRIVATE_KEY_MAINNET || '';
  if (!pk) {
    throw new Error(
      `Missing private key for ${chain_type}. Set ${
        chain_type === 'hedera_testnet' ? 'PRIVATE_KEY' : 'PRIVATE_KEY_MAINNET'
      } in env.`
    );
  }
  const owner = new ethers.Wallet(pk, provider);
  const addresses = getAddresses(chain_type);
  return { chain_type, provider, owner, addresses };
};

/**
 * Assert no Hardhat fork / impersonation / forbidden RPC method is in play.
 * Called at the top of every live-RPC script. Unit tests (hre.network.name === 'hardhat')
 * are exempt but must only use mock providers.
 */
export const assertNoFork = (): void => {
  const name = (hre as any).network?.name;
  if (name && name !== 'hedera_testnet' && name !== 'hedera_mainnet' && name !== 'hardhat') {
    throw new Error(
      `Refusing to run DAO script on network '${name}'. ` +
        `Only hedera_testnet or hedera_mainnet are allowed. Forks are forbidden.`
    );
  }
};
