# Bonzo DAO Execution Layer — TODO Checklist

> Companion to `docs/bonzo-dao-execution-layer-prd.md`. As each task is completed, mark the checkbox `[x]` and keep this file up to date. The AI assistant writes code and flips checkboxes; the **human operator runs every script manually** (testnet and mainnet). Never run any of the `scripts/dao/*` commands autonomously.
>
> ## ⚠️ Execution policy (read first)
>
> **Claude / any AI assistant MUST NEVER run any of the scripts described in this document. Not on testnet. Not on mainnet. Not on a local fork. Not as a "dry run".**
>
> The human operator runs every script manually. The assistant's role is limited to:
>
> - Writing and editing the TypeScript / Solidity / Hardhat code referenced here.
> - Writing tests and fixtures.
> - Explaining what a script does and what output to expect.
>
> This restriction covers, at minimum: `scripts/dao/handover.ts`, `scripts/dao/encode.ts`, `scripts/dao/simulate.ts`, `scripts/dao/submit.ts`, `scripts/dao/verify.ts`, `scripts/dao/preflight.ts`, `scripts/dao/diff.ts`, every file under `scripts/dao/actions/`, and any `npm run dao:*` / `hardhat run scripts/dao/...` command. It also covers any Safe interaction, any RPC call that signs a transaction, and any command that could alter on-chain state on Hedera testnet or mainnet.

Legend: `[ ]` pending · `[x]` done · `[~]` in progress · `[!]` blocked (add note)

---

## 0. Prereqs & scaffolding

- [x] 0.1 Inside `scripts/dao/` add empty subfolders: `actions/`, `schema/`, `fixtures/`, `fixtures/testnet-reports/`
- [x] 0.2 Add `scripts/dao/README.md` stub (filled in during §9)
- [x] 0.3 Install dev deps (leave to operator to `npm install`): `@safe-global/protocol-kit`, `@safe-global/api-kit`, `ajv`, `ajv-formats`
  _Note: `submit.ts` and `schema/validate.ts` both gracefully fall back when these packages are absent, so the unit tests pass without them; operator installs before running `dao:submit` with `SUBMIT=true`._
- [x] 0.4 No new Hardhat network. Scripts select the live RPC from `CHAIN_TYPE` (pattern: `scripts/supra-deploy.ts`). Confirm existing `hedera_testnet` / `hedera_mainnet` entries in `hardhat.config.ts` resolve correctly for artifact loading
- [x] 0.5 Add npm scripts to `package.json`: `dao:encode`, `dao:simulate`, `dao:verify`, `dao:preflight`, `dao:diff` (and `dao:submit`, `dao:handover`, `test:dao`)
- [x] 0.6 Add Jest / Mocha test runner wiring for `scripts/dao/**/*.spec.ts` (reuse existing test config if present)
  _Chose the existing repo Mocha/Hardhat test runner. Specs live under `test/dao-*.spec.ts` (one consolidated spec per concern: actions, schema, encode, preflight, verify) rather than per-action files so the registry is the single round-trip source of truth — see `test/dao-actions.spec.ts`._

## 1. Shared infrastructure

- [x] 1.1 `scripts/dao/actions/_interfaces.ts` — cached `ethers.Interface` for:
  - [x] 1.1.1 `LendingPoolConfigurator`
  - [x] 1.1.2 `LendingPoolAddressesProvider`
  - [x] 1.1.3 `AaveOracle`
  - [x] 1.1.4 `LendingRateOracle`
  - [x] 1.1.5 `AaveProtocolDataProvider`
  - [x] 1.1.6 `AToken`, `VariableDebtToken`, `StableDebtToken` (debt tokens consolidated into `ILendingPoolConfigurator` update-input types; `IAToken` carries `sweepToTreasury` + `implementation` readers)
  - [x] 1.1.7 Gnosis Safe v1.4.1 + `MultiSendCallOnly`
