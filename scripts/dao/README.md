# Bonzo DAO Execution Layer

On-chain execution surface for Bonzo DAO governance proposals. A passed BIP is expressed as a **bundle** (JSON), turned into **calldata** the right **Gnosis Safe** can execute, **dry-run** on the live Hedera RPC, then **executed** (Safe UI or scripted multisig) and **verified** on-chain.

---

## How it works

1. **Bundle** — You author `scripts/dao/fixtures/bundles/<name>.json` with a `bipId`, `targetSafe` (`executor` or `guardian`), and an ordered list of `actions` (`kind` + `args`). The schema is [`schema/bundle.schema.json`](schema/bundle.schema.json); validation loads the file via [`schema/validate.ts`](schema/validate.ts).

2. **Routing and encoding** — [`actions/_registry.ts`](actions/_registry.ts) maps each `kind` to a module that implements `build`, `preview`, and `verify`. [`lib/buildBundle.ts`](lib/buildBundle.ts) turns the bundle into one or more **`EncodedAction`** rows: contract `to`, `value` (decimal string), and hex `data`. If there are **multiple** actions and `multiSendCallOnly` is set in [`config.ts`](config.ts), those rows are wrapped in a single **MultiSendCallOnly** `multiSend(bytes)` call so the Safe runs one transaction.

3. **Preflight** — [`preflight.ts`](preflight.ts) checks the live chain (chain id, Safe exists, threshold/owners sanity, and that protocol admin roles point at the Safe implied by the bundle). This catches misconfigured `config.ts` or wrong `targetSafe` before you encode or simulate.

4. **Diff** — [`diff.ts`](diff.ts) calls each action’s `preview()` and prints a before/after table from RPC reads. Read-only; helps operators confirm arguments against live state.

5. **Encode** — [`encode.ts`](encode.ts) validates the bundle, builds all actions, prints a copy-paste block for the Palmera Safe UI, and writes **`scripts/dao/output/<bipId>.<chain_type>.encoded.json`**. That artifact includes:
   - **`actions`** — per-step `to` / `value` / `data` (and metadata).
   - **`multiSend`** — `{ to, data }` when a batch was encoded through MultiSend; otherwise `null`.
   - **`safeExecution`** — the **single** `Safe.execTransaction` inner call the multisig runner uses: one direct call for a single action, or one call to MultiSend for a batch. **`operation` is always `0` (CALL)** for MultiSendCallOnly compatibility.
   - **`safeAddress`** — the executor or guardian Safe from `config.ts` for the bundle’s `targetSafe`, checksummed. Used to detect drift vs [`scripts/multisig/config.ts`](../multisig/config.ts) when executing via `multisig:exec-dao-encoded` (see [multisig README](../multisig/README.md), section *Executing a DAO encode artifact*).
   - If the bundle has **multiple actions** but **no** MultiSend address is configured, `safeExecution` is **`null`** — you must either fill MultiSend in `config.ts` and re-encode, or execute **each** `actions[i]` as a separate Safe transaction in the UI.

6. **Simulate** — [`simulate.ts`](simulate.ts) runs `eth_call` with **`from` set to the Safe address** so authorization surfaces see the caller as the multisig. Failures here usually mean the same call would revert on execution. Logs go under `fixtures/simulation-logs/`.

7. **Execute** — The Safe must ultimately run the calldata in `safeExecution` (or each action in the UI). Two options:
   - **Palmera UI** — paste the printed `to` / `value` / `data` (from encode output or stdout) into `multisig.hedera.foundation` contract interaction; owners approve in wallets.
   - **Scripted path** — `npm run multisig:exec-dao-encoded` with `ENCODED_JSON` pointing at the encode artifact. Uses on-chain `approveHash` + `execTransaction` (see [multisig README](../multisig/README.md)). Requires owner keys and a gas payer in `.env` as documented there.

8. **Verify** — After execution, [`verify.ts`](verify.ts) re-reads chain state with each action’s `verify()` and can emit a report when you pass **`TX_IDS`** (comma-separated Hedera-style transaction ids, e.g. `0.0.x@y`).

9. **Submit (optional)** — [`submit.ts`](submit.ts) with `SUBMIT=true` is reserved for a future Safe Transaction Service integration; today it prints the same UI-oriented block as encode unless wired otherwise.

---

## Prerequisites before you run anything

1. **Network** — Pick `hedera_testnet` or `hedera_mainnet`. Every command below must use the same `CHAIN_TYPE`, the same `--network <name>`, and the same bundle.

2. **Fill [`config.ts`](config.ts)** — Contract addresses, `executorSafe` / `guardianSafe`, and optionally `multiSendCallOnly` for batched bundles. Non-secret values only; keys stay in `.env`.

3. **Environment** — At minimum for RPC scripts:
   - Testnet: `PRIVATE_KEY` (used by `getRuntime()` where a signer is required; some scripts are read-only).
   - Mainnet: `PRIVATE_KEY_MAINNET` and **`PROVIDER_URL_MAINNET`** (paid RPC recommended for rate limits).

