/**
 * Discover EVERY holder of every aToken / debt token up to a block (read-only)
 * -------------------------------------------------------------------------
 * The snapshot's coverage check told us the supplied address list is a few
 * holders short in several reserves. This finds who is missing, from first
 * principles rather than from any external list.
 *
 * GROUND TRUTH: an aToken (or debt token) balance can only ever come into
 * existence through an ERC20 `Transfer` event - a mint is Transfer(0x0 -> user),
 * a transfer is Transfer(user -> user). So the set of every address that has
 * EVER appeared in the `to` field of a Transfer, across every aToken and debt
 * token, is a strict SUPERSET of everyone who could hold a position at the
 * target block. Scan those logs and you cannot miss a holder.
 *
 * (We also collect `from` addresses. They are redundant in theory - you cannot
 * send what you never received - but they cost nothing and guard against an
 * exotic mint path that bypasses the zero-address convention.)
 *
 * WHY eth_getLogs AND NOT THE MIRROR NODE REST API: the mirror node refuses a
 * topic-filtered log query spanning more than 7 days, and these tokens span
 * ~14 months. eth_getLogs has no such limit, only a per-request block span cap,
 * which differs per provider - so each RPC shard auto-tunes its own chunk size
 * downward until requests succeed.
 *
 * OUTPUT: the union of discovered holders and the existing CSV, written as a
 * complete address list. Feed that back into snapshotPositions.ts - the
 * checkpoint means only the newly discovered addresses actually get fetched.
 *
 * Read-only. No signer.
 *
 * Usage:
 *   CHAIN_TYPE=hedera_mainnet npx hardhat run scripts/position-snapshot/discoverHolders.ts
 */
import { ethers } from 'hardhat';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BLOCK = Number(process.env.SNAPSHOT_BLOCK || 97504300);
const MIRROR = 'https://mainnet-public.mirrornode.hedera.com';

const RPC_URLS: string[] = (
  process.env.RPC_URLS ||
  process.env.PROVIDER_URL_MAINNET ||
  'https://mainnet.hashio.io/api'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const REPO_ROOT = path.resolve(__dirname, '../..');
const ADDRESSES_CSV =
  process.env.ADDRESSES_CSV || path.join(REPO_ROOT, 'userPositionAddressesMainnet.csv');
const OUT_DIR = path.join(__dirname, 'out');
const SNAPSHOT_JSON = path.join(OUT_DIR, `snapshot-${BLOCK}.json`);

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');
const ZERO = '0x0000000000000000000000000000000000000000';

const maskRpc = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '***';
  }
};

type Shard = {
  url: string;
  provider: ethers.providers.JsonRpcProvider;
  span: number; // per-request block span this endpoint tolerates; auto-tuned down
  busy: boolean;
};

