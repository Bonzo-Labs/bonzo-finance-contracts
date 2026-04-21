# Bonzo DAO Execution Layer — PRD

> ## ⚠️ Execution policy (read first)
>
> **Claude / any AI assistant MUST NEVER run any of the scripts described in this document. Not on testnet. Not on mainnet. Not on a local fork. Not as a "dry run".**
>
> The human operator runs every script manually. The assistant's role is limited to:
> - Writing and editing the TypeScript / Solidity / Hardhat code referenced here.
> - Writing tests and fixtures.
> - Explaining what a script does and what output to expect.
>
> This restriction covers, at minimum: `scripts/dao/handover.ts`, `scripts/dao/encode.ts`, `scripts/dao/simulate.ts`, `scripts/dao/submit.ts`, `scripts/dao/verify.ts`, `scripts/dao/preflight.ts`, `scripts/dao/diff.ts`, every file under `scripts/dao/actions/`, and any `npm run dao:*` / `hardhat run scripts/dao/...` command. It also covers any Safe interaction, any RPC call that signs a transaction, and any command that could alter on-chain state on Hedera testnet or mainnet.

---

## 1. Context

Bonzo Finance is an Aave v2 fork on Hedera mainnet (chain ID 295). Today every admin change (reserve risk parameters, new asset listings, interest-rate strategy swaps, proxy upgrades, oracle changes, pause/unpause) is executed by a single-signer EOA running scripts under `scripts/` — for example `scripts/updateContracts/updateReserves.ts`, `scripts/supplyBorrowCaps.ts`, `scripts/configChanges.ts`, `scripts/updateContracts/addNewAsset.ts`.

The DAO PRD (`docs/bonzo-dao-prd.md`) and architecture (`docs/bonzo-dao-architecture.md`) define a governance lifecycle (RFC → Proposal → Election) that ends with a multisig executing a frozen action bundle against Bonzo's existing admin surfaces. There is currently no in-repo execution layer that converts a passed governance action bundle into multisig-ready calldata, simulates it, or verifies it post-execution.

This PRD covers **only** that on-chain execution surface inside this repository. Off-chain voting, HCS topics, Discourse, the governance backend, the vote-weight engine, and delegation indexing are **out of scope** and live in a separate service.

**Chosen multisig stack:** Palmera-deployed Safe v1.4.1 on Hedera EVM, UI at `multisig.hedera.foundation`. Standard Gnosis Safe contracts, HashPack and MetaMask compatible.

## 2. Goals

1. DAO Executor Safe (3-of-5) and Guardian Safe (2-of-3) become the only accounts holding `poolAdmin`, `emergencyAdmin`, and `LendingPoolAddressesProvider` ownership on mainnet.
2. Every existing admin operation in `scripts/` has an equivalent **calldata generator** that emits a reviewable JSON bundle and a human-readable diff, ready to paste into the Safe UI or submit via the Safe SDK.
3. Every bundle is dry-run against the live Hedera testnet or mainnet (no local fork) via `eth_call` / `callStatic` against the real Safe and target contracts before signers approve in the Safe UI.
4. A post-execution verifier reads on-chain state and produces the report expected by `docs/bonzo-dao-prd.md` §2.11.

### Network selection convention

Every script under `scripts/dao/` follows the same pattern as `scripts/supra-deploy.ts` and `scripts/supra-prices.ts`:

- Network is selected from `process.env.CHAIN_TYPE` (`hedera_testnet` | `hedera_mainnet`), with Hardhat's `--network` flag used only to pick compiled artifacts.
- Inside `main()`, branch explicitly:
  ```ts
  const chain_type = process.env.CHAIN_TYPE || 'hedera_testnet';
  if (chain_type === 'hedera_testnet') {
    provider = new ethers.providers.JsonRpcProvider('https://testnet.hashio.io/api');
    owner = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
  } else if (chain_type === 'hedera_mainnet') {
    provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL_MAINNET);
    owner = new ethers.Wallet(process.env.PRIVATE_KEY_MAINNET || '', provider);
  } else {
    throw new Error(`Unsupported chain_type: ${chain_type}`);
  }
  ```
- No Hardhat forking network. No `hardhat_impersonateAccount`. Every read and every dry-run hits the live Hedera RPC directly. Write paths go through the Safe contract on the same live network.

## 3. Non-goals