4. **Multisig scripted execution** — If you use `multisig:exec-dao-encoded`, configure [`scripts/multisig/config.ts`](../multisig/config.ts) (`SAFE_ADDRESSES`, `OWNERS`, thresholds) and owner keys in `.env` per the [multisig README](../multisig/README.md). `safeAddress` in the encode artifact must match that config when both sides are non-empty.

---

## Operator runbook (exact commands)

Set a bundle path once (example: smoke fixture):

```bash
export BUNDLE=scripts/dao/fixtures/bundles/smoke-reserve-factor.json
export CHAIN_TYPE=hedera_testnet
# Mainnet would be: export CHAIN_TYPE=hedera_mainnet
```

Run steps in order on **real Hedera RPC** (not the Hardhat in-process network):

| Step | What it does | Command |
|------|----------------|---------|
| 1 | Preflight | `CHAIN_TYPE=$CHAIN_TYPE BUNDLE=$BUNDLE npm run dao:preflight -- --network $CHAIN_TYPE` |
| 2 | Diff (optional) | `CHAIN_TYPE=$CHAIN_TYPE BUNDLE=$BUNDLE npm run dao:diff -- --network $CHAIN_TYPE` |
| 3 | Encode + write artifact | `CHAIN_TYPE=$CHAIN_TYPE BUNDLE=$BUNDLE npm run dao:encode -- --network $CHAIN_TYPE` |
| 4 | Simulate | `CHAIN_TYPE=$CHAIN_TYPE BUNDLE=$BUNDLE npm run dao:simulate -- --network $CHAIN_TYPE` |

After step 3, note the output path, e.g. `scripts/dao/output/<bipId>.hedera_testnet.encoded.json` (the filename uses the bundle’s `bipId` and `CHAIN_TYPE`).

**Execute (pick one):**

- **Safe UI** — Use the “Safe UI copy-paste block” printed by encode, or the `actions` / `multiSend` section in the JSON, in `multisig.hedera.foundation`.

- **Scripted multisig** (requires `safeExecution` non-null — see “Encode output” above):

  ```bash
  # Dry-run: computes safeTxHash, no txs sent
  DRY_RUN=true CHAIN_TYPE=$CHAIN_TYPE TARGET_SAFE=executor \
    ENCODED_JSON=scripts/dao/output/<bipId>.hedera_testnet.encoded.json \
    npm run multisig:exec-dao-encoded -- --network $CHAIN_TYPE
  ```

  Replace `TARGET_SAFE` with `executor` or `guardian` to match **`targetSafe` inside the bundle** (the script enforces equality). Omit `DRY_RUN=true` for a live run. See the [multisig README](../multisig/README.md) (*Executing a DAO encode artifact*) for `GAS_LIMIT`, owner keys, and gas payer.

**Post-execution verify:**

```bash
CHAIN_TYPE=$CHAIN_TYPE BUNDLE=$BUNDLE TX_IDS="0.0.123@1" npm run dao:verify -- --network $CHAIN_TYPE
```

Use the real transaction id(s) from HashScan. Multiple ids: comma-separated list matching the number/order of actions if your reporting expects it.

**One-off admin handover:**

```bash
CHAIN_TYPE=$CHAIN_TYPE npm run dao:handover -- --network $CHAIN_TYPE
```

(Follow inline script requirements for that flow.)

---

## NPM scripts (this folder)

| Script | Entry | Purpose |
|--------|--------|---------|
| `dao:preflight` | `preflight.ts` | Live RPC checks: Safe, roles, addresses |
| `dao:diff` | `diff.ts` | Per-action preview tables |
| `dao:encode` | `encode.ts` | Bundle → calldata + `output/*.encoded.json` |
| `dao:simulate` | `simulate.ts` | `eth_call` as Safe; writes simulation logs |
| `dao:submit` | `submit.ts` | UI block or future tx-service submit |
| `dao:verify` | `verify.ts` | Post-tx verification + report |
| `dao:handover` | `handover.ts` | EOA → Safe admin transfer helper |

Multisig execution of the encode artifact is **`npm run multisig:exec-dao-encoded`** at the repo root (implemented under `scripts/multisig/`, not under `dao/`).

---

## Network convention

Same pattern as `scripts/supra-deploy.ts`:

- **`CHAIN_TYPE`** (`hedera_testnet` \| `hedera_mainnet`) is authoritative for RPC and addresses in `config.ts`.
- **`--network`** passed to Hardhat **must equal** `CHAIN_TYPE` (asserted at startup).
- No fork, no impersonation: scripts use the live Hedera JSON-RPC. `simulate` / `preflight` / `diff` are safe to re-run; they do not send transactions.

---

## Bundle → encode → simulate → execute → verify (short checklist)

1. Author bundle under `fixtures/bundles/` (see schema).
2. `dao:preflight` → `dao:diff` (optional) → `dao:encode` → `dao:simulate`.
3. Execute via Safe UI **or** `multisig:exec-dao-encoded` with `ENCODED_JSON`.
4. `dao:verify` with `TX_IDS`.

