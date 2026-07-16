/**
 * Compare the pre-incident and current Bonzo position snapshots.
 *
 * Read-only. This script reads two JSON snapshots produced by
 * snapshotPositions.ts and writes a Markdown report next to those snapshots.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/generatePositionSnapshotSummary.ts \
 *     scripts/out/snapshot-97504300.json scripts/out/snapshot-CURRENT_BLOCK.json
 */
import { ethers } from 'ethers';
const fs = require('fs');
const path = require('path');

const beforePath = path.resolve(process.argv[2] || 'scripts/out/snapshot-97504300.json');
const afterArg = process.argv[3];

if (!afterArg) {
  throw new Error('Pass the current snapshot JSON as the second argument.');
}

const afterPath = path.resolve(afterArg);
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

if (!before.summary?.complete || !after.summary?.complete) {
  throw new Error('Both snapshots must be complete before generating a decision report.');
}
if (!Array.isArray(after.users)) {
  throw new Error('Current snapshot has no user account data. Re-run with the updated snapshot script.');
}

const prices: Record<string, string> = after.metadata.valuation.pricesUsd;
const beforePositions = before.positions as any[];
const afterPositions = after.positions as any[];

function tokenAmount(raw: string, decimals: number): number {
  return Number(ethers.utils.formatUnits(raw, decimals));
}