- HCS voting service, Discourse integration, vote-weight engine, delegation indexer — lives in the governance backend.
- Any new on-chain governor or timelock contract.
- Lending incentives wiring — out of scope per `docs/bonzo-dao-prd.md` §2.7 and §5.
- Staking-module admin encoders beyond stubs — wired once the staking admin surface addresses are confirmed.

## 4. Architecture at a glance

```
governance backend          this repo (scripts/dao)         Palmera Safe on Hedera
─────────────────────────────────────────────────────────────────────────────────
action bundle (JSON)  ─►  encode.ts   (ethers iface)  ─►  Safe Tx Service (proposeTx)
                          simulate.ts (live RPC dry-run)   ├ owners approveHash (HashPack)
                          verify.ts   (post-exec reads)    └ executeTransaction
                                                                   │
                                                                   ▼
                                                           LendingPoolConfigurator
                                                           LendingPoolAddressesProvider
                                                           (existing, unchanged)
```

All three scripts talk to live Hedera testnet or mainnet RPC directly — no local fork, no impersonation, no Hardhat network other than `hedera_testnet` / `hedera_mainnet` (for artifacts).

No Solidity changes. No new on-chain contracts in this repo.

## 5. Work breakdown

### 5.1 Create Safe multisigs (manual, one-time)

- Create DAO Executor Safe (3-of-5) and Guardian Safe (2-of-3) via `multisig.hedera.foundation`.
- Record Safe EVM addresses in `markets/hedera/commons.ts` under new keys `daoExecutorSafe` and `guardianSafe`.
- Fund each Safe with a small HBAR balance for gas.

### 5.2 Ownership handover — `scripts/dao/handover.ts`

Built from the pattern in `scripts/configChanges.ts`. Executed (by the human operator) in this order, with a dry-run first:

1. `LendingPoolAddressesProvider.setPoolAdmin(daoExecutorSafe)`
2. `LendingPoolAddressesProvider.setEmergencyAdmin(guardianSafe)`
3. `LendingPoolAddressesProvider.transferOwnership(daoExecutorSafe)`

Verification re-reads `getPoolAdmin()`, `getEmergencyAdmin()`, and `owner()` and asserts. This is the last action the current EOA admin takes.

### 5.3 Folder layout

```
scripts/dao/
├── actions/                               # one file per governance action type
│   ├── _registry.ts                       # exports { kind -> build } map
│   ├── _interfaces.ts                     # cached ethers.Interface instances
│   │
│   │ ── Reserve risk parameters (LendingPoolConfigurator) ──
│   ├── setLtv.ts
│   ├── setLiquidationThreshold.ts
│   ├── setLiquidationBonus.ts
│   ├── setReserveFactor.ts
│   ├── configureReserveAsCollateral.ts    # batched ltv+threshold+bonus
│   ├── setReserveInterestRateStrategy.ts
│   │
│   │ ── Reserve lifecycle ──
│   ├── activateReserve.ts
│   ├── deactivateReserve.ts
│   ├── freezeReserve.ts
│   ├── unfreezeReserve.ts
│   ├── enableBorrowingOnReserve.ts        # with stableRateEnabled flag
│   ├── disableBorrowingOnReserve.ts
│   ├── enableReserveStableRate.ts
│   ├── disableReserveStableRate.ts
│   │
│   │ ── Caps & factors ──
│   ├── setSupplyCap.ts
│   ├── setBorrowCap.ts
│   ├── setSupplyBorrowCaps.ts             # combined convenience
│   │
│   │ ── Reserve listing / upgrades ──
│   ├── batchInitReserve.ts                # new asset listing (InitReserveInput[])
│   ├── initReserveFromMarketConfig.ts     # builds InitReserveInput from markets/hedera
│   ├── updateAToken.ts                    # UpdateATokenInput
│   ├── updateVariableDebtToken.ts
│   ├── updateStableDebtToken.ts
│   │
│   │ ── LendingPoolAddressesProvider ──
│   ├── setPoolAdmin.ts
│   ├── setEmergencyAdmin.ts
│   ├── setLendingPoolImpl.ts
│   ├── setLendingPoolConfiguratorImpl.ts
│   ├── setLendingPoolCollateralManager.ts
│   ├── setPriceOracle.ts
│   ├── setLendingRateOracle.ts
│   ├── setAddress.ts                      # generic setAddress(bytes32, address)
│   ├── setAddressAsProxy.ts               # generic setAddressAsProxy
│   ├── transferProviderOwnership.ts
│   │
│   │ ── Oracle surfaces ──
│   ├── aaveOracleSetAssetSources.ts       # AaveOracle.setAssetSources
│   ├── aaveOracleSetFallbackOracle.ts
│   ├── lendingRateOracleSetMarketRate.ts
│   │
│   │ ── Treasury / fee collection (if governed) ──
│   ├── aTokenSweepToTreasury.ts           # aToken.sweepToTreasury if exposed
│   │
│   │ ── Staking module (stubs) ──
│   ├── stakingSetRewardRate.ts            # TODO: addresses pending
│   ├── stakingSetRewardsDuration.ts       # TODO
│   ├── stakingRecoverERC20.ts             # TODO
│   │
│   │ ── Guardian-only ──
│   └── setPoolPause.ts                    # guardian Safe target
│
├── encode.ts             # bundle.json → Safe-ready tx array (+ MultiSend batch)
├── simulate.ts           # live-RPC dry-run: eth_call from Safe, predict diffs, assert events
├── submit.ts             # optional: Safe SDK proposal to Safe Tx Service
├── verify.ts             # post-execution reads → markdown report (PRD §2.11)
├── handover.ts           # one-time admin role transfer EOA → Safes
├── preflight.ts          # asserts Safe addresses, threshold, owners, pool-admin
├── diff.ts               # pretty-prints before/after state for every action
└── schema/
    ├── bundle.schema.json
    └── action.schema.json                 # discriminated union over every kind
```

