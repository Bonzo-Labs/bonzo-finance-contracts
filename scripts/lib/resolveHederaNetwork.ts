/**
 * Shared Hedera network selection (matches scripts/supra-prices.ts).
 *
 * - With `hardhat run --network hedera_mainnet`, use Hardhat's network name.
 * - On in-process `hardhat` (e.g. some tests), fall back to CHAIN_TYPE env.
 */
export type HederaNetwork = 'hedera_testnet' | 'hedera_mainnet';

export const HEDERA_CHAIN_IDS: Record<HederaNetwork, number> = {
  hedera_testnet: 296,
  hedera_mainnet: 295,
};

export type MinimalHardhatNetwork = {
  network: { name: string };
};

export function resolveHederaNetwork(hre: MinimalHardhatNetwork): HederaNetwork {
  const name =
    hre.network.name !== 'hardhat' ? hre.network.name : process.env.CHAIN_TYPE || 'hedera_testnet';
  if (name !== 'hedera_testnet' && name !== 'hedera_mainnet') {
    throw new Error(
      `Unsupported network "${name}". Use --network hedera_testnet|hedera_mainnet or set CHAIN_TYPE to one of those values.`
    );
  }
  return name;
}
