# Multisig Deployment & Smoke-Test — TODO Checklist

Companion to `docs/bonzo-dao-architecture.md` §1.2 and `docs/bonzo-dao-execution-layer-prd.md`.

Scope: the concrete `scripts/multisig/` work needed to (a) record the two **Palmera-deployed** Gnosis Safe v1.4.1 multisigs — **Executor** (3-of-5) and **Guardian** (2-of-3) — on Hedera **testnet** and **mainnet**, and (b) prove they work end-to-end by sending an actual HBAR transfer through each one, reaching threshold in both the 2-of-3 (guardian) and 3-of-5 (executor) configurations.

**Chosen multisig stack:** Palmera-deployed Safe v1.4.1 on Hedera EVM, deployed via `multisig.hedera.foundation`. Standard Gnosis Safe contracts, HashPack + MetaMask compatible. Safe creation is UI-driven; everything downstream (propose → approve → execute) is scripted against the standard v1.4.1 ABI.

> ⚠️ **Execution policy.** The AI assistant writes and edits the scripts listed below. It does **not** run any of them — on testnet, mainnet, or a fork. The human operator runs every `hardhat run scripts/multisig/*` / `npm run multisig:*` invocation manually.

> ℹ️ **Repo hygiene.** At the time this doc was written, `docs/` was untracked (see `git status`). Commit this file and the rest of `docs/` before starting implementation, so reviews reference a stable version.

Legend: `[ ]` pending · `[x]` done · `[~]` in progress · `[!]` blocked (add dated note)

---

## 0. Blocking discovery

Resolve before running §3 against live RPC.

- [ ] 0.1 Multisig stack is **Palmera Safe v1.4.1** deployed via `multisig.hedera.foundation`. Update `docs/bonzo-dao-execution-layer-prd.md` §1 / §5.1 to reflect this if they drift.
- [ ] 0.2 Confirm Palmera is deploying stock Gnosis Safe v1.4.1 (not a fork). Our scripts target the standard ABI:
  - [ ] 0.2.1 `getTransactionHash(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, _nonce) view returns (bytes32)`
  - [ ] 0.2.2 `approveHash(bytes32)` / `approvedHashes(address, bytes32) view returns (uint256)`
  - [ ] 0.2.3 `execTransaction(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures) payable returns (bool)`
  - [ ] 0.2.4 `getOwners()`, `getThreshold()`, `isOwner(address)`, `nonce()`
  - Verify on a freshly-deployed Palmera test Safe before writing any mainnet code.
- [ ] 0.3 Decide whether to install the Safe SDK (`@safe-global/protocol-kit`, `@safe-global/api-kit`) or stay on the raw ABI. V1 target: raw ABI only, so the scripts have no runtime dependency on Safe packages and owners use `approveHash` on-chain (no EIP-712 off-chain signing). This matches HashPack's on-chain approval flow.
- [ ] 0.4 Confirm owner addresses for each Safe — 5 executor owners, 3 guardian owners — for both testnet and mainnet. Testnet can use existing dev accounts. Record in `scripts/multisig/config.ts`.
- [ ] 0.5 Pick the HBAR-transfer smoke target — the **two signer accounts** between which funds will move in the §3 test. Default: Safe → any owner EOA. Testnet can sweep HBAR back; mainnet uses a tiny amount (e.g. 0.1 HBAR) and a round-trip.

## 1. Config & scaffolding

- [x] 1.1 Create `scripts/multisig/` with subdirs: `smoke/`, `lib/`, `output/`.
- [x] 1.2 `scripts/multisig/config.ts` — single source of truth for network-dependent values:
  - `chain_type` read from `process.env.CHAIN_TYPE` (default `hedera_testnet`), following the pattern in `scripts/whbarGatewayDeploy.ts`.
  - Hardcoded top-level TS `const` blocks per network for all non-secret values — Safe addresses (filled in after Palmera UI deploy), owner address lists, smoke target asset/receiver, RPC URLs.
  - Do **not** read owner addresses, smoke target, or Safe addresses from env.
  - Only env reads are the existing `PRIVATE_KEY` (testnet) / `PRIVATE_KEY_MAINNET` + `PROVIDER_URL_MAINNET` (mainnet). Per-owner signing keys are script-local constants (§4.3).
  - `--network` is not authoritative. `CHAIN_TYPE` is. Scripts assert `hre.network.name === chain_type` at startup.