Every action file exports the same shape:

```ts
export const kind = "setLtv";
export function build(args: { asset: string; ltv: number }): EncodedAction;
export async function preview(provider, args): Promise<{ before: any; after: any }>;
export async function verify(provider, args): Promise<boolean>;
```

`EncodedAction = { to, value, data, description, expectedEvents, targetSafe: "executor" | "guardian" }`. `_registry.ts` gives `encode.ts`, `simulate.ts`, and `verify.ts` a single lookup table, so adding a new governable surface is one new file.

ABI source of truth: `contracts/interfaces/ILendingPoolConfigurator.sol` and `contracts/interfaces/ILendingPoolAddressesProvider.sol`. No new ABI work — these are already compiled by Hardhat.

### 5.4 Bundle format (`bundle.json`)

Mirrors `docs/bonzo-dao-architecture.md` §3.5:

```json
{
  "bipId": "BIP-007",
  "targetSafe": "daoExecutor",
  "actions": [
    {
      "kind": "setReserveFactor",
      "target": "0x6Fa59558495a4D8B1701ab7924fc5a249d63cfF0",
      "args": { "asset": "0x...USDC", "reserveFactor": 1000 }
    }
  ]
}
```

`encode.ts` resolves each action through the `actions/` registry into a `{ to, value, data }` array consumable by Safe's `MultiSendCallOnly` (for batched bundles) or a single Safe tx.

### 5.5 Simulation — `scripts/dao/simulate.ts`

Dry-runs each encoded action against the **live Hedera testnet or mainnet** — no local fork.

- Reads `chain_type` from env (same branching pattern as `scripts/supra-deploy.ts`), selects the matching RPC URL (`https://testnet.hashio.io/api` for testnet, `PROVIDER_URL_MAINNET` for mainnet).
- For each action, executes `provider.call({ from: safeAddress, to, data })` (i.e. `eth_call` with the Safe as `from`). This reproduces what would happen if the Safe executed the call, without sending a transaction. If Hedera's RPC rejects the override, fall back to `callStatic` from the current `poolAdmin` signer for read-only sanity.
- Reads before/after state via `AaveProtocolDataProvider.getReserveConfigurationData(asset)` and other provider getters, computing the diff in-memory by applying the encoded args to the read values (since `eth_call` does not mutate state).
- Asserts each action's declared `expectedEvents` would fire, using `provider.call` return data and the action module's `preview()` to reason about event emission; where an action depends on prior state changes in the same bundle, simulate sequentially and thread the predicted state forward.
- Exits non-zero on any revert (decoded reason printed) or preview mismatch.
- **Never** uses `hardhat_impersonateAccount`, `hardhat_setStorageAt`, a fork, or any Hardhat-local JSON-RPC method. Every call goes to the live Hedera network the operator selected via `CHAIN_TYPE`.