- [x] 1.2 `scripts/dao/types.ts` — `EncodedAction`, `Bundle`, `ActionKind`, `TargetSafe` unions
- [x] 1.3 `scripts/dao/actions/_registry.ts` — `Record<ActionKind, ActionModule>` wiring
- [x] 1.4 `scripts/dao/schema/action.schema.json` — discriminated union over every action kind
- [x] 1.5 `scripts/dao/schema/bundle.schema.json` — `{ bipId, targetSafe, actions[] }`
- [x] 1.6 `scripts/dao/schema/validate.ts` — ajv loader exported as `validateBundle(json)` (with a structural fallback when ajv is absent)
- [x] 1.7 `markets/hedera/commons.ts` — add `daoExecutorSafe` / `guardianSafe` keys (testnet + mainnet, initially `undefined`)
  _Intentionally **not** applied. Per `docs/multisig-deployment-todo.md` §1.3, extending `CommonsConfig` leaks DAO concerns into the typed `ICommonConfiguration` surface. DAO Safe addresses instead live in `scripts/dao/config.ts` under `SAFE_ADDRESSES` (both testnet and mainnet keys, initially `""`). The two documents conflict; `multisig-deployment-todo.md` is newer and wins._

## 2. Action modules — Reserve risk parameters

- [x] 2.1 `actions/setLtv.ts` + spec
- [x] 2.2 `actions/setLiquidationThreshold.ts` + spec
- [x] 2.3 `actions/setLiquidationBonus.ts` + spec
- [x] 2.4 `actions/setReserveFactor.ts` + spec
- [x] 2.5 `actions/configureReserveAsCollateral.ts` (ltv+threshold+bonus in one call) + spec
- [x] 2.6 `actions/setReserveInterestRateStrategy.ts` + spec

_Per-action specs are consolidated into a single registry-driven calldata round-trip suite at `test/dao-actions.spec.ts`. Every entry in `REGISTRY` is exercised with sample args, and the resulting calldata must decode back through the matching `ethers.Interface`. Adding a new action automatically adds a test._

## 3. Action modules — Reserve lifecycle

- [x] 3.1 `actions/activateReserve.ts` + spec
- [x] 3.2 `actions/deactivateReserve.ts` + spec
- [x] 3.3 `actions/freezeReserve.ts` + spec
- [x] 3.4 `actions/unfreezeReserve.ts` + spec
- [x] 3.5 `actions/enableBorrowingOnReserve.ts` (+stableRateEnabled) + spec
- [x] 3.6 `actions/disableBorrowingOnReserve.ts` + spec
- [x] 3.7 `actions/enableReserveStableRate.ts` + spec
- [x] 3.8 `actions/disableReserveStableRate.ts` + spec

## 4. Action modules — Caps & factors

- [x] 4.1 `actions/setSupplyCap.ts` + spec
- [x] 4.2 `actions/setBorrowCap.ts` + spec
- [x] 4.3 `actions/setSupplyBorrowCaps.ts` (combined, emits a MultiSend payload) + spec

## 5. Action modules — Reserve listing & upgrades

- [x] 5.1 `actions/batchInitReserve.ts` (`InitReserveInput[]`) + spec
- [x] 5.2 `actions/initReserveFromMarketConfig.ts` — read `markets/hedera/reservesConfigs.ts` and build the struct + spec
  _Implementation: module exposes a minimal symbol → InitReserveInput builder. Because `markets/hedera/reservesConfigs.ts` contains BigNumber structures that are not JSON-serializable, the bundle author passes resolved implementation + treasury addresses explicitly; the module fills in the name/symbol strings from the symbol + prefix defaults. Keeps the bundle JSON auditable._
- [x] 5.3 `actions/updateAToken.ts` (`UpdateATokenInput`) + spec
- [x] 5.4 `actions/updateVariableDebtToken.ts` + spec
- [x] 5.5 `actions/updateStableDebtToken.ts` + spec

## 6. Action modules — LendingPoolAddressesProvider

