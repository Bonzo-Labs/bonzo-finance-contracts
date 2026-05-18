/**
 * Palmera Safe multisig runtime config.
 *
 * CHAIN_TYPE selects the RPC + wallet; --network must match for artifact
 * consistency (asserted at startup). Pattern mirrors scripts/supra-deploy.ts
 * and scripts/whbarGatewayDeploy.ts.
 *
 * Every non-secret multisig value lives in this file as a top-level const so
 * diffs are reviewable. Env reads used by the multisig scripts:
 *   - PRIVATE_KEY / PRIVATE_KEY_MAINNET — gas-paying wallet (existing convention)
 *   - PROVIDER_URL_MAINNET — mainnet RPC (existing convention)
 *   - EXECUTOR_OWNER_KEY_{1..5} / _MAINNET_{1..5} — Safe owner signing keys
 *   - GUARDIAN_OWNER_KEY_{1..3} / _MAINNET_{1..3} — Safe owner signing keys
 *
 * This file reads ZERO private keys directly. Owner keys are resolved inside
 * smoke/transferHbar.ts and execDaoEncoded.ts from the env vars above.
 */
import { ethers } from 'ethers';
import * as hre from 'hardhat';

export type ChainType = 'hedera_testnet' | 'hedera_mainnet';
export type TargetSafe = 'executor' | 'guardian';

export const CHAIN_IDS: Record<ChainType, number> = {
  hedera_testnet: 296,
  hedera_mainnet: 295,
};

export const RPC_URLS: Record<ChainType, string> = {
  hedera_testnet: 'https://testnet.hashio.io/api',
  hedera_mainnet: process.env.PROVIDER_URL_MAINNET || '',
};

// Palmera-deployed Gnosis Safe v1.4.1 addresses. Fill after Safe creation via
// multisig.hedera.foundation and commit.
export const SAFE_ADDRESSES: Record<ChainType, { executor: string; guardian: string }> = {
  hedera_testnet: {
    executor: '',
    guardian: '0xC2ab87Ce7F173F883eb29aA57bb26ea1f897f20f',
  },
  hedera_mainnet: {
    executor: '',
    guardian: '0x9f90b8adF1bF47dc530b7d89013019438b61cfeC',
  },
};

// Owner address lists. Must match the owners the Safe was deployed with.
export const OWNERS: Record<ChainType, { executor: string[]; guardian: string[] }> = {
  hedera_testnet: {
    executor: ['', '', '', '', ''],
    guardian: [
      '0x1e17a29d259ff4f78f02e97c7deccc7ec3aea103',
      '0xbe058ee0884696653e01cfc6f34678f2762d84db',
      '0x5c865c43b1a92155dc2d3f50cfec0fa039ab15ae',
    ],
  },
  hedera_mainnet: {
    executor: ['', '', '', '', ''],
    guardian: [
      '0x742d07aaf0f4ce15e473918742efeb0620cd6327', //beefy-test
      '0xaba50e992ab2df8f197aac4d3ec284f55b43af9c', // bonzo-liquidations
      '0x3fa13da7ca7b83f156fd51cd6f0781e77a53dc06', // GT
    ],
  },
};

// Per-chain thresholds so testnet Safes can run at a lower threshold (e.g.
// 1-of-3) than mainnet without forking the script. Must match the threshold
// the Safe was actually deployed with on that network — preflight asserts.
export const THRESHOLDS: Record<ChainType, Record<TargetSafe, number>> = {
  hedera_testnet: {
    executor: 3,
    guardian: 2,
  },
  hedera_mainnet: {
    executor: 3,
    guardian: 2,
  },
};

