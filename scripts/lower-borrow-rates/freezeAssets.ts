/**
 * Freeze all reserves (Hedera Mainnet only).
 *
 * Frozen reserves reject deposits and borrows while still allowing withdraw,
 * repay and liquidation. Unfreezing is intentionally outside this script.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();

import { FREEZE_STATE_PATH, PROTOCOL_ADDRESSES, assertMainnet } from './rateConfig';
import { contractAs, sleep, withRetry, writeJson } from './scriptUtils';

const chainType = process.env.CHAIN_TYPE || 'hedera_testnet';
assertMainnet(chainType);

const provider = withRetry(
  new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '')
);
const admin = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 2000);

async function configurator() {
  return contractAs(hre, 'LendingPoolConfigurator', PROTOCOL_ADDRESSES.configurator, admin);
}

async function readReserves() {
  const dataProvider = await contractAs(
    hre,
    'AaveProtocolDataProvider',
    PROTOCOL_ADDRESSES.dataProvider,
    provider
  );
  const pool = await contractAs(hre, 'LendingPool', PROTOCOL_ADDRESSES.pool, provider);
  const [list, tokens] = await Promise.all([
    pool.getReservesList(),
    dataProvider.getAllReservesTokens(),
  ]);
  const symbols = new Map<string, string>();
  for (const token of tokens) {
    symbols.set(token.tokenAddress.toLowerCase(), token.symbol);
  }

  const rows: Array<{
    symbol: string;
    asset: string;
    isFrozen: boolean;
    isActive: boolean;
    stableEnabled: boolean;
  }> = [];
  for (const asset of list) {
    const config = await dataProvider.getReserveConfigurationData(asset);
    rows.push({
      symbol: symbols.get(asset.toLowerCase()) || 'UNKNOWN',
      asset,
      isFrozen: config.isFrozen,
      isActive: config.isActive,
      stableEnabled: config.stableBorrowRateEnabled,
    });
  }
  return rows;
}

async function status() {
  const rows = await readReserves();
  const frozen = rows.filter((row) => row.isFrozen);
  const stableOn = rows.filter((row) => row.stableEnabled);
  console.log(`\n=== reserve freeze status (${rows.length} reserves) ===`);
  for (const row of rows) {
    console.log(
      `  ${row.isFrozen ? 'FROZEN ' : 'active '} ${row.symbol.padEnd(8)} ${row.asset}` +
        `${row.stableEnabled ? '  WARNING: stableBorrow ON' : ''}`
    );
  }
  console.log(`Already frozen: ${frozen.length} | to freeze: ${rows.length - frozen.length}`);
  if (stableOn.length) {
    console.log(`WARNING: stable borrowing enabled on ${stableOn.length} reserve(s).`);
  }
  console.log('');
  return rows;
}

async function freezeAll() {
  const rows = await readReserves();
  const poolConfigurator = await configurator();
  const record = {
    network: chainType,
    startedAt: new Date().toISOString(),
    updatedAt: null as string | null,
    preState: Object.fromEntries(rows.map((row) => [row.asset, row.isFrozen])),
    frozenThisRun: [] as string[],
    alreadyFrozen: rows.filter((row) => row.isFrozen).map((row) => row.asset),
  };
  writeJson(FREEZE_STATE_PATH, record);

  const toFreeze = rows.filter((row) => !row.isFrozen);
  for (let index = 0; index < toFreeze.length; index++) {
    const row = toFreeze[index];
    console.log(`[${index + 1}/${toFreeze.length}] Freezing ${row.symbol} (${row.asset}) ...`);
    const tx = await poolConfigurator.freezeReserve(row.asset);
    await tx.wait();
    record.frozenThisRun.push(row.asset);
    record.updatedAt = new Date().toISOString();
    writeJson(FREEZE_STATE_PATH, record);
    console.log(`  frozen. tx=${tx.hash}`);
    if (index < toFreeze.length - 1) await sleep(TX_DELAY_MS);
  }
  console.log(
    `\nFroze ${record.frozenThisRun.length}; skipped ${record.alreadyFrozen.length} already-frozen.`
  );
}

async function main() {
  console.log('Chain:', chainType);
  console.log('Pool admin signer:', admin.address);

  await status();

  // Uncomment only when every currently active reserve should be frozen.
  // await freezeAll();

  // await status();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