### 5.6 Submission

Two supported paths:

- **UI path (v1 default):** the human operator runs `encode.ts`, copies the `to/value/data` row into the "Contract interaction" tab on `multisig.hedera.foundation`, and owners approve via HashPack.
- **SDK path (optional):** `submit.ts` uses `@safe-global/protocol-kit` and `@safe-global/api-kit` against the Hedera Safe Tx Service URL (confirm with Palmera during setup). Falls back to UI if the service URL is not yet live.

### 5.7 Post-execution verification — `scripts/dao/verify.ts`

Reads the bundle's expected end-state and confirms on-chain via `AaveProtocolDataProvider` and provider getters. Outputs the markdown execution report template from `docs/bonzo-dao-prd.md` §2.11 (Hedera TX IDs, HashScan links, decoded actions, verification JSON) for pasting into the Discourse thread.

### 5.8 Hardhat config additions

- No new Hardhat network. Existing `hedera_testnet` and `hedera_mainnet` entries are reused for both artifact loading and live RPC. `CHAIN_TYPE` env var drives the provider/owner branching inside each script (see "Network selection convention" in §2).
- Add npm scripts (operator sets `CHAIN_TYPE` to match `--network`):
  ```
  "dao:encode":   "hardhat run scripts/dao/encode.ts"
  "dao:simulate": "hardhat run scripts/dao/simulate.ts"
  "dao:verify":   "hardhat run scripts/dao/verify.ts"
  ```
  Typical invocations:
  ```
  CHAIN_TYPE=hedera_testnet npm run dao:simulate -- --network hedera_testnet
  CHAIN_TYPE=hedera_mainnet npm run dao:simulate -- --network hedera_mainnet
  ```

### 5.9 Documentation

`scripts/dao/README.md` covers the bundle → encode → simulate → Safe UI → verify loop, how each `docs/bonzo-dao-prd.md` §2.6 action maps to an action file, and the Guardian-only action list.

## 6. Critical files

| Purpose | File |
| --- | --- |
| Admin script patterns to port | `scripts/updateContracts/updateReserves.ts`, `scripts/supplyBorrowCaps.ts`, `scripts/configChanges.ts`, `scripts/updateContracts/addNewAsset.ts` |
| ABI source of truth | `contracts/interfaces/ILendingPoolConfigurator.sol`, `contracts/interfaces/ILendingPoolAddressesProvider.sol` |
| Admin role plumbing | `contracts/protocol/configuration/LendingPoolAddressesProvider.sol` |
| Market / address constants | `markets/hedera/commons.ts`, `markets/hedera/index.ts` |
| Hardhat network config | `hardhat.config.ts` |

No Solidity in `contracts/` is modified.

## 7. Verification plan

### Phase A — Local (per-action unit coverage)

1. For each `actions/*.ts`, a Jest / Mocha spec asserts the produced calldata round-trips through the ethers `Interface` to the same args.
2. `schema/action.schema.json` validates every bundle in `scripts/dao/fixtures/`.

### Phase B — Live testnet dry-run (no fork)

3. `CHAIN_TYPE=hedera_testnet dao:simulate` runs a canned bundle exercising one action per category — risk params, reserve lifecycle, caps, listing via `batchInitReserve`, aToken upgrade, oracle swap, provider admin change, guardian pause — as `eth_call` against the live Hedera testnet with the Safe as `from`. All exits must be 0 with matching predicted diffs. No Hardhat fork, no impersonation.

### Phase C — Hedera testnet end-to-end (required gate before mainnet)

Testnet addresses (from existing deployments): `LendingPoolAddressesProvider` `0x74CF16e88Ec986CC12aFC9E3C9F028C3C8c5b526`, current admin `0xbe058ee0884696653E01cfC6F34678f2762d84db`.

