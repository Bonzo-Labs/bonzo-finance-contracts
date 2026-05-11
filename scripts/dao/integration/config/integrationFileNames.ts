/**
 * Shared naming for integration output + log files:
 *   {stem}.{YYYY-MM-DD_HH-mm-ss}.{chainType}.integration.{suffix}
 *
 * "integration" and the chain id sit at the end before the extension; the
 * leading segment is a short scenario stem; the middle segment is a human-
 * readable UTC timestamp (filesystem-safe).
 */
const pad = (n: number): string => String(n).padStart(2, '0');

/** UTC, human-readable and safe for filenames: `2026-04-27_15-38-35` */
export const humanReadableUtcFileTimestamp = (now: Date): string =>
  `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}_${pad(
    now.getUTCHours()
  )}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;

/** Base path segment without extension, e.g. `SAUCE-SUPPLY-CAP-1M.2026-04-27_09-59-00.hedera_testnet.integration` */
export const integrationArtifactBase = (stem: string, chainType: string, now: Date): string =>
  `${stem}.${humanReadableUtcFileTimestamp(now)}.${chainType}.integration`;