// HBAR-transfer smoke target. The Safe sends `amountTinybar` HBAR to `receiver`.
//
// IMPORTANT — Hedera unit quirk. Inside the EVM, `msg.value` and the `value`
// arg of the CALL opcode are denominated in TINYBAR (1 HBAR = 1e8), NOT in
// 18-decimal wei. Only the JSON-RPC surface (eth_getBalance, eth_call value)
// is auto-scaled to weibar (tinybar × 1e10) for tooling compatibility.
//
// Because Safe's execTransaction forwards `value` straight to `to.call{value}`,
// the value we pass must already be tinybar-scaled. If you pass parseEther(x)
// here you'll ask the Safe to forward ~1e10x more HBAR than you meant, the
// inner CALL will fail on insufficient balance, and you'll see GS013.
//
// Rule of thumb on Hedera EVM:
//   - `provider.getBalance(addr)` → weibar (18-dec); format with formatEther
//   - Solidity `value` args / msg.value → tinybar (8-dec); format with formatUnits(x, 8)
export const SMOKE_TRANSFER: Record<ChainType, { receiver: string; amountTinybar: string }> = {
  hedera_testnet: {
    receiver: '0xbe058ee0884696653e01cfc6f34678f2762d84db',
    amountTinybar: ethers.utils.parseUnits('0.01', 8).toString(), // 0.01 HBAR on testnet
  },
  hedera_mainnet: {
    receiver: '0x742D07aAf0f4CE15e473918742EFEb0620cd6327',
    amountTinybar: ethers.utils.parseUnits('1', 8).toString(), // 1 HBAR on mainnet (tinybar)
  },
};

export const resolveChainType = (): ChainType => {
  const raw = process.env.CHAIN_TYPE || 'hedera_testnet';
  if (raw !== 'hedera_testnet' && raw !== 'hedera_mainnet') {
    throw new Error(
      `Unsupported CHAIN_TYPE: ${raw}. Must be 'hedera_testnet' or 'hedera_mainnet'.`
    );
  }
  return raw;
};

export const resolveTargetSafe = (): TargetSafe => {
  const raw = process.env.TARGET_SAFE;
  if (raw !== 'executor' && raw !== 'guardian') {
    throw new Error(`TARGET_SAFE must be 'executor' or 'guardian' (got ${raw || '<unset>'}).`);
  }
  return raw;
};

export const assertNetworkConsistent = (chain_type: ChainType): void => {
  const name = (hre as any).network?.name;
  if (!name || name === 'hardhat') return;
  if (name !== chain_type) {
    throw new Error(
      `hre.network.name (${name}) does not match CHAIN_TYPE (${chain_type}). ` +
        `Re-run with --network ${chain_type}.`
    );
  }
};

export const assertNoFork = (): void => {
  const name = (hre as any).network?.name;
  if (name && name !== 'hedera_testnet' && name !== 'hedera_mainnet' && name !== 'hardhat') {
    throw new Error(
      `Refusing to run multisig script on network '${name}'. ` +
        `Only hedera_testnet or hedera_mainnet are allowed. Forks are forbidden.`
    );
  }
};

export const getProvider = (chain_type: ChainType): ethers.providers.JsonRpcProvider => {
  const url = RPC_URLS[chain_type];
  if (!url) {
    throw new Error(
      `Missing RPC URL for ${chain_type}. ${
        chain_type === 'hedera_mainnet' ? 'Set PROVIDER_URL_MAINNET in env.' : ''
      }`
    );
  }
  return new ethers.providers.JsonRpcProvider(url, {
    name: chain_type,
    chainId: CHAIN_IDS[chain_type],
  });
};

export const getExecutorWallet = (
  chain_type: ChainType,
  provider: ethers.providers.JsonRpcProvider
): ethers.Wallet => {
  // Used to pay gas for the final execTransaction call — does NOT need to be a Safe owner.
  const pk =
    chain_type === 'hedera_testnet'
      ? process.env.PRIVATE_KEY || process.env.PRIVATE_KEY2 || ''
      : process.env.PRIVATE_KEY_MAINNET || process.env.PRIVATE_KEY || '';
  if (!pk) {
    throw new Error(
      `Missing gas-paying private key for ${chain_type}. Set ${
        chain_type === 'hedera_testnet' ? 'PRIVATE_KEY' : 'PRIVATE_KEY_MAINNET'
      }.`
    );
  }
  return new ethers.Wallet(pk, provider);
};
