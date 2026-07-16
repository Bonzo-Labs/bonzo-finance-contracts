/**
 * Generate a detailed Markdown report from the three definitive position CSVs.
 *
 * Usage:
 *   npx ts-node --transpile-only \
 *     scripts/position-snapshot/generatePositionSnapshotSummary.ts
 *
 * Read-only with respect to chain state. It reads the CSVs already present in
 * `out/` and replaces `out/position-snapshot-summary.md`.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');
const SUMMARY_FILE_NAME = 'position-snapshot-summary.md';
const WALLET_A = '0x9a4966152f6e10b33cb7a37975e8619816d6a494';
const WALLET_B = '0x00000000000000000000000000000000000a6e57';
// Transaction-level principal estimates from the canonical incident technical analysis.
// These are deliberately kept separate from snapshot debt, which includes indexed
// accrual and position changes outside the abnormal-oracle borrowing window.
const WALLET_A_INCIDENT_PRINCIPAL_USD = BigInt(9_050_125);
const WALLET_B_INCIDENT_PRINCIPAL_USD = BigInt(1_007_309);
const COMBINED_INCIDENT_PRINCIPAL_USD =
  WALLET_A_INCIDENT_PRINCIPAL_USD + WALLET_B_INCIDENT_PRINCIPAL_USD;

type SnapshotDefinition = {
  key: string;
  label: string;
  shortLabel: string;
  fileName: string;
  block: number;
  timestamp: string;
};

const DEFINITIONS: SnapshotDefinition[] = [
  {
    key: 'before',
    label: 'Before exploit',
    shortLabel: 'Before',
    fileName: '01-positions-before-exploit.csv',
    block: 97504300,
    timestamp: '2026-07-11T00:39:02.000Z',
  },
  {
    key: 'afterPause',
    label: 'After pause',
    shortLabel: 'After pause',
    fileName: '02-positions-after-pause.csv',
    block: 97506158,
    timestamp: '2026-07-11T01:40:58.000Z',
  },
  {
    key: 'afterRates',
    label: 'After interest-rate changes',
    shortLabel: 'After rates',
    fileName: '03-positions-after-interest-rate-changes.csv',
    block: 97702331,
    timestamp: '2026-07-15T14:40:32.000Z',
  },
];

type CsvData = { headers: string[]; rows: Record<string, string>[] };
type AssetTotals = {
  symbol: string;
  suppliedAmount: bigint;
  suppliedHbar: bigint;
  suppliedUsd: bigint;
  borrowedAmount: bigint;
  borrowedHbar: bigint;
  borrowedUsd: bigint;
  suppliers: number;
  borrowers: number;
  collateralUsers: number;
};
type SnapshotSummary = {
  definition: SnapshotDefinition;
  headers: string[];
  rows: Record<string, string>[];
  byAddress: Map<string, Record<string, string>>;
  symbols: string[];
  suppliedHbar: bigint;
  suppliedUsd: bigint;
  borrowedHbar: bigint;
  borrowedUsd: bigint;
  suppliers: number;
  borrowers: number;
  assets: Map<string, AssetTotals>;
};

function parseCsv(text: string): CsvData {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV ended inside a quoted cell');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    records.push(row);
  }
  if (records.length < 2) throw new Error('CSV must contain a header and at least one data row');
  const headers = records[0];
  const rows = records.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(
        `CSV row ${index + 2} has ${values.length} cells; expected ${headers.length}`
      );
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
  return { headers, rows };
}

function fixed(value: string | undefined, decimals: number): bigint {
  const text = String(value || '0').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal value: ${text}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  if (fraction.length > decimals) throw new Error(`${text} exceeds ${decimals} decimal places`);
  const raw =
    BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  return negative ? -raw : raw;
}

function grouped(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatFixed(value: bigint, decimals: number, maximumDecimals = decimals): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = absolute / unit;
  let fraction = (absolute % unit).toString().padStart(decimals, '0').slice(0, maximumDecimals);
  fraction = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${grouped(whole.toString())}${fraction ? `.${fraction}` : ''}`;
}

const money = (value: bigint) =>
  `${value < BigInt(0) ? '-' : ''}$${formatFixed(value < BigInt(0) ? -value : value, 2, 2)}`;
const hbar = (value: bigint) => `${formatFixed(value, 8, 2)} HBAR`;
const amount = (value: bigint) => formatFixed(value, 18, 6);
const deltaMoney = (value: bigint) =>
  `${value >= BigInt(0) ? '+' : '-'}$${formatFixed(value < BigInt(0) ? -value : value, 2, 2)}`;

function percentage(numerator: bigint, denominator: bigint): string {
  if (denominator === BigInt(0)) return 'n/a';
  const basisPoints = (numerator * BigInt(10_000)) / denominator;
  return `${formatFixed(basisPoints, 2, 2)}%`;
}

function summarizeCsv(definition: SnapshotDefinition, csv: CsvData): SnapshotSummary {
  const required = [
    'evmAddress',
    'hederaAccountId',
    'totalSuppliedValueHbar',
    'totalSuppliedValueUsd',
    'totalBorrowedValueHbar',
    'totalBorrowedValueUsd',
  ];
  for (const header of required)
    if (!csv.headers.includes(header))
      throw new Error(`${definition.fileName} is missing ${header}`);
  const symbols = csv.headers
    .filter((header) => header.endsWith('_suppliedAmount'))
    .map((header) => header.slice(0, -'_suppliedAmount'.length));
  if (!symbols.length) throw new Error(`${definition.fileName} has no asset columns`);
  const byAddress = new Map<string, Record<string, string>>();
  const assets = new Map<string, AssetTotals>();
  let suppliedHbar = BigInt(0);
  let suppliedUsd = BigInt(0);
  let borrowedHbar = BigInt(0);
  let borrowedUsd = BigInt(0);
  let suppliers = 0;
  let borrowers = 0;
  for (const row of csv.rows) {
    const address = row.evmAddress.toLowerCase();
    if (byAddress.has(address))
      throw new Error(`${definition.fileName} contains duplicate ${row.evmAddress}`);
    byAddress.set(address, row);
    const rowSupplyUsd = fixed(row.totalSuppliedValueUsd, 2);
    const rowBorrowUsd = fixed(row.totalBorrowedValueUsd, 2);
    suppliedHbar += fixed(row.totalSuppliedValueHbar, 8);
    suppliedUsd += rowSupplyUsd;
    borrowedHbar += fixed(row.totalBorrowedValueHbar, 8);
    borrowedUsd += rowBorrowUsd;
    if (rowSupplyUsd !== BigInt(0)) suppliers++;
    if (rowBorrowUsd !== BigInt(0)) borrowers++;
  }
  for (const symbol of symbols) {
    const totals: AssetTotals = {
      symbol,
      suppliedAmount: BigInt(0),
      suppliedHbar: BigInt(0),
      suppliedUsd: BigInt(0),
      borrowedAmount: BigInt(0),
      borrowedHbar: BigInt(0),
      borrowedUsd: BigInt(0),
      suppliers: 0,
      borrowers: 0,
      collateralUsers: 0,
    };
    for (const row of csv.rows) {
      const suppliedAmount = fixed(row[`${symbol}_suppliedAmount`], 18);
      const borrowedAmount = fixed(row[`${symbol}_borrowedAmount`], 18);
      totals.suppliedAmount += suppliedAmount;
      totals.suppliedHbar += fixed(row[`${symbol}_suppliedValueHbar`], 8);
      totals.suppliedUsd += fixed(row[`${symbol}_suppliedValueUsd`], 2);
      totals.borrowedAmount += borrowedAmount;
      totals.borrowedHbar += fixed(row[`${symbol}_borrowedValueHbar`], 8);
      totals.borrowedUsd += fixed(row[`${symbol}_borrowedValueUsd`], 2);
      if (suppliedAmount !== BigInt(0)) totals.suppliers++;
      if (borrowedAmount !== BigInt(0)) totals.borrowers++;
      if (suppliedAmount !== BigInt(0) && row[`${symbol}_usedAsCollateral`] === 'true')
        totals.collateralUsers++;
    }
    assets.set(symbol, totals);
  }
  return {
    definition,
    headers: csv.headers,
    rows: csv.rows,
    byAddress,
    symbols,
    suppliedHbar,
    suppliedUsd,
    borrowedHbar,
    borrowedUsd,
    suppliers,
    borrowers,
    assets,
  };
}

function snapshotTable(snapshots: SnapshotSummary[]): string {
  return [
    '| Snapshot | Block | Users | Suppliers | Borrowers | Supplied USD | Borrowed USD | Supplied HBAR | Borrowed HBAR | Debt / supply |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...snapshots.map(
      (snapshot) =>
        `| ${snapshot.definition.label} | ${snapshot.definition.block} | ${grouped(
          snapshot.rows.length.toString()
        )} | ${grouped(snapshot.suppliers.toString())} | ${grouped(
          snapshot.borrowers.toString()
        )} | ${money(snapshot.suppliedUsd)} | ${money(snapshot.borrowedUsd)} | ${hbar(
          snapshot.suppliedHbar
        )} | ${hbar(snapshot.borrowedHbar)} | ${percentage(
          snapshot.borrowedUsd,
          snapshot.suppliedUsd
        )} |`
    ),
  ].join('\n');
}

function reserveTable(snapshots: SnapshotSummary[]): string {
  const symbols = snapshots[0].symbols;
  return [
    '| Asset | Before supplied | Before borrowed | After-pause supplied | After-pause borrowed | After-rates supplied | After-rates borrowed | Suppliers after rates | Borrowers after rates |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...symbols.map((symbol) => {
      const values = snapshots.map((snapshot) => snapshot.assets.get(symbol)!);
      return `| ${symbol} | ${money(values[0].suppliedUsd)} | ${money(
        values[0].borrowedUsd
      )} | ${money(values[1].suppliedUsd)} | ${money(values[1].borrowedUsd)} | ${money(
        values[2].suppliedUsd
      )} | ${money(values[2].borrowedUsd)} | ${grouped(values[2].suppliers.toString())} | ${grouped(
        values[2].borrowers.toString()
      )} |`;
    }),
  ].join('\n');
}

function reserveDeltaTable(from: SnapshotSummary, to: SnapshotSummary): string {
  return [
    '| Asset | Supplied amount change | Supplied USD change | Borrowed amount change | Borrowed USD change |',
    '|---|---:|---:|---:|---:|',
    ...from.symbols.map((symbol) => {
      const before = from.assets.get(symbol)!;
      const after = to.assets.get(symbol)!;
      return `| ${symbol} | ${amount(after.suppliedAmount - before.suppliedAmount)} | ${deltaMoney(
        after.suppliedUsd - before.suppliedUsd
      )} | ${amount(after.borrowedAmount - before.borrowedAmount)} | ${deltaMoney(
        after.borrowedUsd - before.borrowedUsd
      )} |`;
    }),
  ].join('\n');
}

type AccountDelta = {
  address: string;
  accountId: string;
  supplyDelta: bigint;
  borrowDelta: bigint;
};

function accountDeltas(from: SnapshotSummary, to: SnapshotSummary): AccountDelta[] {
  const addresses = new Set([...from.byAddress.keys(), ...to.byAddress.keys()]);
  return [...addresses].map((address) => {
    const before = from.byAddress.get(address);
    const after = to.byAddress.get(address);
    return {
      address,
      accountId: after?.hederaAccountId || before?.hederaAccountId || '',
      supplyDelta: fixed(after?.totalSuppliedValueUsd, 2) - fixed(before?.totalSuppliedValueUsd, 2),
      borrowDelta: fixed(after?.totalBorrowedValueUsd, 2) - fixed(before?.totalBorrowedValueUsd, 2),
    };
  });
}

function topAccountTable(
  deltas: AccountDelta[],
  field: 'supplyDelta' | 'borrowDelta',
  direction: 'increase' | 'decrease'
): string {
  const sign = direction === 'increase' ? BigInt(1) : -BigInt(1);
  const selected = deltas
    .filter((delta) => delta[field] * sign > BigInt(0))
    .sort((a, b) => {
      const left = a[field] * sign;
      const right = b[field] * sign;
      return left === right ? a.address.localeCompare(b.address) : left > right ? -1 : 1;
    })
    .slice(0, 10);
  if (!selected.length) return '_No accounts in this category._';
  return [
    '| Hedera account | EVM address | Supplied USD change | Borrowed USD change |',
    '|---|---|---:|---:|',
    ...selected.map(
      (delta) =>
        `| ${delta.accountId || ''} | \`${delta.address}\` | ${deltaMoney(
          delta.supplyDelta
        )} | ${deltaMoney(delta.borrowDelta)} |`
    ),
  ].join('\n');
}

function walletTable(snapshots: SnapshotSummary[], address: string): string {
  const rows = snapshots.map((snapshot) => snapshot.byAddress.get(address));
  if (rows.every((row) => !row)) return `_Address \`${address}\` is absent from all three CSVs._`;
  const aggregate = [
    '| Snapshot | Hedera account | Supplied USD | Borrowed USD | Supplied HBAR | Borrowed HBAR |',
    '|---|---|---:|---:|---:|---:|',
    ...snapshots.map((snapshot, index) => {
      const row = rows[index];
      return `| ${snapshot.definition.label} | ${row?.hederaAccountId || ''} | ${money(
        fixed(row?.totalSuppliedValueUsd, 2)
      )} | ${money(fixed(row?.totalBorrowedValueUsd, 2))} | ${hbar(
        fixed(row?.totalSuppliedValueHbar, 8)
      )} | ${hbar(fixed(row?.totalBorrowedValueHbar, 8))} |`;
    }),
  ].join('\n');
  const positionRows = snapshots[0].symbols
    .filter((symbol) =>
      rows.some(
        (row) =>
          fixed(row?.[`${symbol}_suppliedAmount`], 18) !== BigInt(0) ||
          fixed(row?.[`${symbol}_borrowedAmount`], 18) !== BigInt(0)
      )
    )
    .map((symbol) => {
      const cells = rows.flatMap((row) => [
        amount(fixed(row?.[`${symbol}_suppliedAmount`], 18)),
        amount(fixed(row?.[`${symbol}_borrowedAmount`], 18)),
      ]);
      return `| ${symbol} | ${cells.join(' | ')} |`;
    });
  const positions = [
    '| Asset | Before supplied | Before borrowed | After-pause supplied | After-pause borrowed | After-rates supplied | After-rates borrowed |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...positionRows,
  ].join('\n');
  return `${aggregate}\n\n${positions}`;
}

function renderReport(snapshots: SnapshotSummary[]): string {
  const [before, afterPause, afterRates] = snapshots;
  const incidentDeltas = accountDeltas(before, afterPause);
  const postPauseDeltas = accountDeltas(afterPause, afterRates);
  const changed = (deltas: AccountDelta[]) =>
    deltas.filter((delta) => delta.supplyDelta !== BigInt(0) || delta.borrowDelta !== BigInt(0))
      .length;
  const commonSchema = snapshots.every(
    (snapshot) => JSON.stringify(snapshot.headers) === JSON.stringify(before.headers)
  );
  const hasHealthFactors = snapshots.every((snapshot) => snapshot.headers.includes('healthFactor'));
  const pauseSnapshotDelta = afterPause.borrowedUsd - before.borrowedUsd;
  const laterSnapshotDelta = afterRates.borrowedUsd - afterPause.borrowedUsd;
  return `# Bonzo position snapshot summary

Generated: ${new Date().toISOString()}

## Executive summary

The three snapshots contain ${grouped(
    before.rows.length.toString()
  )} position-holding accounts before Wallet A's exploit borrows, ${grouped(
    afterPause.rows.length.toString()
  )} immediately after the pool was paused, and ${grouped(
    afterRates.rows.length.toString()
  )} after the interest-rate changes. The middle snapshot is block ${
    afterPause.definition.block
  }, which contains the successful \`setPoolPause(true)\` transaction after both incident wallets' borrowing activity. Its aggregate borrowed-value increase of **${deltaMoney(
    pauseSnapshotDelta
  )}** spans the abnormal-oracle window, but it is an accounting-position delta rather than a transaction-level principal or final-loss figure.

The transaction-level incident analysis identifies exactly two SAUCE-collateral borrowers during that window. Their rough combined principal was **$${grouped(
    COMBINED_INCIDENT_PRINCIPAL_USD.toString()
  )}**: approximately **$${grouped(
    WALLET_A_INCIDENT_PRINCIPAL_USD.toString()
  )}** for Wallet A and **$${grouped(
    WALLET_B_INCIDENT_PRINCIPAL_USD.toString()
  )}** for Wallet B. Wallet B's position is treated separately as recoverable because it contacted the team as a white-hat responder and stated an intention to return the funds.

The later aggregate change of **${deltaMoney(
    laterSnapshotDelta
  )}** begins after the pause and spans subsequent position evolution through the post-rate snapshot. Both snapshot deltas include debt-index accrual and other account changes between their blocks. USD and HBAR figures are comparison values, not contemporaneous market values or reserve liquidity.

${snapshotTable(snapshots)}

## Snapshot boundaries and integrity

| Snapshot | Source file | Block | UTC timestamp | Rows | Columns |
|---|---|---:|---|---:|---:|
${snapshots
  .map(
    (snapshot) =>
      `| ${snapshot.definition.label} | \`${snapshot.definition.fileName}\` | ${
        snapshot.definition.block
      } | ${snapshot.definition.timestamp} | ${grouped(snapshot.rows.length.toString())} | ${
        snapshot.headers.length
      } |`
  )
  .join('\n')}

- All three files use ${commonSchema ? 'the same' : 'different'} column schema${
    commonSchema ? '' : 's'
  }.
- Every CSV has one unique row per EVM address.
- Stable debt is intentionally absent because Bonzo has kept stable-rate borrowing disabled since inception.
- ${
    hasHealthFactors
      ? 'The healthFactor column is the block-pinned protocol health factor returned by LendingPool.getUserAccountData. It does not use the fixed investigation prices.'
      : 'These CSVs do not contain health factors.'
  }
- These CSVs do not contain reserve cash or liquidation thresholds. This report does not infer those values.

## Reserve-level positions

${reserveTable(snapshots)}

## Changes through the pool pause

Across this interval, **${grouped(
    changed(incidentDeltas).toString()
  )} accounts** had a supplied-value or borrowed-value change at the CSV's fixed prices. This interval includes both Wallet A and Wallet B, but its aggregate position changes must not be substituted for the transaction-level incident-principal figures above.

| Metric | Change |
|---|---:|
| Aggregate supplied USD | ${deltaMoney(afterPause.suppliedUsd - before.suppliedUsd)} |
| Aggregate borrowed USD | ${deltaMoney(afterPause.borrowedUsd - before.borrowedUsd)} |
| Aggregate supplied HBAR | ${hbar(afterPause.suppliedHbar - before.suppliedHbar)} |
| Aggregate borrowed HBAR | ${hbar(afterPause.borrowedHbar - before.borrowedHbar)} |

${reserveDeltaTable(before, afterPause)}

### Largest borrowed-value increases

${topAccountTable(incidentDeltas, 'borrowDelta', 'increase')}

### Largest supplied-value decreases

${topAccountTable(incidentDeltas, 'supplyDelta', 'decrease')}

## Changes between the pool pause and the post-rate snapshot

Across this interval, **${grouped(
    changed(postPauseDeltas).toString()
  )} accounts** had a supplied-value or borrowed-value change. The interval includes several days of indexed position evolution and the stored-rate refresh. These deltas must not be attributed solely to the rate-change transactions.

| Metric | Change |
|---|---:|
| Aggregate supplied USD | ${deltaMoney(afterRates.suppliedUsd - afterPause.suppliedUsd)} |
| Aggregate borrowed USD | ${deltaMoney(afterRates.borrowedUsd - afterPause.borrowedUsd)} |
| Aggregate supplied HBAR | ${hbar(afterRates.suppliedHbar - afterPause.suppliedHbar)} |
| Aggregate borrowed HBAR | ${hbar(afterRates.borrowedHbar - afterPause.borrowedHbar)} |

${reserveDeltaTable(afterPause, afterRates)}

### Largest borrowed-value increases

${topAccountTable(postPauseDeltas, 'borrowDelta', 'increase')}

### Largest supplied-value increases

${topAccountTable(postPauseDeltas, 'supplyDelta', 'increase')}

## Incident wallets

### Wallet A: 0.0.10633526

${walletTable(snapshots, WALLET_A)}

### Wallet B: 0.0.683607

Wallet B is shown separately because it contacted the team as a white-hat responder. Its positions should not be combined with Wallet A without return and reconciliation evidence.

${walletTable(snapshots, WALLET_B)}

## Interpretation limits

- Supplied positions and outstanding debt are accounting positions. Outstanding debt is not cash available for supplier withdrawals.
- Values use the same fixed investigation prices across all three snapshots so the abnormal incident oracle observation cannot distort comparisons.
- Rounding occurs in the source CSVs: USD values are cents and HBAR values use up to eight decimals. Totals in this report sum those displayed cells exactly.
- Account-level changes identify where positions moved. They do not establish transaction intent, actor identity, recoverability, or causation by themselves.
`;
}

function generatePositionSnapshotSummary(outputDirectory = OUT_DIR): string {
  const snapshots = DEFINITIONS.map((definition) => {
    const input = path.join(outputDirectory, definition.fileName);
    if (!fs.existsSync(input)) throw new Error(`Missing required snapshot CSV: ${input}`);
    return summarizeCsv(definition, parseCsv(fs.readFileSync(input, 'utf8')));
  });
  const output = path.join(outputDirectory, SUMMARY_FILE_NAME);
  fs.writeFileSync(output, renderReport(snapshots));
  return output;
}

if (require.main === module) {
  try {
    const output = generatePositionSnapshotSummary();
    console.log(`Wrote ${output}`);
  } catch (error: any) {
    console.error(`Summary generation failed: ${error?.message || error}`);
    process.exit(1);
  }
}

export {
  DEFINITIONS,
  SUMMARY_FILE_NAME,
  fixed,
  formatFixed,
  generatePositionSnapshotSummary,
  parseCsv,
  renderReport,
  summarizeCsv,
};