- [x] 1.3 **Type system.** DAO addresses intentionally do **not** go into `markets/hedera/commons.ts` — `CommonsConfig` is typed as `ICommonConfiguration` in `helpers/types.ts`. All DAO / multisig addresses, owner lists, and smoke config live in `scripts/multisig/config.ts`. Non-multisig scripts re-export from here if they ever need a DAO address.
- [x] 1.4 Reference patterns:
  - **Primary reference:** `scripts/whbarGatewayDeploy.ts` and `scripts/supra-deploy.ts`.
  - **Do not mirror** `scripts/configChanges.ts`.
- [x] 1.5 `package.json` npm scripts:
  - `"multisig:smoke-transfer":  "hardhat run scripts/multisig/smoke/transferHbar.ts"`
  - Operator appends `--network hedera_testnet` or `--network hedera_mainnet` and sets `CHAIN_TYPE` to match.
- [x] 1.6 Every script supports `DRY_RUN=true`: resolve addresses, run preflight, compute the Safe `txHash` via `getTransactionHash(...)`, log the planned approve + exec flow, exit 0 without sending any transaction.

## 2. Safe creation (manual — Palmera UI)

No deployment script. Palmera creates Safes via `multisig.hedera.foundation`. Operator records the addresses in `scripts/multisig/config.ts` after creation.

- [ ] 2.1 Create **Executor** Safe on Hedera testnet via Palmera UI, 3-of-5, five dev accounts as owners. Record address + HashScan link.
- [ ] 2.2 Create **Guardian** Safe on Hedera testnet via Palmera UI, 2-of-3. Record address.
- [ ] 2.3 Paste both addresses into `scripts/multisig/config.ts` → `SAFE_ADDRESSES.hedera_testnet`; commit.
- [ ] 2.4 Repeat §2.1–2.3 on mainnet when §10 phase C-X is green. Keep mainnet-fund step separate (§6.5).
- [ ] 2.5 Fund each Safe with a small HBAR balance for gas + the smoke-transfer amount (§3): 10 HBAR testnet, 5 HBAR mainnet. Manual.

## 3. HBAR-transfer smoke test — `scripts/multisig/smoke/transferHbar.ts`

End-to-end proof that a Palmera Safe can sign and execute a real transaction, for both thresholds.

The script:
1. Builds an HBAR transfer payload (Safe → receiver, value=amount, data=0x, operation=CALL).
2. Computes `safeTxHash` via `Safe.getTransactionHash(...)`.
3. Collects `approveHash(safeTxHash)` on-chain from exactly `threshold` distinct owner keys.
4. Constructs the pre-approved signature blob (each owner = `r=address_pad32, s=0, v=1`, sorted ascending by address) and calls `execTransaction(...)`.
5. Asserts the receiver's balance increased by `amount` and the Safe's balance decreased.
6. Repeats the whole loop with `TARGET_SAFE=guardian` (2-of-3) **and** `TARGET_SAFE=executor` (3-of-5) so both thresholds are exercised.

- [x] 3.1 Boilerplate: `chain_type` branch, `--network` assert, `assertNoFork`.
- [x] 3.2 Resolve target Safe from `TARGET_SAFE` env (`executor` or `guardian`). Throw on anything else.
- [x] 3.3 Load Safe addresses + owner lists + owner keys + receiver + amount from `config.ts` + per-script `OWNER_KEYS` constants.
- [x] 3.4 Preflight:
  - [x] 3.4.1 `provider.getNetwork().chainId` matches expected (296 / 295).
  - [x] 3.4.2 `safe.getOwners()` matches `config.<safe>.owners` as a set.
  - [x] 3.4.3 `safe.getThreshold()` matches expected (3 for executor, 2 for guardian).
  - [x] 3.4.4 Every owner-key address from the per-script constants maps to a real owner (`isOwner` true).
  - [x] 3.4.5 Safe HBAR balance ≥ `amount` + gas headroom.
  - [x] 3.4.6 Receiver address is set, non-zero, checksum-valid.