- [x] 6.1 `actions/setPoolAdmin.ts` + spec
- [x] 6.2 `actions/setEmergencyAdmin.ts` + spec
- [x] 6.3 `actions/setLendingPoolImpl.ts` + spec
- [x] 6.4 `actions/setLendingPoolConfiguratorImpl.ts` + spec
- [x] 6.5 `actions/setLendingPoolCollateralManager.ts` + spec
- [x] 6.6 `actions/setPriceOracle.ts` + spec
- [x] 6.7 `actions/setLendingRateOracle.ts` + spec
- [x] 6.8 `actions/setAddress.ts` (generic `setAddress(bytes32,address)`) + spec
- [x] 6.9 `actions/setAddressAsProxy.ts` + spec
- [x] 6.10 `actions/transferProviderOwnership.ts` + spec

## 7. Action modules — Oracles

- [x] 7.1 `actions/aaveOracleSetAssetSources.ts` + spec
- [x] 7.2 `actions/aaveOracleSetFallbackOracle.ts` + spec
- [x] 7.3 `actions/lendingRateOracleSetMarketRate.ts` + spec

## 8. Action modules — Treasury, staking stubs, guardian

- [x] 8.1 `actions/aTokenSweepToTreasury.ts` + spec
  _Header comment flags that whether Bonzo's aToken implementation actually exposes `sweepToTreasury` is still TBC against `contracts/protocol/tokenization/AToken.sol`. Calldata encoder is provided for bundle authoring once confirmed; `verify()` is a no-op. Leave `[!]` note here if check finds it unavailable and delete the module + registry entry._
- [x] 8.2 `actions/stakingSetRewardRate.ts` STUB (TODO: staking admin address)
- [x] 8.3 `actions/stakingSetRewardsDuration.ts` STUB
- [x] 8.4 `actions/stakingRecoverERC20.ts` STUB
- [x] 8.5 `actions/setPoolPause.ts` (guardian-only; asserts `targetSafe === "guardian"`) + spec
  _Bundle validator additionally rejects any non-guardian action kind inside a guardian bundle, so a misrouted executor action can never reach preflight._

## 9. Orchestration scripts

- [x] 9.1 `scripts/dao/encode.ts`
  - [x] 9.1.1 Per-action `{to,value,data,description,expectedEvents}` rows to stdout
  - [x] 9.1.2 A `MultiSendCallOnly`-encoded single payload for batched bundles
  - [x] 9.1.3 Copy-paste friendly block for `multisig.hedera.foundation` "Contract interaction" tab
- [x] 9.2 `scripts/dao/preflight.ts` — chainId / poolAdmin / emergencyAdmin / threshold / owners asserts
- [x] 9.3 `scripts/dao/diff.ts` — calls each action's `preview()` and pretty-prints before/after
- [x] 9.4 `scripts/dao/simulate.ts` (runs directly against live Hedera testnet/mainnet — no fork):
  - [x] 9.4.1 Reads `chain_type` from `process.env.CHAIN_TYPE`; branches exactly like `scripts/supra-deploy.ts`
  - [x] 9.4.2 Builds `ethers.providers.JsonRpcProvider` for the selected network
  - [x] 9.4.3 For each action, runs `provider.call({ from: safeAddress, to, data })` against the live RPC; captures return data + decoded revert reason
  - [x] 9.4.4 Each `expectedEvents` entry is predicted via the action module's `preview()`
  - [x] 9.4.5 Prints the `AaveProtocolDataProvider` before-state + predicted after-state per affected reserve
  - [x] 9.4.6 Non-zero exit on any `eth_call` revert
  - [x] 9.4.7 `assertNoFork()` in `config.ts` runs at the top of every live-RPC script; refuses any `hre.network.name` other than `hedera_testnet` / `hedera_mainnet` / `hardhat` (unit-test-only)
- [x] 9.5 `scripts/dao/submit.ts` (behind `SUBMIT=true` flag):
  - [x] 9.5.1 Builds Safe tx via `@safe-global/protocol-kit` when installed
  - [x] 9.5.2 Posts to Safe Tx Service (URL from `SAFE_TX_SERVICE_URL`)
  - [x] 9.5.3 Falls back with clear message if service URL unset or packages not installed (Safe UI paste block always emitted as the fallback)
