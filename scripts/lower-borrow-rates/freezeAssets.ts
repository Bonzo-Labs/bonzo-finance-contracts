/**
 * Freeze all reserves (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Containment via freeze rather than a full pause. A FROZEN reserve rejects new
 * deposits and new borrows (validateDeposit / validateBorrow both require
 * !isFrozen) but STILL allows withdraw, repay and liquidation - so users are not
 * trapped the way a global pause traps them.
 *
 * This freezes every reserve that is not already frozen. Some reserves are
 * expected to be frozen already (currently 3); those are detected and skipped.
 * The pre-state is snapshotted to freeze-state.json so `unfreezeThisRun()` can
 * later unfreeze ONLY the reserves this script froze - never the ones that were
 * already frozen for other reasons.
 *
 *   freezeReserve / unfreezeReserve are onlyPoolAdmin on the configurator and
 *   carry no whenNotPaused gate, so this runs whether the pool is paused or not.
 *
 * Signer: PRIVATE_KEY_MAINNET_ADMIN (pool admin).
 *
 * NOTE re the rate poke: a frozen reserve rejects the dust deposit in
 * pokeRatesReopen.ts. If you need to poke WHBAR/USDC/WETH, unfreeze those three
 * first (unfreezeOne), poke, then re-freeze (freezeOne).
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

import {
  LendingPool,
  LendingPoolConfigurator,
  AaveProtocolDataProvider,
} from '../outputReserveData.json';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `This is a mainnet-only operation. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');
const admin = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

const STATE_PATH = path.join(__dirname, 'freeze-state.json');
function loadState() {
  return fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
}
function saveState(data: Record<string, unknown>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2) + '\n');
}

async function contractAs(artifactName: string, address: string, signerOrProvider: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}
async function configurator() {
  return contractAs('LendingPoolConfigurator', LendingPoolConfigurator.hedera_mainnet.address, admin);
}
async function dataProviderRO() {
  return contractAs('AaveProtocolDataProvider', AaveProtocolDataProvider.hedera_mainnet.address, provider);
}
async function poolRO() {
  return contractAs('LendingPool', LendingPool.hedera_mainnet.address, provider);
}

// symbol lookup by lowercased token address.
async function symbolMap(): Promise<Map<string, string>> {
  const dp = await dataProviderRO();
  const tokens = await dp.getAllReservesTokens(); // [{ symbol, tokenAddress }]
  const m = new Map<string, string>();
  for (const t of tokens) m.set(t.tokenAddress.toLowerCase(), t.symbol);
  return m;
}

// Read every reserve + its frozen flag, with a friendly symbol.
async function readReserves() {
  const [list, syms] = await Promise.all([(await poolRO()).getReservesList(), symbolMap()]);
  const dp = await dataProviderRO();
  const rows: Array<{ symbol: string; asset: string; isFrozen: boolean; isActive: boolean }> = [];
  for (const asset of list) {
    const cfg = await dp.getReserveConfigurationData(asset);
    rows.push({
      symbol: syms.get(asset.toLowerCase()) || 'UNKNOWN',
      asset,
      isFrozen: cfg.isFrozen,
      isActive: cfg.isActive,
    });
  }
  return rows;
}

async function status() {
  const rows = await readReserves();
  const frozen = rows.filter((r) => r.isFrozen);
  console.log(`\n=== reserve freeze status (${rows.length} reserves) ===`);
  for (const r of rows) {
    console.log(`  ${r.isFrozen ? '🧊 FROZEN ' : '   active '} ${r.symbol.padEnd(8)} ${r.asset}`);
  }
  console.log(`Already frozen: ${frozen.length} | to freeze: ${rows.length - frozen.length}\n`);
  return rows;
}

// --------------------------------------------------------------------------
// Freeze every reserve that is not already frozen. Idempotent: already-frozen
// reserves are skipped. Snapshots the pre-state for a targeted unfreeze later.
// --------------------------------------------------------------------------
async function freezeAll() {
  const rows = await readReserves();
  const c = await configurator();
  const preState = Object.fromEntries(rows.map((r) => [r.asset, r.isFrozen]));
  const frozenThisRun: string[] = [];
  for (const r of rows) {
    if (r.isFrozen) {
      console.log(`skip ${r.symbol} - already frozen`);
      continue;
    }
    console.log(`Freezing ${r.symbol} (${r.asset}) ...`);
    const tx = await c.freezeReserve(r.asset);
    await tx.wait();
    frozenThisRun.push(r.asset);
    console.log(`  frozen. tx=${tx.hash}`);
  }
  saveState({
    network: chain_type,
    preState, // asset -> isFrozen BEFORE this run
    frozenThisRun,
    timestamp: new Date().toISOString(),
  });
  console.log(`\nFroze ${frozenThisRun.length} reserve(s); ${rows.length - frozenThisRun.length} were already frozen or skipped.`);
}

// Unfreeze ONLY the reserves this script froze (from freeze-state.json). Never
// touches reserves that were already frozen before freezeAll() ran.
async function unfreezeThisRun() {
  const state = loadState();
  const frozenThisRun: string[] = state.frozenThisRun || [];
  if (!frozenThisRun.length) {
    console.log('No reserves recorded as frozen by this script.');
    return;
  }
  const c = await configurator();
  for (const asset of frozenThisRun) {
    console.log(`Unfreezing ${asset} ...`);
    const tx = await c.unfreezeReserve(asset);
    await tx.wait();
    console.log(`  unfrozen. tx=${tx.hash}`);
  }
  console.log(`Unfroze ${frozenThisRun.length} reserve(s) from this run's snapshot.`);
}

// Granular freeze/unfreeze of a single asset by address (e.g. to unfreeze a
// target reserve for the rate poke, then re-freeze it).
async function freezeOne(asset: string) {
  const c = await configurator();
  console.log(`Freezing ${asset} ...`);
  const tx = await c.freezeReserve(asset);
  await tx.wait();
  console.log(`  frozen. tx=${tx.hash}`);
}
async function unfreezeOne(asset: string) {
  const c = await configurator();
  console.log(`Unfreezing ${asset} ...`);
  const tx = await c.unfreezeReserve(asset);
  await tx.wait();
  console.log(`  unfrozen. tx=${tx.hash}`);
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Pool admin signer:', admin.address);

  // Always show current state first.
  await status();

  // Uncomment to freeze all not-already-frozen reserves.
  // await freezeAll();

  // Uncomment to reverse: unfreeze only what this script froze.
  // await unfreezeThisRun();

  // Granular (e.g. to poke rates on a target reserve, then re-freeze):
  // await unfreezeOne('0x...');
  // await freezeOne('0x...');

  // await status();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