const shards: Shard[] = RPC_URLS.map((url) => ({
  url,
  provider: new ethers.providers.JsonRpcProvider(url),
  span: 100_000,
  busy: false,
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry across shards with backoff. Paid endpoints still 429 under a burst, and
 * a bare setup call that dies takes the whole run with it.
 */
async function anyShard<T>(fn: (p: ethers.providers.JsonRpcProvider) => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < 8; i++) {
    const shard = shards[i % shards.length]; // rotate: spread the burst
    try {
      return await fn(shard.provider);
    } catch (e: any) {
      lastErr = e;
      await sleep(Math.min(500 * 2 ** i, 10_000));
    }
  }
  throw lastErr;
}

/** Mirror-node GET with backoff - the public node rate-limits under a burst. */
async function mnGet(url: string): Promise<any> {
  let lastErr: any;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429 || r.status >= 500) throw new Error(`mirror ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(500 * 2 ** i, 8000));
    }
  }
  throw lastErr;
}

/** Contract creation block, so we never scan blocks before the token existed. */
async function creationBlock(address: string): Promise<number> {
  const info = await mnGet(`${MIRROR}/api/v1/contracts/${address}`);
  const ts = info?.created_timestamp;
  if (!ts) throw new Error(`no created_timestamp for ${address}`);
  const blk = await mnGet(`${MIRROR}/api/v1/blocks?timestamp=lte:${ts}&order=desc&limit=1`);
  return blk.blocks[0].number;
}

/**
 * Scan [from, to] for Transfer logs on one contract, chunked to whatever span
 * the shard tolerates. On a range rejection we halve that shard's span and
 * retry, so a provider with a tighter cap self-corrects instead of failing.
 */
async function scanRange(
  shard: Shard,
  address: string,
  from: number,
  to: number,
  sink: Set<string>
): Promise<number> {
  let found = 0;
  let cursor = from;
  let attempts = 0;

  while (cursor <= to) {
    const end = Math.min(cursor + shard.span - 1, to);
    try {
      const logs = await shard.provider.getLogs({
        address,
        topics: [TRANSFER_TOPIC],
        fromBlock: cursor,
        toBlock: end,
      });
      for (const l of logs) {
        // topics[1] = from, topics[2] = to (32-byte left-padded addresses)
        for (const t of [l.topics[1], l.topics[2]]) {
          if (!t) continue;
          const a = ethers.utils.getAddress('0x' + t.slice(-40));
          if (a !== ZERO) sink.add(a);
        }
      }
      found += logs.length;
      cursor = end + 1;
      attempts = 0;
    } catch (e: any) {
      const msg = `${e?.error?.message || e?.body || e?.message || ''}`;
      const rateLimited = msg.includes('429') || /rate.?limit|too many/i.test(msg);

      if (rateLimited) {
        // Shrinking the window here would mean MORE requests and more 429s -
        // exactly the wrong move. Back off and retry the same window.
        attempts++;
        await sleep(Math.min(1000 * 2 ** attempts, 20_000));
        continue;
      }
      if (shard.span > 1000) {
        shard.span = Math.floor(shard.span / 2); // provider's block-span cap is tighter than assumed
        continue;
      }
      // At the floor span and still failing for a non-rate-limit reason.
      attempts++;
      if (attempts > 6) throw new Error(`getLogs failed for ${address} @${cursor}: ${msg.slice(0, 80)}`);
      await sleep(2000);
    }
  }
  return found;
}

async function main() {
  if (!fs.existsSync(SNAPSHOT_JSON)) {
    throw new Error(`Need ${SNAPSHOT_JSON} first - run snapshotPositions.ts.`);
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_JSON, 'utf8'));
  const targetBlock: number = snap.metadata.block;

  console.log('=== holder discovery via Transfer logs (read-only) ===');
  console.log('Block      :', targetBlock, `(${snap.metadata.blockTimestampISO})`);
  console.log('RPC shards :', shards.map((s) => maskRpc(s.url)).join(', '));

  // Every token that can carry a position: the aToken and both debt tokens.
  // A liquidated user can still owe debt with zero aTokens, so debt tokens are
  // not optional here.
  const dpAbi = [
    'function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
  ];
  const targets: Array<{ symbol: string; kind: string; address: string }> = [];
  for (const r of snap.reserves) {
    const t = await anyShard((p) =>
      new ethers.Contract(snap.metadata.dataProvider, dpAbi, p).getReserveTokensAddresses(r.asset, {
        blockTag: targetBlock,
      })
    );
    targets.push({ symbol: r.symbol, kind: 'aToken', address: r.aToken });
    targets.push({ symbol: r.symbol, kind: 'variableDebt', address: t.variableDebtTokenAddress });
    targets.push({ symbol: r.symbol, kind: 'stableDebt', address: t.stableDebtTokenAddress });
  }
  console.log('Contracts  :', targets.length, `(${snap.reserves.length} reserves x 3 tokens)\n`);

  const holders = new Set<string>();

  // Chunks within one token are sequential, so one worker per token would cap
  // parallelism at the shard count. Run several workers per shard instead, so
  // many tokens scan at once.
  const WORKERS_PER_RPC = Number(process.env.CONCURRENCY_PER_RPC || 5);
  let next = 0;
  let doneCount = 0;

  const workers: Promise<void>[] = [];
  for (const shard of shards) {
    for (let w = 0; w < WORKERS_PER_RPC; w++) {
      workers.push(
        (async () => {
          while (true) {
            const i = next++;
            if (i >= targets.length) return;
            const t = targets[i];
            let created: number;
            try {
              created = await creationBlock(t.address);
            } catch {
              console.log(`  ${t.symbol}/${t.kind}: no creation info, skipping`);
              doneCount++;
              continue;
            }
            // Scan into a token-local set. Diffing the shared set around an
            // await would attribute other workers' concurrent additions to this
            // token, which is how the first run reported "0 transfers | +1070".
            const mine = new Set<string>();
            const logs = await scanRange(shard, t.address, created, targetBlock, mine);
            let fresh = 0;
            for (const a of mine) {
              if (!holders.has(a)) fresh++;
              holders.add(a);
            }
            doneCount++;
            console.log(
              `  [${String(doneCount).padStart(2)}/${targets.length}] ${(t.symbol + '/' + t.kind).padEnd(22)} ${String(logs).padStart(6)} transfers | ${String(mine.size).padStart(5)} holders | +${fresh} new | total ${holders.size}`
            );
          }
        })()
      );
    }
  }
  await Promise.all(workers);

  // ---- diff against the supplied list ----
  const supplied = new Map<string, string>(); // lower -> accountId
  for (const line of fs.readFileSync(ADDRESSES_CSV, 'utf8').split(/\r?\n/)) {
    const [a, b] = line.split(',').map((s: string) => (s || '').trim());
    if (!a || !/^0x[0-9a-fA-F]{40}$/.test(a)) continue;
    supplied.set(a.toLowerCase(), b || '');
  }

  const missing = [...holders].filter((h) => !supplied.has(h.toLowerCase()));

  console.log(`\nDiscovered holders (ever) : ${holders.size}`);
  console.log(`Supplied in CSV           : ${supplied.size}`);
  console.log(`MISSING from CSV          : ${missing.length}`);

  // Missing addresses, and the complete union list to re-snapshot from.
  const missingPath = path.join(OUT_DIR, `missing-holders-${targetBlock}.csv`);
  fs.writeFileSync(missingPath, 'evmAddress,accountId\n' + missing.map((m) => `${m},`).join('\n') + '\n');

  const unionPath = path.join(OUT_DIR, `all-holders-${targetBlock}.csv`);
  const union = [
    ...[...supplied.entries()].map(([a, id]) => `${ethers.utils.getAddress(a)},${id}`),
    ...missing.map((m) => `${m},`),
  ];
  fs.writeFileSync(unionPath, 'evmAddress,accountId\n' + union.join('\n') + '\n');

  console.log(`\nMissing : ${missingPath}`);
  console.log(`Complete: ${unionPath}  (${union.length} addresses)`);
  console.log(
    `\nNext: re-run the snapshot against the complete list - the checkpoint means\n` +
      `only the ${missing.length} new addresses are actually fetched:\n\n` +
      `  CHAIN_TYPE=hedera_mainnet CONCURRENCY_PER_RPC=10 \\\n` +
      `    ADDRESSES_CSV=${path.relative(REPO_ROOT, unionPath)} \\\n` +
      `    npx hardhat run scripts/position-snapshot/snapshotPositions.ts\n`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