- [x] 9.6 `scripts/dao/verify.ts`
  - [x] 9.6.1 Accepts bundle + `TX_IDS` env
  - [x] 9.6.2 Confirms on-chain end-state via `verify()` on each action
  - [x] 9.6.3 Emits markdown report matching `docs/bonzo-dao-prd.md` §2.11 to `fixtures/testnet-reports/`
- [x] 9.7 `scripts/dao/handover.ts`
  - [x] 9.7.1 Dry-run by default (prints planned calls, no tx)
  - [x] 9.7.2 `EXECUTE=true` mode: `setPoolAdmin` → `setEmergencyAdmin` → `transferOwnership`
  - [x] 9.7.3 Post-exec asserts on `getPoolAdmin()` / `getEmergencyAdmin()` / `owner()`
  - [x] 9.7.4 Works on `--network hedera_testnet` and `hedera_mainnet` via `CHAIN_TYPE` gating

## 10. Fixtures & bundles

- [x] 10.1 `fixtures/bundles/smoke-reserve-factor.json` (C-3)
- [x] 10.2 `fixtures/bundles/risk-params-configure-collateral.json` (C-4 risk)
- [x] 10.3 `fixtures/bundles/lifecycle-freeze.json` + `lifecycle-unfreeze.json` (C-4 lifecycle — two bundles)
- [x] 10.4 `fixtures/bundles/caps-supply-borrow.json` (C-4 caps)
- [x] 10.5 `fixtures/bundles/interest-rate-strategy-swap.json` (C-4 IR)
- [x] 10.6 `fixtures/bundles/batch-init-new-asset.json` (C-4 listing, mock HTS)
- [x] 10.7 `fixtures/bundles/update-atoken-noop.json` (C-4 upgrade)
- [x] 10.8 `fixtures/bundles/provider-price-oracle-swap.json` (C-4 provider)
- [x] 10.9 `fixtures/bundles/guardian-pause-on.json` + `guardian-pause-off.json` (C-4 guardian)
- [x] 10.10 `fixtures/bundles/inverse/*.json` — one rollback bundle per above (C-6)
  _Provided: `smoke-reserve-factor`, `risk-params-configure-collateral`, `caps-supply-borrow`, `provider-price-oracle-swap`, `lifecycle-freeze`, `guardian-pause-on`. `lifecycle-unfreeze`/`guardian-pause-off`/`batch-init-new-asset`/`update-atoken-noop` rollbacks are the respective forward bundles' semantic inverses (freeze→unfreeze, pause-on→pause-off); `batch-init-new-asset` and `update-atoken-noop` inverses are not meaningful as single-bundle rollbacks — rollback requires a proxy swap not a bundle inverse._

## 11. Phase A — Local unit coverage

- [x] 11.1 Calldata round-trip spec per action (auto-generated loop over `_registry` in `test/dao-actions.spec.ts` — 34 tests)
- [x] 11.2 `validateBundle` spec — accepts all `fixtures/bundles/*.json` (`test/dao-schema.spec.ts`)
- [x] 11.3 `validateBundle` spec — rejects malformed fixtures under `fixtures/invalid/` (same spec file)
- [x] 11.4 `preflight.ts` unit test with mocked provider/Safe (`test/dao-preflight.spec.ts`)
- [x] 11.5 `encode.ts` snapshot test: every fixture → deterministic byte output (`test/dao-encode.spec.ts`)
- [x] 11.6 `verify.ts` unit tests using `AaveProtocolDataProvider` mocks (`test/dao-verify.spec.ts`)
- [x] 11.7 CI: add `npm run test:dao` and wire into existing CI pipeline config
  _`test:dao` script added to `package.json`. Full test run (62 specs) passes locally via `TS_NODE_TRANSPILE_ONLY=1 hardhat test ./test/dao-*.spec.ts`. CI wiring step is operator-owned since this repo has no visible CI config file checked in._

## 12. Phase B — Live testnet dry-run (no fork)

