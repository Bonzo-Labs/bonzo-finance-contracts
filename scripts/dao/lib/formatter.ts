import type { EncodedAction } from '../types';

export const asStdoutBlock = (actions: EncodedAction[]): string => {
  const rows = actions.map((a, i) => [
    `--- action[${i}] (${a.kind}) → ${a.targetSafe} Safe`,
    `  to:            ${a.to}`,
    `  value:         ${a.value}`,
    `  data:          ${a.data}`,
    `  description:   ${a.description}`,
    `  expectedEvents: ${a.expectedEvents.join(', ') || '(none)'}`,
  ]);
  return rows.map((r) => r.join('\n')).join('\n');
};

export const asSafeUiBlock = (actions: EncodedAction[]): string => {
  // Paste-ready block for multisig.hedera.foundation "Contract interaction"
  return actions
    .map(
      (a, i) =>
        [
          `# Bundle action ${i + 1} / ${actions.length}: ${a.description}`,
          `to:    ${a.to}`,
          `value: ${a.value}`,
          `data:  ${a.data}`,
        ].join('\n')
    )
    .join('\n\n');
};

export const hashscanLink = (chain_type: string, txId: string): string => {
  const net = chain_type === 'hedera_mainnet' ? 'mainnet' : 'testnet';
  return `https://hashscan.io/${net}/transaction/${txId}`;
};

export const diffTable = (before: Record<string, unknown>, after: Record<string, unknown>): string => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: string[] = ['  key | before → after'];
  for (const k of Array.from(keys).sort()) {
    const b = String(before[k] ?? '');
    const a = String(after[k] ?? '');
    rows.push(`  ${k} | ${b} → ${a}${b === a ? ' (unchanged)' : ''}`);
  }
  return rows.join('\n');
};
