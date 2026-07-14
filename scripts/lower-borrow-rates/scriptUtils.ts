import fs from 'fs';
import { Contract } from 'ethers';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function eqAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function readJson<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function recordRateUpdateStep(
  state: any,
  symbol: string,
  phase: 'deploy' | 'wire',
  data: Record<string, unknown>,
  archivedAt = new Date().toISOString()
) {
  state.reserves = state.reserves || {};
  state.reserves[symbol] = state.reserves[symbol] || {};

  if (phase === 'deploy') {
    const previous = state.reserves[symbol];
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    if (previous.deploy || previous.wire) {
      history.push({ archivedAt, deploy: previous.deploy, wire: previous.wire });
    }
    state.reserves[symbol] = { history, deploy: { ...data, completed: true } };
  } else {
    state.reserves[symbol].wire = { ...data, completed: true };
  }

  return state;
}

export async function contractAs(
  hre: any,
  artifactName: string,
  address: string,
  signerOrProvider: any
) {
  const artifact = await hre.artifacts.readArtifact(artifactName);
  return new Contract(address, artifact.abi, signerOrProvider);
}

const RETRIABLE_READ = new Set([
  'eth_call',
  'eth_getCode',
  'eth_chainId',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_getBlockByNumber',
  'eth_getStorageAt',
  'net_version',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_estimateGas',
  'eth_getLogs',
]);

function isTransient(error: any): boolean {
  const message = `${error?.message || ''} ${error?.error?.message || ''} ${
    typeof error?.body === 'string' ? error.body : JSON.stringify(error?.body || '')
  }`.toLowerCase();
  if (message.includes('execution reverted') || message.includes('revert')) return false;
  if (
    message.includes('insufficient_tx_fee') ||
    message.includes('insufficient transaction fee') ||
    message.includes('transaction underpriced') ||
    message.includes('max fee per gas less than block base fee')
  ) {
    return false;
  }
  const status = error?.status ?? error?.error?.status;
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (['SERVER_ERROR', 'TIMEOUT', 'NETWORK_ERROR'].includes(error?.code)) return true;
  return (
    message.includes('429') ||
    message.includes('too many requests') ||
    message.includes('rate limit')
  );
}

// Retry only idempotent JSON-RPC reads. Signed transaction broadcasts are
// deliberately never retried.
export function withRetry<T extends { send: (method: string, params: any[]) => Promise<any> }>(
  provider: T,
  maxRetries = 6,
  baseDelayMs = 400
): T {
  const send = provider.send.bind(provider);
  (provider as any).send = async (method: string, params: any[]) => {
    if (!RETRIABLE_READ.has(method)) return send(method, params);
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await send(method, params);
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || !isTransient(error)) throw error;
        const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
        console.warn(
          `  rpc ${method} throttled/transient - retry ${attempt + 1}/${maxRetries} in ${delay}ms`
        );
        await sleep(delay);
      }
    }
    throw lastError;
  };
  return provider;
}