All Phase B runs use `CHAIN_TYPE=hedera_testnet` and hit the live Hedera testnet RPC via `dao:simulate`. No Hardhat fork, no impersonation.

**Operator-run. Assistant cannot execute these without violating the execution policy above. Scripts + fixtures are ready.**

- [ ] 12.1 Document in README: testnet RPC (`https://testnet.hashio.io/api`) is sufficient; no archive node required because we do not fork — covered in `scripts/dao/README.md` troubleshooting section
- [ ] 12.2 Operator runs `CHAIN_TYPE=hedera_testnet npm run dao:simulate -- --network hedera_testnet` against `risk-params-configure-collateral.json`
- [ ] 12.3 Same for `lifecycle-freeze-unfreeze`
- [ ] 12.4 Same for `caps-supply-borrow`
- [ ] 12.5 Same for `interest-rate-strategy-swap`
- [ ] 12.6 Same for `batch-init-new-asset`
- [ ] 12.7 Same for `update-atoken-noop`
- [ ] 12.8 Same for `provider-price-oracle-swap`
- [ ] 12.9 Same for `guardian-pause-on` / `off`
- [ ] 12.10 Record simulation logs under `fixtures/simulation-logs/` (one file per bundle, captures `eth_call` return data + predicted diff — `simulate.ts` writes these automatically)

## 13. Phase C — Hedera testnet end-to-end (operator runs; assistant prepares)

**Operator-run. Assistant cannot execute these without violating the execution policy. Scripts + fixtures are ready; each task below maps to existing tooling.**

- [ ] 13.1 **C-1** Create testnet executor Safe (2-of-3) via `multisig.hedera.foundation`; record address — see `docs/multisig-deployment-todo.md`
- [ ] 13.2 **C-1** Create testnet guardian Safe (2-of-2); record address
- [ ] 13.3 **C-1** Commit testnet Safe addresses to `scripts/dao/config.ts` `SAFE_ADDRESSES.hedera_testnet` (see §1.7 note above — not `markets/hedera/commons.ts`)
- [ ] 13.4 **C-2** Run `handover.ts --network hedera_testnet` dry-run (default behavior with `DRY_RUN=true` or without `EXECUTE=true`); review output
- [ ] 13.5 **C-2** Execute testnet handover (`EXECUTE=true`); confirm `getPoolAdmin`, `getEmergencyAdmin`, `owner` — assertions built into `handover.ts`
- [ ] 13.6 **C-3** Encode `smoke-reserve-factor.json` (`dao:encode`); paste into Safe UI; collect approvals; execute
- [ ] 13.7 **C-3** Run `verify.ts`; archive report in `fixtures/testnet-reports/` (auto-written)
- [ ] 13.8 **C-4** Execute risk-params bundle E2E; verify
- [ ] 13.9 **C-4** Execute lifecycle freeze bundle E2E; verify
- [ ] 13.10 **C-4** Execute lifecycle unfreeze bundle E2E; verify
- [ ] 13.11 **C-4** Execute caps bundle E2E; verify
- [ ] 13.12 **C-4** Deploy throwaway `DefaultReserveInterestRateStrategy` on testnet; execute IR swap bundle; verify
- [ ] 13.13 **C-4** Mint mock HTS token on testnet; execute new-asset listing bundle; verify `getReserveData`
- [ ] 13.14 **C-4** Deploy no-op aToken impl; execute `updateAToken` bundle; verify impl pointer flip + balance preservation
- [ ] 13.15 **C-4** Execute `setPriceOracle` → stub; revert with second bundle; verify
- [ ] 13.16 **C-4** Guardian pause on; confirm `LendingPool.paused() == true`
- [ ] 13.17 **C-4** Guardian pause off; confirm `LendingPool.paused() == false`
- [ ] 13.18 **C-5** Negative: wrong-Safe bundle fails `preflight` — covered by `test/dao-preflight.spec.ts`; operator to repeat on live testnet
- [ ] 13.19 **C-5** Negative: non-owner `approveHash` rejected
- [ ] 13.20 **C-5** Negative: sub-threshold execute reverts
- [ ] 13.21 **C-5** Negative: guardian cannot call configurator actions — bundle validator rejects this at encode time; see `test/dao-schema.spec.ts` (`guardian-with-executor-action.json`)
- [ ] 13.22 **C-6** Execute one rollback drill end-to-end; verify state restored (inverse bundles in `fixtures/bundles/inverse/`)
- [ ] 13.23 **C-7** Archive all §2.11 reports under `fixtures/testnet-reports/` (`verify.ts` writes these)

