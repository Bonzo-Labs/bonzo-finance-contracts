/**
 * Poke lowered rates via a controlled reopen (Hedera Mainnet only)
 * -------------------------------------------------------------------------
 * Swapping a reserve's interest-rate strategy does NOT refresh its stored
 * currentVariableBorrowRate - that only happens when reserve.updateInterestRates
 * runs, and every path that calls it (deposit/withdraw/borrow/repay) is gated by
 * whenNotPaused. So to make the new (lower) rates show up in stored state while
 * the protocol is otherwise kept closed, we briefly unpause, do a dust deposit
 * into each reserve (which triggers updateInterestRates with the NEW strategy),
 * then pause again.
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │  RUN THIS ONLY AFTER THE SUPRA / ORACLE ROOT CAUSE IS PATCHED.       │
 *   │  Unpausing re-opens EVERY reserve globally for the whole window;     │
 *   │  setPoolPause is protocol-wide, not per-asset. If the exploit is     │
 *   │  still live, do NOT run this.                                        │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Window minimisation:
 *  - Token approvals are done up-front (step A) WHILE STILL PAUSED - approve is
 *    on the token, not the pool, so the pause does not block it.
 *  - The only operations inside the unpaused window are the 3 dust deposits.
 *  - reopenSequence() fires unpause -> 3 deposits -> pause back-to-back (5 txns).
 *
 * Comprehensive preflight() verifies EVERY prerequisite before any unpause:
 * pool paused; admin holds emergency+pool admin roles; oracle remediation
 * attested (ORACLE_REMEDIATION_CONFIRMED=true, + optional source-address check);
 * each strategy deployed by the current pool admin, has matching bytecode/hash,
 * params and addresses provider, is still the wired strategy, reserve active and
 * not frozen, stored rate unchanged since wiring; proxy balances + allowances
 * sufficient. Aborts listing all problems.
 *
 * Containment (freeze) is handled separately by freezeAssets.ts. NOTE: a frozen
 * reserve rejects deposits, so unfreeze the 3 target reserves before poking.
 *
 * Signers (two, by design):
 *  - PRIVATE_KEY_MAINNET_ADMIN drives pause/unpause. It must hold the role that
 *    setPoolPause requires (emergency admin) on this deployment.
 *  - PRIVATE_KEY_MAINNET_PROXY (+ MAINNET_PROXY_ACCOUNT_ID) drives the dust
 *    deposits. It must hold a dust balance of WHBAR, USDC and WETH.
 * NOTE: WHBAR here is the wrapped-HBAR HTS token - the proxy must hold WHBAR
 * (wrap native HBAR first), not bare HBAR.
 */
import { ethers } from 'hardhat';
const hre = require('hardhat');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
import BigNumber from 'bignumber.js';

import {
  WHBAR,
  WETH,
  USDC,
  LendingPool,
  LendingPoolConfigurator,
  LendingPoolAddressesProvider,
  AaveProtocolDataProvider,
  AaveOracle,
} from '../outputReserveData.json';
import { oneRay } from '../../helpers/constants';

const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
if (chain_type !== 'hedera_mainnet') {
  throw new Error(
    `This is a mainnet-only operation. Set CHAIN_TYPE=hedera_mainnet (got "${chain_type}").`
  );
}

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET || '');
// pause/unpause signer (must satisfy setPoolPause's emergency-admin role).
const admin = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_ADMIN || '', provider);
// deposit signer (holds dust WHBAR/USDC/WETH; receives the dust aTokens).
const proxy = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET_PROXY || '', provider);
// Hedera account id paired with the proxy key. Informational for ethers-based
// deposits (only the key signs); kept for logging / parity with SDK scripts.
const proxyAccountId = process.env.MAINNET_PROXY_ACCOUNT_ID || '';

const DUST = '0.0001'; // deposit amount per asset (human units)

const ASSETS: Array<{ symbol: 'WHBAR' | 'USDC' | 'WETH'; address: string }> = [
  { symbol: 'WHBAR', address: WHBAR.hedera_mainnet.token.address },
  { symbol: 'USDC', address: USDC.hedera_mainnet.token.address },
  { symbol: 'WETH', address: WETH.hedera_mainnet.token.address },
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

// --------------------------------------------------------------------------
// Oracle remediation gate. There is no generic on-chain flag for "Supra
// patched the feed", so this is an explicit operator attestation, optionally
// backed by a source-address check:
//  - ORACLE_REMEDIATION_CONFIRMED=true must be set in the environment.
//  - If you know the patched adapter addresses, fill EXPECTED_ORACLE_SOURCES
//    and the preflight will additionally assert AaveOracle.getSourceOfAsset
//    matches. Leave '' to rely on the attestation alone.
// --------------------------------------------------------------------------
const EXPECTED_ORACLE_SOURCES: Record<'WHBAR' | 'USDC' | 'WETH', string> = {
  WHBAR: '',
  USDC: '',
  WETH: '',
};

const STATE_PATH = path.join(__dirname, 'rate-update-state.json');
function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}
const rayToPct = (ray: ethers.BigNumberish) =>
  `${new BigNumber(ray.toString()).dividedBy(oneRay).multipliedBy(100).toFixed(3)}%`;