function usd(raw: string, decimals: number, token: string): number {
  return tokenAmount(raw, decimals) * Number(prices[token]);
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function moneyExact(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amount(value: number): string {
  if (Math.abs(value) >= 1_000_000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 1_000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function pct(value: number): string {
  return `${value.toFixed(value < 1 ? 3 : 2)}%`;
}

function hf(raw: string): number {
  return Number(ethers.utils.formatUnits(raw, 18));
}

function totals(positions: any[]) {
  return positions.reduce(
    (acc, p) => {
      acc.supplyUsd += usd(p.supplyRaw, p.decimals, p.token);
      acc.borrowUsd += usd(p.borrowRaw, p.decimals, p.token);
      return acc;
    },
    { supplyUsd: 0, borrowUsd: 0 }
  );
}

function suppliedUsdForAccount(positions: any[], accountId: string): number {
  return positions
    .filter((p) => p.accountId === accountId)
    .reduce((sum, p) => sum + usd(p.supplyRaw, p.decimals, p.token), 0);
}

function suppliedUsdForToken(positions: any[], token: string): number {
  return positions
    .filter((p) => p.token === token)
    .reduce((sum, p) => sum + usd(p.supplyRaw, p.decimals, p.token), 0);
}

function reserveRows(snapshot: any, positions: any[]) {
  const byToken = new Map<string, any[]>();
  for (const p of positions) {
    const list = byToken.get(p.token) || [];
    list.push(p);
    byToken.set(p.token, list);
  }
  return snapshot.reserves.map((r: any) => {
    const ps = byToken.get(r.symbol.toUpperCase()) || [];
    const supplied = tokenAmount(r.aTokenTotalSupply, r.decimals);
    const positionDebt = ps.reduce((sum: number, p: any) => sum + tokenAmount(p.borrowRaw, p.decimals), 0);
    const debt = r.totalVariableDebt
      ? tokenAmount(r.totalVariableDebt, r.decimals) + tokenAmount(r.totalStableDebt, r.decimals)
      : positionDebt;
    const cash = r.availableLiquidity ? tokenAmount(r.availableLiquidity, r.decimals) : undefined;
    return { token: r.symbol.toUpperCase(), supplied, debt, cash, decimals: r.decimals };
  });
}

function positionMap(positions: any[], address: string) {
  return new Map(
    positions
      .filter((p) => p.evmAddress.toLowerCase() === address.toLowerCase())
      .map((p) => [p.token, p])
  );
}

function actorTable(address: string) {
  const b = positionMap(beforePositions, address);
  const a = positionMap(afterPositions, address);
  const tokens = [...new Set([...b.keys(), ...a.keys()])].sort();
  const rows = tokens
    .map((token) => {
      const bp: any = b.get(token);
      const ap: any = a.get(token);
      const decimals = ap?.decimals ?? bp?.decimals;
      const beforeSupply = bp ? tokenAmount(bp.supplyRaw, decimals) : 0;
      const afterSupply = ap ? tokenAmount(ap.supplyRaw, decimals) : 0;
      const beforeDebt = bp ? tokenAmount(bp.borrowRaw, decimals) : 0;
      const afterDebt = ap ? tokenAmount(ap.borrowRaw, decimals) : 0;
      if (!beforeSupply && !afterSupply && !beforeDebt && !afterDebt) return null;
      return `| ${token} | ${amount(beforeSupply)} | ${amount(afterSupply)} | ${amount(
        afterSupply - beforeSupply
      )} | ${amount(beforeDebt)} | ${amount(afterDebt)} | ${amount(afterDebt - beforeDebt)} |`;
    })
    .filter(Boolean);
  return [
    '| Asset | Supply before | Supply now | Supply change | Debt before | Debt now | Debt change |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

const beforeTotals = totals(beforePositions);
const afterTotals = totals(afterPositions);
const aggregateSupplyChange = afterTotals.supplyUsd - beforeTotals.supplyUsd;
const account7951SupplyChange =
  suppliedUsdForAccount(afterPositions, '0.0.7951') - suppliedUsdForAccount(beforePositions, '0.0.7951');
const account1988666SupplyChange =
  suppliedUsdForAccount(afterPositions, '0.0.1988666') - suppliedUsdForAccount(beforePositions, '0.0.1988666');
const confirmedLiquidationSupplyReduction = -(account7951SupplyChange + account1988666SupplyChange);
const hbarxSupplyChange =
  suppliedUsdForToken(afterPositions, 'HBARX') - suppliedUsdForToken(beforePositions, 'HBARX');
const otherReserveSupplyChange = aggregateSupplyChange - hbarxSupplyChange;
const confirmedLiquidationShare = confirmedLiquidationSupplyReduction / -aggregateSupplyChange * 100;
const beforeReserves = reserveRows(before, beforePositions);
const afterReserves = reserveRows(after, afterPositions);
const beforeReserveMap = new Map(beforeReserves.map((r: any) => [r.token, r]));
const currentBorrowers = after.users.filter((u: any) => u.totalDebtBaseRaw !== '0');
const underwater = currentBorrowers.filter((u: any) => hf(u.healthFactorRaw) <= 1);
const close = currentBorrowers.filter((u: any) => {
  const value = hf(u.healthFactorRaw);
  return value > 1 && value <= 1.1;
});
const watch = currentBorrowers
  .filter((u: any) => hf(u.healthFactorRaw) <= 1.25)
  .sort((a: any, b: any) => hf(a.healthFactorRaw) - hf(b.healthFactorRaw));

const healthBuckets = [
  ['HF <= 1.00', underwater.length, 'Liquidatable under normal Aave V2 rules'],
  ['1.00 < HF <= 1.05', currentBorrowers.filter((u: any) => hf(u.healthFactorRaw) > 1 && hf(u.healthFactorRaw) <= 1.05).length, 'Very close'],
  ['1.05 < HF <= 1.10', currentBorrowers.filter((u: any) => hf(u.healthFactorRaw) > 1.05 && hf(u.healthFactorRaw) <= 1.1).length, 'Close'],
  ['1.10 < HF <= 1.25', currentBorrowers.filter((u: any) => hf(u.healthFactorRaw) > 1.1 && hf(u.healthFactorRaw) <= 1.25).length, 'Watch'],
  ['HF > 1.25', currentBorrowers.filter((u: any) => hf(u.healthFactorRaw) > 1.25).length, 'Lower immediate risk'],
];

const reserveTable = afterReserves.map((current: any) => {
  const prior: any = beforeReserveMap.get(current.token);
  const supplyChange = current.supplied - (prior?.supplied || 0);
  const debtChange = current.debt - (prior?.debt || 0);
  const coverage = current.supplied > 0 ? (current.cash / current.supplied) * 100 : 100;
  const cashUsd = current.cash * Number(prices[current.token]);
  return `| ${current.token} | ${amount(prior?.supplied || 0)} | ${amount(current.supplied)} | ${amount(
    supplyChange
  )} | ${amount(prior?.debt || 0)} | ${amount(current.debt)} | ${amount(debtChange)} | ${amount(
    current.cash
  )} | ${money(cashUsd)} | ${pct(coverage)} |`;
});

const watchRows = watch.map((u: any) => {
  const collateralBase = tokenAmount(u.totalCollateralBaseRaw, 18);
  const debtBase = tokenAmount(u.totalDebtBaseRaw, 18);
  return `| ${u.accountId || ''} | \`${u.evmAddress}\` | ${hf(u.healthFactorRaw).toFixed(6)} | ${amount(
    collateralBase
  )} | ${amount(debtBase)} |`;
});

const walletA = '0x9A4966152F6e10b33Cb7a37975e8619816d6a494';
const walletB = '0x00000000000000000000000000000000000A6E57';
const beforeDate = before.metadata.blockTimestampISO;
const afterDate = after.metadata.blockTimestampISO;
const outPath = path.join(path.dirname(afterPath), `position-snapshot-comparison-${after.metadata.block}.md`);

const report = `# Bonzo position snapshot comparison

**Baseline:** block ${before.metadata.block}, ${beforeDate}  
**Current:** block ${after.metadata.block}, ${afterDate}  
**Generated:** ${new Date().toISOString()}  
**Status:** Read-only decision-support snapshot. No reopening or transaction is authorised by this report.

## Executive summary

The current snapshot contains **${after.summary.usersWithPosition.toLocaleString()} users with positions** and **${currentBorrowers.length.toLocaleString()} borrowers**. Based on account data reconstructed from Bonzo's block-pinned oracle prices, reserve settings, and user balances, **${underwater.length} borrowers have HF at or below 1.00** and **${close.length} additional borrowers are above 1.00 but at or below 1.10**.

Using the same fixed investigation prices in both snapshots, aggregate supplied positions changed from **${money(
  beforeTotals.supplyUsd
)} to ${money(afterTotals.supplyUsd)}**, while aggregate debt changed from **${money(
  beforeTotals.borrowUsd
)} to ${money(afterTotals.borrowUsd)}**. These are comparison values, not current market valuations and not cash available for withdrawal.

The main reopening constraint is reserve liquidity, not aggregate accounting value. Cash is isolated by reserve. Unrestricted reopening would let withdrawals consume each reserve's available liquidity on a first-come-first-served basis. Debt, including incident debt, is not withdrawable inventory.

## Snapshot integrity and interpretation

| Check | Baseline | Current |
|---|---:|---:|
| Addresses queried | ${before.summary.usersQueried.toLocaleString()} | ${after.summary.usersQueried.toLocaleString()} |
| Successful reads | ${before.summary.usersSucceeded.toLocaleString()} | ${after.summary.usersSucceeded.toLocaleString()} |
| Users with positions | ${before.summary.usersWithPosition.toLocaleString()} | ${after.summary.usersWithPosition.toLocaleString()} |
| Non-zero reserve positions | ${before.summary.nonZeroPositions.toLocaleString()} | ${after.summary.nonZeroPositions.toLocaleString()} |
| Missing users | ${before.summary.usersMissing} | ${after.summary.usersMissing} |

The baseline block is 51 seconds before Wallet A's 250 SAUCE deposit and approximately 12 minutes before the abnormal oracle update. It is a clean pre-incident baseline, but not a snapshot after the attacker's collateral deposit. The address list was assembled after the incident and includes the known incident accounts, which is why those addresses can be queried at the earlier block.

Position token balances and debt-token balances are block-pinned on-chain values. USD comparisons use the fixed investigation prices stored in the snapshot. Health factors are reconstructed using the same Aave V2 arithmetic from block-pinned Bonzo oracle prices and reserve configuration. They therefore depend on the protocol oracle state at the current block.

### Why aggregate supply declined

The **${moneyExact(-aggregateSupplyChange)}** decline in aggregate supplied value is almost entirely explained by the abnormal liquidations of accounts **0.0.7951** and **0.0.1988666**. Their HBARX collateral left Bonzo during the liquidations, reducing their supplied positions by the following amounts at the fixed comparison prices:

| Account | Supply reduction |
|---|---:|
| 0.0.7951 | ${moneyExact(-account7951SupplyChange)} |
| 0.0.1988666 | ${moneyExact(-account1988666SupplyChange)} |
| **Combined** | **${moneyExact(confirmedLiquidationSupplyReduction)}** |

Together, the two accounts explain **${confirmedLiquidationShare.toFixed(3)}%** of the net aggregate supply decline. Across the whole protocol, HBARX supplied value fell by **${moneyExact(-hbarxSupplyChange)}**, while all other reserves collectively increased by **${moneyExact(otherReserveSupplyChange)}**, producing the net **${moneyExact(-aggregateSupplyChange)}** decline.

The supply reduction was caused by collateral leaving the protocol during the liquidations. The bad debt is the debt that remained after that collateral was removed. Bad debt itself does not reduce the aggregate supply figure.

## Health-factor distribution now

| Bucket | Borrowers | Interpretation |
|---|---:|---|
${healthBuckets.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n')}

“Underwater” in this report means protocol health factor at or below 1.00. It does not mean the debt is necessarily unrecoverable, and it does not distinguish incident accounts from ordinary borrowers.

## Reviewed accounts, abnormal liquidations, and bad debt

### 0.0.7951: victim of an abnormal-window liquidation

Account \`0.0.7951\`, EVM address \`0x0000000000000000000000000000000000001f0f\`, did not withdraw its HBARX. At block \`97,504,708\`, while the abnormal SAUCE observation was active, liquidator contract \`0.0.10373446\` repaid only **0.00025 SAUCE** and received **8,831,379.20338281 HBARX** from this account's collateral. The HBARX was worth approximately **$856,644** at the fixed investigation price of $0.097.

| Position | Before incident | Current |
|---|---:|---:|
| HBARX collateral | 8,850,964.108716 | 19,586.265513 |
| SAUCE debt | 1,185,485.622846 | 1,185,764.815121 |
| WHBAR debt | 6,600,380.066682 | 6,668,772.657025 |
| Health factor | Not captured in baseline | 0.002728 |

The abnormal SAUCE price made the account's SAUCE debt appear catastrophically valuable. This enabled the liquidation calculation to exchange 0.00025 SAUCE for nearly all of the account's HBARX collateral while leaving its debt effectively intact.

At the fixed comparison prices, the account now has approximately **$483,140 of debt** and **$1,906 of eligible collateral**, an indicative shortfall of **$481,235**. It should be classified as incident-created bad debt.

The liquidation transaction was \`0x1b8aad8b986d0865cfa6487cc22595a43b4380d1894aadd36b346a963b659575\`. The liquidator contract forwarded approximately **8,831,379.20334790 HBARX** to operator account \`0.0.10279946\`, EVM alias \`0xfa58afd6386e09984d0486febd1282170b8fc0fa\`. That account no longer holds the HBARX. There is currently no evidence connecting this operator to Wallet A or Wallet B.

### 0.0.1988666: second confirmed bad-debt account

Account \`0.0.1988666\`, EVM address \`0x00000000000000000000000000000000001e583a\`, was liquidated by the same contract at block \`97,504,716\`. The liquidator repaid only **0.000011 SAUCE** and received **388,580.68494884 HBARX**, worth approximately **$37,692** at the fixed HBARX price of $0.097.

| Position | Before incident | Current |
|---|---:|---:|
| HBARX collateral | 395,972.427153 | 7,393.805358 |
| SAUCE debt | 0.000240 | 0.000230 |
| WHBAR debt | 213,103.352444 | 215,311.511692 |
| BONZO debt | 304,665.672845 | 304,768.331805 |
| Health factor | Not captured in baseline | 0.039419 |

The liquidation transaction was \`0x126281260b59c27919479caa81836f37743a10476fa6a96a17376c1cabeff2ab\`. Approximately **388,580.68494729 HBARX** was forwarded to operator account \`0.0.10279946\`. At the fixed comparison prices, this account now has approximately **$18,424 of debt** and **$1,029 of eligible collateral**, an indicative shortfall of **$17,396**. It should also be classified as incident-created bad debt.

Together, these two confirmed abnormal-liquidation accounts represent an indicative current shortfall of approximately **$498,630** at the fixed prices. This is not a final accounting loss because recoveries, collateral realisability, accrued interest, and any additional abnormal liquidations remain to be reconciled.

This was not isolated. There were **51 successful liquidation events** during the abnormal oracle window. Contract \`0.0.10373446\` executed **28** of them and collected approximately **9.33 million HBARX**, plus other collateral. A complete incident reconciliation must therefore include abnormal liquidations, not only Wallet A and Wallet B's borrowing.

### 0.0.7572736 and 0.0.5825867: genuine near-threshold positions

Neither account submitted a transaction or was liquidated between the baseline and current snapshots. Their principal token positions are unchanged; the small balance changes are consistent with supply and debt interest accrual. There is no evidence that either account participated in the exploit or suffered an abnormal-window collateral seizure.

| Account | Current HF | Main eligible collateral | Current debt | Fixed-price supplied value | Conclusion |
|---|---:|---|---|---:|---|
| 0.0.7572736 | 1.022167 | 625,109.918030 SAUCE and 235,883.544384 WHBAR | 15,954.721991 USDC | Approximately $25,119 | Near threshold; no incident activity |
| 0.0.5825867 | 1.030767 | 528,121.367752 SAUCE and 197,736.044339 WHBAR | 13,298.237334 USDC | Approximately $22,993 including non-collateral supplies | Near threshold; no incident activity |

The fixed SAUCE price used in the snapshot comparison is **$0.01376845**. Health factors use Bonzo's block-pinned oracle values rather than the fixed USD comparison prices.

At the current pinned prices and with other inputs unchanged, an additional SAUCE price decline of approximately **6.4%** would take \`0.0.7572736\` to HF 1.00. The corresponding decline for \`0.0.5825867\` is approximately **8.7%**. Debt interest or a change in the USDC/HBAR oracle rate can also reduce those buffers.

### Borrowers at HF 1.25 or below

| Hedera account | EVM address | Health factor | Collateral base | Debt base |
|---|---|---:|---:|---:|
${watchRows.length ? watchRows.join('\n') : '| None | | | | |'}

The base-value columns are the LendingPool's 18-decimal base currency values. They are useful for reproducing the health-factor calculation, but should not be treated as independent market-price evidence.

## Reserve liquidity and debt comparison

| Reserve | Supply before | Supply now | Supply change | Debt before | Debt now | Debt change | Cash now | Cash USD at fixed price | Immediate coverage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${reserveTable.join('\n')}

“Cash now” is the reserve's current available liquidity. “Debt now” is stable plus variable debt. Immediate coverage is cash divided by total aToken supply for that reserve. The USD column uses fixed investigation prices only. Assets cannot be assumed interchangeable across reserves.

## Incident-account reconciliation

Wallet A submitted the abnormal SAUCE update and borrowed approximately 6.635 million USDC and 34.518 million WHBAR in principal. Wallet B borrowed assets during the abnormal window, later contacted the team as a white-hat responder, and must remain a separate recovery position. Current debt includes interest and any later activity, so current balances must not be described as incident principal without this reconciliation.

### Wallet A, 0.0.10633526

${actorTable(walletA)}

### Wallet B, 0.0.683607

${actorTable(walletB)}

## Reopening decision framework

The data does not support an unrestricted reopening by itself. Before enabling withdrawals or redemptions, the team should decide and document all of the following:

1. **Recovery reconciliation.** Record returned assets and repayments separately for Wallet A and Wallet B, then split current debt into pre-existing principal, incident principal, accrued interest, and later activity.
2. **Reserve-specific liquidity gates.** Set minimum post-withdrawal cash floors and withdrawal capacity per reserve. Do not use a protocol-wide percentage because liquidity is not fungible across reserves.
3. **Liquidation treatment.** Decide whether liquidations remain disabled during a grace period. The ${underwater.length} accounts at or below HF 1.00 could otherwise be liquidated immediately under normal rules, which would change collateral ownership and reserve balances during reopening.
4. **Near-threshold borrower process.** Notify or otherwise handle the ${close.length} accounts between HF 1.00 and 1.10 before normal liquidation behaviour resumes.
5. **Withdrawal ordering.** Avoid a first-come-first-served race for reserves with poor immediate coverage. Use a controlled window, caps, or a claims process if full liquidity is unavailable.
6. **Fresh-state verification.** Re-run the current snapshot immediately before any governance or admin action. Confirm pause state, oracle implementation and prices, reserve cash, total debt, HF distribution, and any recovery transfers at one new pinned block.
7. **Coverage validation.** Treat any reserve below 99% address-list coverage as incomplete for user-level allocation. Refresh the address universe before using this data to calculate individual redemption entitlements.

## Source artifacts

- Baseline JSON: \`${path.relative(process.cwd(), beforePath)}\`
- Current JSON: \`${path.relative(process.cwd(), afterPath)}\`
- Current position CSV: \`${path.relative(process.cwd(), afterPath.replace(/\.json$/, '.csv'))}\`
- Current user/HF CSV: \`${path.relative(process.cwd(), afterPath.replace(/\.json$/, '-users.csv'))}\`
- Incident analysis: \`docs/Bonzo Hack Technical Analysis.md\`
- Post-incident inventory: \`docs/post-incident-inventory.md\`

This report is an internal timestamped investigation artifact. It must be refreshed before a reopening decision.
`;

fs.writeFileSync(outPath, report);
console.log(outPath);