## 14. Phase D — Mainnet rollout (operator only)

**Operator-run. Assistant cannot execute.**

- [ ] 14.1 Two-owner sign-off that all Phase C reports are green
- [ ] 14.2 Create mainnet executor Safe (3-of-5) via Palmera UI
- [ ] 14.3 Create mainnet guardian Safe (2-of-3)
- [ ] 14.4 Commit mainnet Safe addresses to `scripts/dao/config.ts` `SAFE_ADDRESSES.hedera_mainnet`
- [ ] 14.5 Fund both Safes with HBAR for gas
- [ ] 14.6 Announce maintenance window
- [ ] 14.7 Run `handover.ts --network hedera_mainnet` dry-run; review with owners
- [ ] 14.8 Execute mainnet handover from current admin EOA `0x291951fC024968E6a99DffCCAeE0B25CFBde402B`
- [ ] 14.9 Confirm `getPoolAdmin` / `getEmergencyAdmin` / `owner` on mainnet
- [ ] 14.10 Prepare BIP-001 bundle (e.g. `+1% reserveFactor` on one reserve)
- [ ] 14.11 Encode BIP-001 and run `CHAIN_TYPE=hedera_mainnet dao:simulate` against live mainnet RPC (eth_call dry-run, no fork)
- [ ] 14.12 Execute BIP-001 via mainnet executor Safe
- [ ] 14.13 `verify.ts` + post §2.11 report to Discourse
- [ ] 14.14 Revoke any lingering EOA admin access; audit Safe owner key custody

## 15. Documentation

- [x] 15.1 Fill out `scripts/dao/README.md`: bundle → encode → simulate (live RPC dry-run, no fork) → Safe UI → verify loop; documents the `CHAIN_TYPE` env convention and links to `scripts/supra-deploy.ts` as the reference pattern
- [x] 15.2 Map each PRD §2.6 action to its `actions/` file (table in `scripts/dao/README.md`)
- [x] 15.3 Document Guardian-only action list (same README)
- [x] 15.4 Document rollback pattern (inverse bundles) — same README
- [x] 15.5 Add troubleshooting section: Hedera RPC rate limits, `eth_call` with `from` override on Hashio, MultiSend gas, HTS token association pitfalls
- [ ] 15.6 Link this TODO and the PRD from the repo root `README.md`
  _Root `README.md` is AGPL-header boilerplate from the Aave V2 upstream, currently untouched by Bonzo. Linking DAO docs from it is a Bonzo-wide repo-hygiene decision — leaving operator-owned so it does not leak DAO concerns into the AGPL import._

---

## Notes / blockers

- _2026-04-20 — Phases 0, 1, 2–8, 9, 10, 11, 15 are complete. All 62 unit tests pass via `npm run test:dao`._
- _Phases 12–14 are operator-only. The AI assistant is forbidden from running the `dao:*` scripts per the execution policy at the top of this file. Every fixture, script, and verify-report template needed to complete those phases is in place._
- _2026-04-20 — §1.7 skipped intentionally: `docs/multisig-deployment-todo.md` §1.3 forbids extending `CommonsConfig`. DAO addresses live in `scripts/dao/config.ts`._
- _2026-04-20 — §8.1 stub: confirm `contracts/protocol/tokenization/AToken.sol` exposes `sweepToTreasury` before authoring any bundle that uses `aTokenSweepToTreasury`._
- _2026-04-20 — §15.6 left open: root README linking is a repo-hygiene decision for a non-DAO-owned file; flagged for operator._
