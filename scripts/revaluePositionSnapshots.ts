/**
 * Apply fixed USD prices to existing position snapshots without
 * re-querying the chain. Token balances, block metadata, and health factors are
 * unchanged. The position CSV is regenerated from the JSON source of truth.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/revaluePositionSnapshots.ts \
 *     scripts/out/snapshot-97504300.json scripts/out/snapshot-97608876.json
 */
import { ethers } from 'ethers';
const fs = require('fs');
const path = require('path');

const snapshotPaths = process.argv.slice(2);
if (!snapshotPaths.length) {
  throw new Error('Pass one or more snapshot JSON paths');
}

const SAUCE_USD = '0.01376845';
const PRICE_DECIMALS = 8;

function trimDecimal(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function decimalValue(raw: string, decimals: number): string {
  return trimDecimal(ethers.utils.formatUnits(raw, decimals));
}

function usdValue(raw: string, decimals: number, price: string): string {
  const scaledPrice = ethers.utils.parseUnits(price, PRICE_DECIMALS);
  return trimDecimal(
    ethers.utils.formatUnits(
      ethers.BigNumber.from(raw).mul(scaledPrice),
      decimals + PRICE_DECIMALS
    )
  );
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

for (const input of snapshotPaths) {
  const jsonPath = path.resolve(input);
  const snapshot = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  snapshot.metadata.valuation = {
    source: 'Fixed USD prices used for consistent snapshot comparison',
    pricesUsd: {
      ...snapshot.metadata.valuation.pricesUsd,
      SAUCE: SAUCE_USD,
    },
  };

  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');

  const columns = [
    'evmAddress',
    'accountId',
    'token',
    'tokenAddress',
    'supplyTokens',
    'supplyUsd',
    'borrowTokens',
    'borrowUsd',
    'stableBorrowTokens',
    'variableBorrowTokens',
    'usageAsCollateral',
  ];
  const rows = snapshot.positions.map((position: any) => {
    const price = snapshot.metadata.valuation.pricesUsd[position.token];
    const stableRaw = position.stableBorrowRaw || '0';
    const variableRaw = position.variableBorrowRaw || position.borrowRaw;
    return [
      position.evmAddress,
      position.accountId,
      position.token,
      position.tokenAddress,
      decimalValue(position.supplyRaw, position.decimals),
      usdValue(position.supplyRaw, position.decimals, price),
      decimalValue(position.borrowRaw, position.decimals),
      usdValue(position.borrowRaw, position.decimals, price),
      decimalValue(stableRaw, position.decimals),
      decimalValue(variableRaw, position.decimals),
      position.usageAsCollateral,
    ]
      .map(csvCell)
      .join(',');
  });
  const csvPath = jsonPath.replace(/\.json$/, '.csv');
  fs.writeFileSync(csvPath, columns.join(',') + '\n' + rows.join('\n') + '\n');
  console.log(`Updated ${jsonPath}`);
}