4. **C-1 Create testnet Safes.** Create a 2-of-3 executor Safe and 2-of-2 guardian Safe via `multisig.hedera.foundation` (testnet mode). Owners = three dev accounts in HashPack. Record addresses in `markets/hedera/commons.ts` under testnet keys.
5. **C-2 Handover on testnet.** Run `scripts/dao/handover.ts --network hedera_testnet`: transfer `poolAdmin`, `emergencyAdmin`, and `LendingPoolAddressesProvider` ownership to the new Safes. Assert via `getPoolAdmin()`, `getEmergencyAdmin()`, `owner()`.
6. **C-3 Smoke bundle.** Tiny bundle: `setReserveFactor` +1% on a single testnet reserve. `encode` → paste into Safe UI → 2 owners `approveHash` → execute → `verify.ts` confirms the storage delta. This is the full-loop proof.
7. **C-4 Category coverage bundles.** One bundle per category, each executed independently through the Safe UI on testnet:
   - Risk params: `setLtv` + `setLiquidationThreshold` + `setLiquidationBonus` on one reserve via `configureReserveAsCollateral`.
   - Lifecycle: `freezeReserve` → `unfreezeReserve` round-trip.
   - Caps: `setSupplyBorrowCaps`.
   - Interest-rate: deploy a throwaway `DefaultReserveInterestRateStrategy`, then `setReserveInterestRateStrategy`.
   - **New-asset listing:** `batchInitReserve` for a mock HTS token — riskiest path, must be proven before any mainnet listing.
   - Proxy upgrade: `updateAToken` with a no-op impl; confirm `aToken.implementation()` flips and balances are preserved.
   - Provider-level: `setPriceOracle` to a stub, then revert.
   - Guardian: `setPoolPause(true)` via guardian Safe, then `setPoolPause(false)`.
8. **C-5 Negative tests.** On testnet, confirm:
   - A bundle submitted to the wrong Safe fails `preflight.ts`.
   - A non-owner `approveHash` is rejected by the Safe.
   - Executing with only threshold-1 approvals reverts.
   - Guardian Safe cannot call configurator actions (only `setPoolPause`).
9. **C-6 Rollback drill.** Take a passing bundle and execute the inverse bundle (e.g. restore prior reserve factor) end-to-end, proving every action has a reversible counterpart documented in the action file's `preview`.
10. **C-7 Verification report.** `verify.ts` produces the exact markdown template from `docs/bonzo-dao-prd.md` §2.11 for each testnet execution; archive under `scripts/dao/fixtures/testnet-reports/`.

### Phase D — Mainnet rollout

11. Sign-off from at least two multisig owners that every Phase-C report is green.
12. Create mainnet Safes via Palmera UI. Record in `markets/hedera/commons.ts`.
13. Announce maintenance window.
14. Run `scripts/dao/handover.ts --network hedera_mainnet` from the current admin EOA (`0x291951fC024968E6a99DffCCAeE0B25CFBde402B`). Verify `getPoolAdmin()`, `getEmergencyAdmin()`, and `owner()` match the Safes.
15. Execute BIP-001 (a trivial parameter tweak, e.g. +1% reserve factor on one reserve) end-to-end through the mainnet executor Safe as the Week-4 validation vote described in `docs/bonzo-dao-prd.md` §2.12.
16. Post the §2.11 execution report to the Discourse thread.

### Exit criteria before Phase D

- All Phase A/B tests pass in CI.
- All Phase C steps produced matching verify-report diffs.
- At least one full rollback drill (C-6) completed on testnet.
- Safe owner keys confirmed stored across distinct custodians.

## 8. V2 — Signer Review UI (admin-gated panel inside `app.bonzo.finance`)

### 8.1 Problem

In V1, signers approve transactions through the Palmera-hosted Safe UI. That UI renders the payload as raw hex calldata and a target address. For Bonzo-specific actions (`setLtv`, `batchInitReserve`, `updateAToken`, `setPriceOracle`, etc.) that is effectively blind signing: a malicious or mistaken calldata swap between "encode → paste" and "owner approves" would not be visible to owners reading only the Safe UI. Owners need to be able to see, in human-readable terms, **exactly what a proposed transaction will do to the protocol** before they click approve.

### 8.2 Goal

Add a governance admin panel at `app.bonzo.finance/governance/admin` that:

1. Lists every pending Safe transaction targeting the DAO Executor Safe or Guardian Safe on Hedera mainnet (and testnet in staging).
2. Decodes each transaction's calldata back into the originating action kind + arguments using the **same `scripts/dao/actions/_registry.ts` logic** that produced it.
3. Renders a diff: current on-chain state vs. post-execution state, per action, resolved live from the mirror node / JSON-RPC.
4. Is gated to a hard-coded allowlist of Safe owner EVM addresses. Non-signers see a 403.
5. Lets a signer trigger `approveHash` directly from the panel (via their connected wallet), after they have read the decoded payload.