---

## Action registry

Every action kind is a module under `scripts/dao/actions/` exporting `{ kind, defaultTargetSafe, build, preview, verify }`. The central [`_registry.ts`](actions/_registry.ts) maps `ActionKind → ActionModule`. To add a new governable surface, add a file and register it.

| Category                   | Kinds                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserve risk params        | `setLtv`, `setLiquidationThreshold`, `setLiquidationBonus`, `setReserveFactor`, `configureReserveAsCollateral`, `setReserveInterestRateStrategy`                                                                                         |
| Reserve lifecycle          | `activateReserve`, `deactivateReserve`, `freezeReserve`, `unfreezeReserve`, `enableBorrowingOnReserve`, `disableBorrowingOnReserve`, `enableReserveStableRate`, `disableReserveStableRate`                                               |
| Caps                       | `setSupplyCap`, `setBorrowCap`, `setSupplyBorrowCaps`                                                                                                                                                                                    |
| Reserve listing / upgrades | `batchInitReserve`, `initReserveFromMarketConfig`, `updateAToken`, `updateVariableDebtToken`, `updateStableDebtToken`                                                                                                                    |
| AddressesProvider          | `setPoolAdmin`, `setEmergencyAdmin`, `setLendingPoolImpl`, `setLendingPoolConfiguratorImpl`, `setLendingPoolCollateralManager`, `setPriceOracle`, `setLendingRateOracle`, `setAddress`, `setAddressAsProxy`, `transferProviderOwnership` |
| Oracles                    | `aaveOracleSetAssetSources`, `aaveOracleSetFallbackOracle`, `lendingRateOracleSetMarketRate`                                                                                                                                             |
| Treasury / staking (stubs) | `aTokenSweepToTreasury`, `stakingSetRewardRate`, `stakingSetRewardsDuration`, `stakingRecoverERC20`                                                                                                                                      |
| Guardian-only              | `setPoolPause`                                                                                                                                                                                                                           |

---

## Guardian-only action list

`setPoolPause` is the only action whose `defaultTargetSafe === 'guardian'`. Bundle validation rejects any other action inside a `"targetSafe": "guardian"` bundle. Guardian owners should refuse to approve proposals that do not match the `setPoolPause` kind — the Safe itself will also revert if the target is not `LendingPoolConfigurator.setPoolPause`.

---

## Rollback pattern

Every change has an inverse bundle under `scripts/dao/fixtures/bundles/inverse/` with the pre-change values baked in. Before running a forward bundle, note the current state (`dao:diff`) so the inverse bundle can be authored with accurate values. For time-bounded changes on mainnet, the inverse bundle is prepared alongside the forward bundle.

---

## Troubleshooting

- **Hedera RPC rate limits:** Hashio rate-limits aggressive polling. Space out consecutive script invocations or use a paid RPC for mainnet (set `PROVIDER_URL_MAINNET`).
- **`eth_call` with `from` override:** Hashio honours it for simulation. If you see "insufficient balance" errors, the Safe may need a dust balance; check the `from` account balance before blaming the script.
- **MultiSend gas:** batch bundles can hit Hedera gas ceilings. If a MultiSend bundle reverts with out-of-gas, split into two smaller bundles; you can raise `GAS_LIMIT` for `multisig:exec-dao-encoded` (see multisig README).
- **HTS token association:** new HTS asset listings must be associated to the aToken / treasury / Safe before the first transfer. Missing association surfaces as an unhelpful revert; confirm association via HashScan before listing.
- **`RPC URL missing for hedera_mainnet`:** set `PROVIDER_URL_MAINNET` in env — the repo already expects this var (see `scripts/supra-deploy.ts`).
- **`safeExecution` is null after encode:** multi-action bundle without `multiSendCallOnly` in `config.ts`. Either configure MultiSend and re-run encode, or execute each action separately in the Safe UI.
- **Tests fail locally:** run `npm run test:dao`, which runs only the `dao-*.spec.ts` files against a local-only mock provider (no RPC required).

---

## Directory layout

```
scripts/dao/
├── actions/            # one module per governable surface
├── lib/                # multiSend, buildBundle, formatter helpers
├── schema/             # JSON schemas + validator
├── fixtures/
│   ├── bundles/        # forward bundles
│   ├── bundles/inverse # rollback bundles
│   ├── invalid/        # negative fixtures for §11.3
│   ├── simulation-logs/
│   └── testnet-reports/
├── abi/                # vendored ABIs (empty until §0.2 lands)
├── output/             # encode.ts artifacts: actions, multiSend, safeExecution, safeAddress
├── config.ts           # CHAIN_TYPE-driven runtime config
├── types.ts            # shared TS types
├── encode.ts           # bundle → calldata
├── preflight.ts        # Safe + admin role checks
├── diff.ts             # pre-run before/after preview
├── simulate.ts         # live-RPC eth_call dry-run
├── submit.ts           # optional SDK-based proposal (UI fallback by default)
├── verify.ts           # post-execution report generator
└── handover.ts         # one-time EOA → Safes admin transfer
```