async function contractAs(artifactName: string, address: string, signerOrProvider: any) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}
async function configurator() {
  // pause/unpause -> admin signer
  return contractAs('LendingPoolConfigurator', LendingPoolConfigurator.hedera_mainnet.address, admin);
}
async function poolRO() {
  return contractAs('LendingPool', LendingPool.hedera_mainnet.address, provider);
}
async function poolTx() {
  // deposits -> proxy signer
  return contractAs('LendingPool', LendingPool.hedera_mainnet.address, proxy);
}
async function dataProviderRO() {
  return contractAs('AaveProtocolDataProvider', AaveProtocolDataProvider.hedera_mainnet.address, provider);
}
async function addressesProviderRO() {
  return contractAs(
    'LendingPoolAddressesProvider',
    LendingPoolAddressesProvider.hedera_mainnet.address,
    provider
  );
}
const eqAddr = (a: any, b: any) => a?.toString().toLowerCase() === b?.toString().toLowerCase();

// --------------------------------------------------------------------------
// Comprehensive preflight. Verifies EVERY prerequisite for the dangerous
// unpause before anything is executed. Collects all problems and aborts.
// --------------------------------------------------------------------------
async function preflight() {
  console.log('\n===== PREFLIGHT =====');
  const problems: string[] = [];
  const ok = (m: string) => console.log('  ✅', m);
  const bad = (m: string) => {
    console.log('  ❌', m);
    problems.push(m);
  };

  const state = loadState();
  const pool = await poolRO();
  const dp = await dataProviderRO();
  const ap = await addressesProviderRO();
  const liveProvider = LendingPoolAddressesProvider.hedera_mainnet.address;

  // 1. Pool is currently paused.
  (await pool.paused()) ? ok('pool is paused') : bad('pool is NOT paused');

  // 2. admin signer holds emergency-admin AND pool-admin roles.
  const [emAdmin, poolAdmin] = await Promise.all([ap.getEmergencyAdmin(), ap.getPoolAdmin()]);
  eqAddr(emAdmin, admin.address)
    ? ok(`admin is emergency admin (${emAdmin})`)
    : bad(`admin ${admin.address} != emergency admin ${emAdmin}`);
  eqAddr(poolAdmin, admin.address)
    ? ok(`admin is pool admin (${poolAdmin})`)
    : bad(`admin ${admin.address} != pool admin ${poolAdmin}`);

  // 4. Oracle remediation attestation (+ optional source-address check).
  if (process.env.ORACLE_REMEDIATION_CONFIRMED === 'true') {
    ok('ORACLE_REMEDIATION_CONFIRMED=true (operator attestation)');
  } else {
    bad('ORACLE_REMEDIATION_CONFIRMED is not "true" - set it only after Supra patch is verified');
  }
  const anyExpectedSource = Object.values(EXPECTED_ORACLE_SOURCES).some((s) => s);
  if (anyExpectedSource) {
    try {
      const oracle = await contractAs('AaveOracle', AaveOracle.hedera_mainnet.address, provider);
      for (const { symbol, address } of ASSETS) {
        const expected = EXPECTED_ORACLE_SOURCES[symbol];
        if (!expected) continue;
        const src = await oracle.getSourceOfAsset(address);
        eqAddr(src, expected)
          ? ok(`${symbol} oracle source == expected patched adapter`)
          : bad(`${symbol} oracle source ${src} != expected ${expected}`);
      }
    } catch (e: any) {
      bad(`could not read AaveOracle.getSourceOfAsset: ${e.message?.slice(0, 80)}`);
    }
  }

  // Per-asset checks.
  for (const { symbol, address } of ASSETS) {
    const entry = state.reserves?.[symbol];
    const deploy = entry?.deploy;
    const wire = entry?.wire;
    if (!deploy?.completed || !wire?.completed) {
      bad(`${symbol}: not deployed+wired (run lowerBorrowRates.ts)`);
      continue;
    }
    // 3. The intended pool admin executed the strategy changes.
    eqAddr(deploy.deployerEvm, poolAdmin)
      ? ok(`${symbol}: strategy deployed by current pool admin`)
      : bad(`${symbol}: deployer ${deploy.deployerEvm} != pool admin ${poolAdmin}`);
    // state entry belongs to this network + deployment.
    if (deploy.network && deploy.network !== chain_type) bad(`${symbol}: state network mismatch`);
    if (deploy.addressesProvider && !eqAddr(deploy.addressesProvider, liveProvider))
      bad(`${symbol}: state addressesProvider mismatch`);

    // 11. Current strategy address unchanged since verification.
    const rd = await pool.getReserveData(address);
    eqAddr(rd.interestRateStrategyAddress, deploy.address)
      ? ok(`${symbol}: reserve still wired to ${deploy.address}`)
      : bad(`${symbol}: live strategy ${rd.interestRateStrategyAddress} != ${deploy.address}`);

    // 5. Target strategy has deployed bytecode + matches recorded hash.
    const code = await provider.getCode(deploy.address);
    if (!code || code === '0x') {
      bad(`${symbol}: strategy ${deploy.address} has no bytecode`);
    } else if (deploy.runtimeBytecodeHash && ethers.utils.keccak256(code).toLowerCase() !== deploy.runtimeBytecodeHash.toLowerCase()) {
      bad(`${symbol}: strategy bytecode hash mismatch (tampered?)`);
    } else {
      ok(`${symbol}: strategy bytecode present + hash matches`);
    }

    // 6. Strategy params + addresses provider match intended values.
    try {
      const strat = await contractAs('DefaultReserveInterestRateStrategy', deploy.address, provider);
      const [sap, optimal, base, v1, v2, s1, s2] = await Promise.all([
        strat.addressesProvider(),
        strat.OPTIMAL_UTILIZATION_RATE(),
        strat.baseVariableBorrowRate(),
        strat.variableRateSlope1(),
        strat.variableRateSlope2(),
        strat.stableRateSlope1(),
        strat.stableRateSlope2(),
      ]);
      const mism: string[] = [];
      if (!eqAddr(sap, liveProvider)) mism.push('addressesProvider');
      if (optimal.toString() !== deploy.preserved.optimalUtilizationRate) mism.push('optimal');
      if (base.toString() !== deploy.target.baseVariableBorrowRate) mism.push('base');
      if (v1.toString() !== deploy.target.variableRateSlope1) mism.push('slope1');
      if (v2.toString() !== deploy.target.variableRateSlope2) mism.push('slope2');
      if (s1.toString() !== deploy.preserved.stableRateSlope1) mism.push('stableSlope1');
      if (s2.toString() !== deploy.preserved.stableRateSlope2) mism.push('stableSlope2');
      mism.length
        ? bad(`${symbol}: strategy param mismatch [${mism.join(', ')}]`)
        : ok(`${symbol}: strategy params + provider match intended`);
    } catch (e: any) {
      bad(`${symbol}: strategy param read failed: ${e.message?.slice(0, 60)}`);
    }

    // 9 & 10. Reserve active; not frozen (frozen reserve rejects the deposit poke).
    const cfg = await dp.getReserveConfigurationData(address);
    cfg.isActive ? ok(`${symbol}: reserve active`) : bad(`${symbol}: reserve NOT active`);
    !cfg.isFrozen ? ok(`${symbol}: reserve not frozen`) : bad(`${symbol}: reserve FROZEN (deposit will revert)`);

    // 12. Stored rate still equals the snapshot recorded at wire time.
    if (wire.storedRateSnapshot?.variableBorrowRate) {
      const nowRate = (await dp.getReserveData(address)).variableBorrowRate.toString();
      nowRate === wire.storedRateSnapshot.variableBorrowRate
        ? ok(`${symbol}: stored rate unchanged since wiring (${rayToPct(nowRate)})`)
        : bad(`${symbol}: stored rate changed since wiring (now ${rayToPct(nowRate)}) - unexpected interaction?`);
    }

    // 7 & 8. Proxy balance + allowance sufficient for the dust deposit.
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const amount = ethers.utils.parseUnits(DUST, decimals);
    const [bal, allow] = await Promise.all([
      token.balanceOf(proxy.address),
      token.allowance(proxy.address, LendingPool.hedera_mainnet.address),
    ]);
    bal.gte(amount) ? ok(`${symbol}: proxy balance sufficient`) : bad(`${symbol}: proxy balance < ${DUST}`);
    allow.gte(amount)
      ? ok(`${symbol}: allowance sufficient`)
      : bad(`${symbol}: allowance < ${DUST} (run approveAll)`);
  }

  if (problems.length) {
    throw new Error(`\nPREFLIGHT FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  }
  console.log('===== PREFLIGHT PASSED =====\n');
}

async function printStoredRates(label: string) {
  const dp = await dataProviderRO();
  console.log(`\n=== stored variableBorrowRate (${label}) ===`);
  for (const { symbol, address } of ASSETS) {
    const d = await dp.getReserveData(address);
    console.log(`  ${symbol}: ${rayToPct(d.variableBorrowRate)}`);
  }
  console.log('==========================================\n');
}

// --------------------------------------------------------------------------
// Step A: approve the pool to pull dust of each token. Runs WHILE PAUSED.
// --------------------------------------------------------------------------
async function approveAll() {
  const poolAddr = LendingPool.hedera_mainnet.address;
  for (const { symbol, address } of ASSETS) {
    const token = new ethers.Contract(address, ERC20_ABI, proxy);
    const decimals = await token.decimals();
    const amount = ethers.utils.parseUnits(DUST, decimals);
    const bal = await token.balanceOf(proxy.address);
    if (bal.lt(amount)) {
      throw new Error(
        `${symbol}: proxy ${proxy.address} holds ${bal.toString()} < ${amount.toString()} ` +
          `(needs ${DUST} ${symbol}). Fund the proxy with dust ${symbol} first.`
      );
    }
    const current = await token.allowance(proxy.address, poolAddr);
    if (current.gte(amount)) {
      console.log(`${symbol}: allowance already sufficient`);
      continue;
    }
    console.log(`${symbol}: approving pool for ${DUST} ...`);
    const tx = await token.approve(poolAddr, amount);
    await tx.wait();
    console.log(`${symbol}: approved (tx ${tx.hash})`);
  }
}

// --------------------------------------------------------------------------
// Individual txns (for fully manual, step-by-step control).
// --------------------------------------------------------------------------
async function unpause() {
  const c = await configurator();
  console.log('Unpausing (setPoolPause false) ...');
  const tx = await c.setPoolPause(false);
  await tx.wait();
  console.log('paused =', await (await poolRO()).paused());
}

async function depositPoke(symbol: 'WHBAR' | 'USDC' | 'WETH') {
  const asset = ASSETS.find((a) => a.symbol === symbol)!.address;
  const token = new ethers.Contract(asset, ERC20_ABI, proxy);
  const decimals = await token.decimals();
  const amount = ethers.utils.parseUnits(DUST, decimals);
  const pool = await poolTx();
  console.log(`Depositing ${DUST} ${symbol} (proxy ${proxy.address}) to poke updateInterestRates ...`);
  const tx = await pool.deposit(asset, amount, proxy.address, 0);
  await tx.wait();
  console.log(`${symbol} deposited (tx ${tx.hash})`);
}

async function pause() {
  const c = await configurator();
  console.log('Pausing (setPoolPause true) ...');
  const tx = await c.setPoolPause(true);
  await tx.wait();
  console.log('paused =', await (await poolRO()).paused());
}

// --------------------------------------------------------------------------
// Tight sequence: unpause -> 3 deposits -> pause, back-to-back (5 txns).
// Minimises the unpaused window. Approvals must already be done (step A).
// --------------------------------------------------------------------------
async function reopenSequence() {
  await unpause();
  for (const { symbol } of ASSETS) {
    await depositPoke(symbol);
  }
  await pause();
}

async function main() {
  console.log('Chain:', chain_type);
  console.log('Admin signer (pause/unpause):', admin.address);
  console.log('Proxy signer (deposits):', proxy.address, proxyAccountId ? `(${proxyAccountId})` : '');
  console.log(
    '\n*** RUN ONLY AFTER THE ORACLE ROOT CAUSE IS PATCHED. Unpause re-opens ALL reserves. ***\n'
  );

  // --- Step A: approvals (safe while paused; proxy signer). Uncomment to run. ---
  // await approveAll();

  // Comprehensive preflight - verifies EVERY prerequisite (paused, admin roles,
  // oracle attestation, strategy bytecode/params/wiring, balances, allowances,
  // active/frozen, unchanged rates). Aborts on any problem.
  await preflight();
  await printStoredRates('BEFORE - stale, still on old strategy values');

  // --- Step B: the reopen poke. Uncomment once Step A is done. ---
  //     NOTE: the target reserves must be UNFROZEN for the deposit poke to work
  //     (a frozen reserve rejects deposit). If you froze them (freezeAssets.ts),
  //     unfreeze the three targets first, then re-freeze after.
  //
  //     Tight sequence (unpause -> 3 deposits -> pause, back-to-back):
  // await reopenSequence();
  //
  //     ...or drive each txn manually (longer open window):
  // await unpause();
  // await depositPoke('WHBAR');
  // await depositPoke('USDC');
  // await depositPoke('WETH');
  // await pause();

  // Confirm the refresh landed and the pool is closed again.
  // await printStoredRates('AFTER - should show the new lower rates');
  // console.log('paused =', await (await poolRO()).paused());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