- [x] 3.5 Build tx: `to=receiver, value=amount, data=0x, operation=0, safeTxGas=0, baseGas=0, gasPrice=0, gasToken=0x0, refundReceiver=0x0`, `nonce=safe.nonce()`.
- [x] 3.6 Compute `safeTxHash = safe.getTransactionHash(...)`.
- [x] 3.7 `DRY_RUN=true`: log proposer, target Safe, planned receivers, planned `safeTxHash`, the list of owner addresses that would approve. Exit 0.
- [x] 3.8 For each of `threshold` owner keys:
  - [x] 3.8.1 Connect wallet, validate `safe.isOwner(address)` is true.
  - [x] 3.8.2 Read `safe.approvedHashes(owner, safeTxHash)` — skip if already 1.
  - [x] 3.8.3 Send `safe.approveHash(safeTxHash)`; wait for receipt; record hash.
- [x] 3.9 Re-read `approvedHashes` for each planned approver; assert count ≥ threshold.
- [x] 3.10 Build the pre-approved signature blob (sorted ascending by address): `65 bytes per owner = address_padded(32) || 0x00...00(32) || 0x01(1)`.
- [x] 3.11 Execute: `safe.execTransaction(to, value, data, op, 0, 0, 0, addr0, addr0, sigs)` signed by **any account with gas** (does not need to be an owner). Capture tx ID.
- [x] 3.12 Post-exec assertions:
  - [x] 3.12.1 Receiver's balance increased by `amount`.
  - [x] 3.12.2 Safe's balance decreased by `amount` (± gas for refundReceiver=0 this should be exact).
  - [x] 3.12.3 `safe.nonce()` incremented by 1.
- [x] 3.13 Write `scripts/multisig/output/transfer-hbar.{chain_type}.{executor|guardian}.json` with `{safeTxHash, approvals, executionTxId, amountWei, receiver, before, after}`.
- [x] 3.14 Print next step: "Run again with the other `TARGET_SAFE` to exercise the second threshold."

## 4. Owner private keys — `.env` only

Private keys for each signer are read from environment variables. They are **never** committed to the repo — not as TS constants, not as JSON, not in `config.ts`. This matches the repo-wide rule for `PRIVATE_KEY` / `PRIVATE_KEY_MAINNET`.

- [x] 4.1 Env var naming convention (enforced in `scripts/multisig/smoke/transferHbar.ts`):
  ```
  # Testnet
  EXECUTOR_OWNER_KEY_1 … EXECUTOR_OWNER_KEY_5          # 3-of-5, first 3 required
  GUARDIAN_OWNER_KEY_1 … GUARDIAN_OWNER_KEY_3          # 2-of-3, first 2 required

  # Mainnet
  EXECUTOR_OWNER_KEY_MAINNET_1 … EXECUTOR_OWNER_KEY_MAINNET_5
  GUARDIAN_OWNER_KEY_MAINNET_1 … GUARDIAN_OWNER_KEY_MAINNET_3
  ```
  Only the first `threshold` of each list need to be set; extras are ignored. The script filters empty/missing vars and preflight asserts every resolved key belongs to an on-chain owner.
- [x] 4.2 `scripts/multisig/config.ts` reads **zero** private keys — only non-secret addresses, owner lists, and smoke target. The only env reads are `PRIVATE_KEY` / `PRIVATE_KEY_MAINNET` (gas-paying wallet, already in repo convention) and the `*_OWNER_KEY_*` vars above. Document the list in `.env.example`.

## 5. Preflight checks — `scripts/multisig/lib/preflight.ts`

Shared helpers called by every smoke script.

- [x] 5.1 `provider.getNetwork().chainId` matches the expected Hedera chain ID.
- [x] 5.2 `hre.network.name === chain_type`.
- [x] 5.3 Every address read from `config.ts` passes `ethers.utils.isAddress` **and** is non-zero.
- [x] 5.4 `safe.getThreshold()` equals the expected threshold (3 for executor, 2 for guardian).
- [x] 5.5 `safe.getOwners()` equals `config.<safe>.owners` as a set; no duplicates.
- [x] 5.6 Every owner-key address is in `safe.getOwners()`.
- [x] 5.7 Every value fed to ethers goes through `ethers.utils.getAddress` first to normalize casing.