This closes the "blind signing" gap without replacing the Safe infrastructure — the on-chain authority still lives in the Safe contract.

### 8.3 Scope

In-scope:

- Next.js route(s) under `app.bonzo.finance/governance/admin`.
- A small backend indexer (or Next.js Route Handler + cron) that polls the Safe Tx Service for pending txs against the executor + guardian Safes and caches decoded views.
- Calldata decoder that reuses the action registry shipped in V1 (published as a workspace package, e.g. `@bonzo/dao-actions`, so the contracts repo and the Next.js app share one source of truth).
- Action-specific "preview" components: each action kind maps to a React component that renders its semantic diff (e.g. `SetLtvPreview` shows `USDC: LTV 65% → 70%`, `BatchInitReservePreview` shows the new market with all struct fields, `UpdateATokenPreview` shows old-impl → new-impl and a warning banner).
- Wallet connect via the existing Bonzo app wallet adapter (HashPack, MetaMask).
- One-click `approveHash(txHash)` flow from the panel.

Out-of-scope for V2:

- Executing the final `executeTransaction()` — Palmera Safe UI remains the execute path to keep privilege boundaries simple.
- Drafting or proposing new transactions from the panel. Proposals still originate from `scripts/dao/encode.ts` + Safe UI (or `submit.ts`).
- Generalized calldata decoding beyond Bonzo-governed contracts. Unknown targets fall back to raw hex + a `UNKNOWN TARGET — DO NOT APPROVE` banner.

### 8.4 Architecture

```
 Next.js app (app.bonzo.finance)
 ├── /governance/admin                     (server-side auth gate)
 │   ├── pending list                      ─┐
 │   ├── /[safeTxHash] detail page          │
 │   │    ├── decoded actions               │
 │   │    ├── live on-chain diff            │
 │   │    └── approveHash() button          │
 │   └── history / audit log                │
 │                                          │
 ├── Route Handler /api/dao/pending         ├── reads from ─┐
 ├── Route Handler /api/dao/tx/[hash]       │               │
 └── cron: /api/dao/refresh (every 30s)    ─┘               │
                                                            ▼
                                       Safe Tx Service (Hedera)
                                       Hedera mirror node / JSON-RPC
                                       @bonzo/dao-actions (shared decoder)
```

### 8.5 Access control

- **Allowlist source:** addresses of executor + guardian Safe owners, committed to the Next.js app config (same list we put in `markets/hedera/commons.ts`). A change to the owner set is a code deploy, not a database toggle, so there is no privileged admin surface that can silently add itself.
- **Auth flow:** SIWE-style "Sign-In with Hedera" — the user connects their wallet, signs a nonce challenge, the server verifies the EVM signature against the allowlist, and issues a short-lived httpOnly session cookie (15 min idle TTL, 2 h absolute).
- **Server-side enforcement:** every Route Handler and the page's server component re-checks the session → allowlist on each request. No client-only gating.
- **Rate limiting:** `approveHash` endpoint rate-limited per session.
- **Audit log:** every page view, decoded-render, and `approveHash` click is logged server-side (owner address, safe tx hash, action kinds, timestamp). Log table is append-only.

### 8.6 Pending transaction list view

For each pending Safe tx:

- BIP ID (parsed from the bundle metadata attached at propose time)
- Target Safe (executor / guardian) with visual distinction
- Number of actions in the bundle
- Summary line per action, e.g. `setLtv(USDC) 65% → 70%`, `setPoolPause(true)`
- Current approval count / threshold, with the list of owners who have already approved
- Age of the proposal and time until any operator-defined review window closes
- Status chips: `NEEDS REVIEW`, `READY TO EXECUTE`, `EXECUTED`, `FAILED`, `UNKNOWN TARGET` (warning)

### 8.7 Detail view — per-action decoded payload

For each action in a bundle, the panel renders a component driven off the action kind from the shared registry:

