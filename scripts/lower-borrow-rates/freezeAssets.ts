/**
 * Freeze all reserves (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Containment via freeze rather than a full pause. A FROZEN reserve rejects new
 * deposits and new borrows (validateDeposit / validateBorrow both require
 * !isFrozen) but STILL allows withdraw, repay and liquidation - so users are not
 * trapped the way a global pause traps them.
 *
 * Freezes every reserve that is not already frozen. Some reserves are expected
 * to be frozen already (currently 3); those are detected and skipped. Progress
 * is written to freeze-state.json AFTER EACH tx, so a crash mid-loop leaves an
 * accurate record of exactly what was frozen (no orphaned reserves).
 *
 *   freezeReserve is onlyPoolAdmin on the configurator and carries no
 *   whenNotPaused gate, so this runs whether the pool is paused or not.
 *
 * Signer: PRIVATE_KEY_MAINNET_ADMIN (pool admin).
 *
 * NOTE re the rate poke: a frozen reserve rejects the dust deposit in
 * pokeRatesReopen.ts. Unfreezing (to poke, or to reverse containment) is
 * intentionally NOT in this script - do it deliberately/separately.
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
import { withRetry } from './rpcRetry';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `This is a mainnet-only operation. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = withRetry(
  new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '')
);
const admin = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);

// Small pause between txs. Each freeze is await tx.wait()'d, but Hedera's relay
// derives the next nonce from the mirror node, which can lag a mined tx - the
// delay avoids a stale/duplicate nonce on the following send.
const TX_DELAY_MS = Number(process.env.TX_DELAY_MS || 2000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATE_PATH = path.join(__dirname, 'freeze-state.json');
function saveState(data: Record<string, unknown>) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2) + '\n');
}

async function contractAs(artifactName: string, address: string, signerOrProvider: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}
async function configurator() {
  return contractAs(
    'LendingPoolConfigurator',
    LendingPoolConfigurator.hedera_mainnet.address,
    admin
  );
}
async function dataProviderRO() {
  return contractAs(
    'AaveProtocolDataProvider',
    AaveProtocolDataProvider.hedera_mainnet.address,
    provider
  );
}
async function poolRO() {
  return contractAs('LendingPool', LendingPool.hedera_mainnet.address, provider);
}

// Read every reserve + its frozen flag, with a friendly symbol.
async function readReserves() {
  const dp = await dataProviderRO();
  const [list, tokens] = await Promise.all([
    (await poolRO()).getReservesList(),
    dp.getAllReservesTokens(), // [{ symbol, tokenAddress }]
  ]);
  const syms = new Map<string, string>();
  for (const t of tokens) syms.set(t.tokenAddress.toLowerCase(), t.symbol);

  const rows: Array<{
    symbol: string;
    asset: string;
    isFrozen: boolean;
    isActive: boolean;
    stableEnabled: boolean;
  }> = [];
  for (const asset of list) {
    const cfg = await dp.getReserveConfigurationData(asset);
    rows.push({
      symbol: syms.get(asset.toLowerCase()) || 'UNKNOWN',
      asset,
      isFrozen: cfg.isFrozen,
      isActive: cfg.isActive,
      stableEnabled: cfg.stableBorrowRateEnabled,
    });
  }
  return rows;
}

async function status() {
  const rows = await readReserves();
  const frozen = rows.filter((r) => r.isFrozen);
  const stableOn = rows.filter((r) => r.stableEnabled);
  console.log(`\n=== reserve freeze status (${rows.length} reserves) ===`);
  for (const r of rows) {
    console.log(
      `  ${r.isFrozen ? '🧊 FROZEN ' : '   active '} ${r.symbol.padEnd(8)} ${r.asset}` +
        `${r.stableEnabled ? '  ⚠️ stableBorrow ON' : ''}`
    );
  }
  console.log(`Already frozen: ${frozen.length} | to freeze: ${rows.length - frozen.length}`);
  if (stableOn.length) {
    console.log(`⚠️  stable borrowing ENABLED on ${stableOn.length} reserve(s) - should be off.`);
  }
  console.log('');
  return rows;
}

// --------------------------------------------------------------------------
// Freeze every reserve that is not already frozen. Idempotent (already-frozen
// reserves are skipped). freeze-state.json is updated after each successful tx.
// --------------------------------------------------------------------------
async function freezeAll() {
  const rows = await readReserves();
  const c = await configurator();

  const record: {
    network: string;
    startedAt: string;
    updatedAt: string | null;
    preState: Record<string, boolean>;
    frozenThisRun: string[];
    alreadyFrozen: string[];
  } = {
    network: chain_type,
    startedAt: new Date().toISOString(),
    updatedAt: null,
    preState: Object.fromEntries(rows.map((r) => [r.asset, r.isFrozen])),
    frozenThisRun: [],
    alreadyFrozen: rows.filter((r) => r.isFrozen).map((r) => r.asset),
  };
  saveState(record); // baseline snapshot before any tx

  const toFreeze = rows.filter((r) => !r.isFrozen);
  for (let i = 0; i < toFreeze.length; i++) {
    const r = toFreeze[i];
    console.log(`[${i + 1}/${toFreeze.length}] Freezing ${r.symbol} (${r.asset}) ...`);
    const tx = await c.freezeReserve(r.asset);
    await tx.wait();
    record.frozenThisRun.push(r.asset);
    record.updatedAt = new Date().toISOString();
    saveState(record); // persist AFTER each freeze -> crash leaves an accurate record
    console.log(`  frozen. tx=${tx.hash}`);
    if (i < toFreeze.length - 1) await sleep(TX_DELAY_MS);
  }
  console.log(
    `\nFroze ${record.frozenThisRun.length}; skipped ${record.alreadyFrozen.length} already-frozen.`
  );
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Pool admin signer:', admin.address);

  // Always show current state first.
  await status();

  // Uncomment to freeze all not-already-frozen reserves.
  await freezeAll();

  await status();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

//   bonzo-finance-contracts [fix/exploit-interest-rates*] $ npx hardhat run scripts/lower-borrow-rates/freezeAssets.ts --network hedera_mainnet
// WARNING: You are currently using Node.js v22.17.1, which is not supported by Hardhat. This can lead to unexpected behavior. See https://hardhat.org/nodejs-versions

// Creating Typechain artifacts in directory types for target ethers-v5
// Successfully generated Typechain artifacts!
// (node:51648) [DEP0044] DeprecationWarning: The `util.isArray` API is deprecated. Please use `Array.isArray()` instead.
// (Use `node --trace-deprecation ...` to show where the warning was created)
// Chain: hedera_mainnet
// Pool admin signer: 0x9763ABB52aa18624E22557be68930534D513a079

// === reserve freeze status (14 reserves) ===
//      active  XSAUCE   0x00000000000000000000000000000000001647e8
//      active  USDC     0x000000000000000000000000000000000006f89a
//      active  KARATE   0x000000000000000000000000000000000022D6de
//      active  HBARX    0x00000000000000000000000000000000000cbA44
//      active  SAUCE    0x00000000000000000000000000000000000b2aD5
//      active  WHBAR    0x0000000000000000000000000000000000163B5a
//      active  DOVU     0x000000000000000000000000000000000038b3db
//   🧊 FROZEN  HST      0x00000000000000000000000000000000000Ec585
//      active  PACK     0x0000000000000000000000000000000000492A28
//   🧊 FROZEN  STEAM    0x000000000000000000000000000000000030fb8b
//      active  GRELF    0x000000000000000000000000000000000011afa2
//   🧊 FROZEN  KBL      0x00000000000000000000000000000000005B665A
//      active  BONZO    0x00000000000000000000000000000000007e545e
//      active  WETH     0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2
// Already frozen: 3 | to freeze: 11

// [1/11] Freezing XSAUCE (0x00000000000000000000000000000000001647e8) ...
//   frozen. tx=0x4caf7f6d8a42941c13bbb9bc0683f2d0e14367f3a8f83043f73d0ac558a49bd0
// [2/11] Freezing USDC (0x000000000000000000000000000000000006f89a) ...
//   frozen. tx=0x141d1e9ecd1d969d456f5fca6699df3cb83932010569d6e513e14d9cf74b48ba
// [3/11] Freezing KARATE (0x000000000000000000000000000000000022D6de) ...
//   frozen. tx=0xc50e2d25a9ca053258bdaf029057bf81c23c155d0366642948645497a7507b9f
// [4/11] Freezing HBARX (0x00000000000000000000000000000000000cbA44) ...
//   frozen. tx=0x595b4b60ff19a627b96d6df0c8dd324a250d60f900011fe74d3db7c706ee3aba
// [5/11] Freezing SAUCE (0x00000000000000000000000000000000000b2aD5) ...
//   frozen. tx=0x4aa2c5f4d1837c6116783a4965e37437f4cc77f1771a77d06b485333e9117888
// [6/11] Freezing WHBAR (0x0000000000000000000000000000000000163B5a) ...
//   frozen. tx=0x941ed2ff870ac77b49c5e774c025f9ffabc2c5177fb3a664ad51a3d3aff669f9
// [7/11] Freezing DOVU (0x000000000000000000000000000000000038b3db) ...
//   frozen. tx=0x751689b7b4f665616f41c29bb4e1e772a70f30e2c6cef97c29bbce5b3c801831
// [8/11] Freezing PACK (0x0000000000000000000000000000000000492A28) ...
//   frozen. tx=0xcbecdd5e00f05f0a586b6a5a2ab574a7a2b04c28a1c844a194ee34f892edb3ce
// [9/11] Freezing GRELF (0x000000000000000000000000000000000011afa2) ...
//   frozen. tx=0x0020f2415899cc72d757cb82c46a709d8eed9481325f93aaf1e14e29f2c6aa3b
// [10/11] Freezing BONZO (0x00000000000000000000000000000000007e545e) ...
//   frozen. tx=0xa358251b5d09de9f37cf6c25f68d3742f9237a6c6142fa411d6d984560261a80
// [11/11] Freezing WETH (0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2) ...
//   frozen. tx=0x568fc1dd37bc6af4c54d61645f91c640d16d0a3f149f5458ea8c1a39c604f5cf

// Froze 11; skipped 3 already-frozen.

// === reserve freeze status (14 reserves) ===
//   🧊 FROZEN  XSAUCE   0x00000000000000000000000000000000001647e8
//   🧊 FROZEN  USDC     0x000000000000000000000000000000000006f89a
//   🧊 FROZEN  KARATE   0x000000000000000000000000000000000022D6de
//   🧊 FROZEN  HBARX    0x00000000000000000000000000000000000cbA44
//   🧊 FROZEN  SAUCE    0x00000000000000000000000000000000000b2aD5
//   🧊 FROZEN  WHBAR    0x0000000000000000000000000000000000163B5a
//   🧊 FROZEN  DOVU     0x000000000000000000000000000000000038b3db
//   🧊 FROZEN  HST      0x00000000000000000000000000000000000Ec585
//   🧊 FROZEN  PACK     0x0000000000000000000000000000000000492A28
//   🧊 FROZEN  STEAM    0x000000000000000000000000000000000030fb8b
//   🧊 FROZEN  GRELF    0x000000000000000000000000000000000011afa2
//   🧊 FROZEN  KBL      0x00000000000000000000000000000000005B665A
//   🧊 FROZEN  BONZO    0x00000000000000000000000000000000007e545e
//   🧊 FROZEN  WETH     0xCa367694CDaC8f152e33683BB36CC9d6A73F1ef2
// Already frozen: 14 | to freeze: 0

// bonzo-finance-contracts [fix/exploit-interest-rates*] $