## 6. Pre-run checklist (operator)

- [ ] 6.1 `CHAIN_TYPE=hedera_testnet --network hedera_testnet` runs first. Never mainnet before testnet green.
- [ ] 6.2 Deployer / executor wallet has HBAR for gas.
- [ ] 6.3 All 5 executor owner addresses + 3 guardian owner addresses recorded in `config.ts`, and the matching private keys set in `.env` per the §4.1 naming convention.
- [ ] 6.4 Safe addresses filled into `config.ts` for the active network.
- [ ] 6.5 Each Safe has enough HBAR to cover `amount` + execution gas.
- [ ] 6.6 Run with `DRY_RUN=true` first. Review the log, then re-run without `DRY_RUN` in a fresh shell.

## 7. Testnet runbook

- [ ] 7.1 Create both testnet Safes via Palmera UI (§2.1–2.2).
- [ ] 7.2 Paste addresses into `scripts/multisig/config.ts`; commit.
- [ ] 7.3 Fund each Safe with 10 HBAR (testnet).
- [ ] 7.4 `DRY_RUN=true CHAIN_TYPE=hedera_testnet TARGET_SAFE=guardian npm run multisig:smoke-transfer -- --network hedera_testnet` → review.
- [ ] 7.5 Re-run without `DRY_RUN` → guardian Safe executes a 2-of-3 HBAR transfer. Verify balance moved.
- [ ] 7.6 `DRY_RUN=true` then live run with `TARGET_SAFE=executor` → executor Safe executes a 3-of-5 HBAR transfer. Verify.
- [ ] 7.7 Archive both `output/transfer-hbar.hedera_testnet.*.json` files.

## 8. Mainnet runbook

- [ ] 8.1 Two-owner sign-off that every testnet output in §7 is green.
- [ ] 8.2 Create both mainnet Safes via Palmera UI; paste addresses into `config.ts`; commit and tag.
- [ ] 8.3 Fund each Safe with the minimum HBAR needed: 5 HBAR plus gas.
- [ ] 8.4 `DRY_RUN=true ... TARGET_SAFE=guardian` → review.
- [ ] 8.5 Live run guardian 2-of-3 transfer on mainnet; verify.
- [ ] 8.6 `DRY_RUN=true ... TARGET_SAFE=executor` → review.
- [ ] 8.7 Live run executor 3-of-5 transfer on mainnet; verify.
- [ ] 8.8 Post both execution reports (with HashScan links) to the Discourse governance thread.

## 9. Documentation

- [x] 9.1 `scripts/multisig/README.md`: "End-to-end multisig smoke test" — summarize §3 with the command list and `DRY_RUN` convention.
- [ ] 9.2 Link this doc from the root `README.md` and from `docs/bonzo-dao-execution-layer-todo.md` §0.
- [ ] 9.3 Keep `docs/bonzo-dao-execution-layer-prd.md` §1 / §5.1 aligned with the Palmera decision recorded here.
- [x] 9.4 Document the "no env for multisig config" convention and why: every non-secret value lives in `scripts/multisig/config.ts` so the diff is reviewable; only env reads are `PRIVATE_KEY` / `PRIVATE_KEY_MAINNET` / `PROVIDER_URL_MAINNET`; owner-key constants are script-local and must not be committed with values.

---

## Notes / blockers

- _2026-04-20 — doc updated to reflect Palmera decision. Safe creation is manual via `multisig.hedera.foundation`. The only implementation surface is the HBAR-transfer smoke script + its helpers._
- _2026-04-20 — HBAR-transfer smoke script (§3) implemented at `scripts/multisig/smoke/transferHbar.ts`. Exercises 2-of-3 (guardian) and 3-of-5 (executor) via `TARGET_SAFE` env. Uses on-chain `approveHash` + pre-approved signature blob (no EIP-712 off-chain signing required)._
- _2026-04-20 — §4 updated: owner private keys moved from in-script constants to `.env` (`EXECUTOR_OWNER_KEY_*` / `GUARDIAN_OWNER_KEY_*` with `_MAINNET_` infix for mainnet). `config.ts` reads zero private keys. Update `.env.example` with the full list when adding the keys locally._
