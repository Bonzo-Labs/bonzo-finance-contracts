import { Contract, utils } from 'ethers';
import {
  CHAIN_IDS,
  ChainType,
  OWNERS,
  SAFE_ADDRESSES,
  THRESHOLDS,
  TargetSafe,
} from '../config';
import { getSafe } from './safe';

export interface PreflightInput {
  chain_type: ChainType;
  targetSafe: TargetSafe;
  provider: any;
  ownerKeys: string[];
}

const check = (label: string, ok: boolean, detail = '') => {
  const status = ok ? '✅' : '❌';
  console.log(`${status} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`preflight failed: ${label} ${detail}`);
};

export const runPreflight = async ({
  chain_type,
  targetSafe,
  provider,
  ownerKeys,
}: PreflightInput): Promise<{ safe: Contract; owners: string[]; threshold: number; safeAddr: string }> => {
  console.log(`\n=== preflight: ${targetSafe} Safe on ${chain_type} ===\n`);

  const net = await provider.getNetwork();
  check(
    'chainId matches',
    net.chainId === CHAIN_IDS[chain_type],
    `expected ${CHAIN_IDS[chain_type]}, got ${net.chainId}`
  );

  const safeAddr = SAFE_ADDRESSES[chain_type][targetSafe];
  check(`SAFE_ADDRESSES.${chain_type}.${targetSafe} is set`, !!safeAddr, safeAddr || '<empty>');
  check(`safe address is valid`, utils.isAddress(safeAddr), safeAddr);

  const expectedOwners = OWNERS[chain_type][targetSafe].map((a) => a.toLowerCase());
  check(
    `config OWNERS.${chain_type}.${targetSafe} has entries`,
    expectedOwners.length > 0 && expectedOwners.every(Boolean),
    `got ${expectedOwners.length}`
  );

  const safe = getSafe(safeAddr, provider);
  const onChainOwners: string[] = (await safe.getOwners()).map((a: string) => a.toLowerCase());
  const sameSet =
    onChainOwners.length === expectedOwners.length &&
    [...onChainOwners].sort().join(',') === [...expectedOwners].sort().join(',');
  check(
    `on-chain getOwners() matches config OWNERS as a set`,
    sameSet,
    `on-chain=${onChainOwners.join(',')} cfg=${expectedOwners.join(',')}`
  );

  // No duplicates
  const noDupes = new Set(onChainOwners).size === onChainOwners.length;
  check(`no duplicate owners`, noDupes);

  const expectedThreshold = THRESHOLDS[chain_type][targetSafe];
  const threshold = (await safe.getThreshold()).toNumber();
  check(
    `threshold matches`,
    threshold === expectedThreshold,
    `expected ${expectedThreshold}, got ${threshold}`
  );

  // Owner-key asserts
  const { Wallet } = require('ethers');
  const keyAddrs = ownerKeys.filter(Boolean).map((k) => new Wallet(k).address.toLowerCase());
  check(
    `every supplied owner key resolves to an on-chain owner`,
    keyAddrs.every((a) => onChainOwners.includes(a)),
    `keys=${keyAddrs.join(',')}`
  );
  check(
    `at least threshold owner keys supplied`,
    keyAddrs.length >= threshold,
    `got ${keyAddrs.length}, need ${threshold}`
  );

  return { safe, owners: onChainOwners, threshold, safeAddr };
};