- **Raw info:** target contract name + address, function signature, raw hex (collapsed).
- **Decoded args:** pretty-printed, with address → known-label resolution (`0xf67D…bC2` → `LendingPool`, asset addresses → token symbol).
- **Live diff:** `preview()` from the action module, rendered as a before → after table. The diff is re-fetched on page load from Hedera RPC.
- **Impact classification:** one of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. `batchInitReserve`, `updateAToken`, `setLendingPoolImpl`, `setPriceOracle`, `setPoolAdmin`, and `transferProviderOwnership` are `CRITICAL` and render a blocking confirmation modal before `approveHash` fires.
- **Warnings:** flagged when decoded args fall outside policy guardrails (e.g. `LTV > 85%`, `LiquidationThreshold < LTV`, new reserve with unconfigured oracle source, rate strategy address with no bytecode at that slot). Guardrails live alongside each action module.
- **Unknown calldata:** if decoder cannot identify the function selector or the target contract is not in the allowlist of governed contracts, the detail view shows `UNKNOWN — raw hex only`, hides the `approveHash` button, and surfaces an incident banner.

### 8.8 Shared decoder package

- Extract `scripts/dao/actions/_registry.ts`, `_interfaces.ts`, the per-action `build`/`preview`/`verify` modules, and the schema files into a workspace package (e.g. `@bonzo/dao-actions`).
- The contracts repo consumes it from `scripts/dao/`; the Next.js app consumes it from its UI components.
- Package ships both `build(args)` (used server-side in the contracts repo) and `decode(to, data)` (used in the UI to reverse calldata back into the action kind + args).
- Single-source-of-truth invariant: a bundle that cannot be decoded by the package cannot be proposed by the package.

### 8.9 `approveHash` flow

1. Signer opens the detail view; panel fetches `safeTxHash` from the Safe contract's `getTransactionHash(...)` and cross-checks it against the Safe Tx Service value. Any mismatch blocks approval.
2. Signer reads the decoded payload + diff; the UI surfaces impact level and any guardrail warnings.
3. Signer clicks **Approve**; if impact is `CRITICAL`, a second confirmation modal requires re-typing the BIP ID.
4. Wallet prompt signs `approveHash(safeTxHash)` directly against the Safe contract. The UI does not proxy the transaction — the wallet broadcasts it.
5. On receipt, panel polls the Safe contract for `approvedHashes(owner, txHash)` to confirm the approval landed; updates the approval count in the list view.
6. Audit log records `owner, safeTxHash, bipId, decision=APPROVE, txId`.

### 8.10 Review workflow considerations

- **Minimum review window:** operator-configurable per-impact-level review delay before the approval count can reach threshold, enforced client-side as a warning (the Safe contract itself has no such concept in v1.4.1). For `CRITICAL` actions, default 24 h.
- **Revocation:** if an owner spots an issue after approving, the Safe supports no on-chain revocation, but the panel should surface a **"Flag for review"** action that posts an in-panel warning visible to other owners before the threshold is reached.
- **Off-Safe comms:** the panel links each tx to its Discourse thread (BIP ID → URL stored with the bundle metadata).

### 8.11 Testing

- Decoder fuzz tests: for every bundle in `scripts/dao/fixtures/bundles/`, `encode` → `decode` round-trip and assert deep-equal.
- Playwright tests against a mocked Safe Tx Service fixture covering: allowlist enforcement, decoded rendering per action kind, unknown-calldata fallback, approveHash happy path, CRITICAL confirmation modal.
- Manual session: run through every testnet Phase-C bundle in the panel before the first mainnet execution; at least two owners must sign off that every decoded view matches the originating bundle.

### 8.12 Rollout

- V2 ships only after V1 has executed at least one successful mainnet BIP end-to-end. The Palmera Safe UI remains the fallback approve path; the admin panel is an additive review surface, not a replacement.
- Cutover: once the panel is in production and two owners confirm parity, update owner runbooks to require using the panel for review before approving in either the panel or the Safe UI.

### 8.13 Explicit non-goals for V2

- No custom timelock, no custom multisig, no role other than decode + review + approve.
- No private keys handled server-side — the session cookie gates access to decoded views and the audit log, but signing always happens in the signer's wallet.
- No write access to bundle contents from the panel. A bundle is immutable once proposed to the Safe.

---

## 9. Execution policy (repeat)

Every script, npm task, Hardhat command, and Safe interaction referenced in this document is run **only** by the human operator. The AI assistant writes code and tests. It does not invoke `hardhat run`, `npm run dao:*`, `ts-node scripts/dao/*`, any RPC call that signs a transaction, or any Safe Tx Service call on behalf of the operator — on testnet or mainnet, fork or live.
