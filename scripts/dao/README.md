# Bonzo DAO Execution Layer

On-chain execution surface for Bonzo DAO governance proposals. Every passed BIP becomes a JSON bundle, is encoded to Safe-ready calldata, simulated against the live Hedera RPC, executed via the Gnosis Safe UI, then verified on-chain.

> ⚠️ **Execution policy.** The AI assistant writes and edits the scripts in this directory. It does **not** run any of them on testnet, mainnet, or any other environment. The human operator runs every `hardhat run scripts/dao/...` / `npm run dao:*` command manually.

## Network convention

Every script follows the same pattern as `scripts/supra-deploy.ts`:

- `CHAIN_TYPE` env var (`hedera_testnet` or `hedera_mainnet`) is **authoritative**.
- `--network` must match for artifact + runtime consistency — scripts assert `hre.network.name === chain_type` at startup.
- The live Hedera RPC is used directly. No Hardhat fork, no impersonation. Simulation is `eth_call`-based only.
- Secrets come from env (`PRIVATE_KEY`, `PRIVATE_KEY_MAINNET`, `PROVIDER_URL_MAINNET`). Every non-secret DAO value lives in `scripts/dao/config.ts`.

Typical invocation:

```bash
CHAIN_TYPE=hedera_testnet BUNDLE=scripts/dao/fixtures/bundles/smoke-reserve-factor.json \
  npx hardhat run scripts/dao/encode.ts --network hedera_testnet
```

## Bundle → encode → simulate → Safe UI → verify loop

1. **Author** a bundle JSON under `scripts/dao/fixtures/bundles/`. Schema in `scripts/dao/schema/bundle.schema.json`.
2. `npm run dao:preflight` — asserts Safe addresses, owners, and current `poolAdmin` / `emergencyAdmin` match the bundle's `targetSafe`.
3. `npm run dao:diff` — prints before/after state read from the live RPC.
4. `npm run dao:encode` — emits `{to, value, data}` rows plus a MultiSend payload (for multi-action bundles) into `scripts/dao/output/<bipId>.<chain_type>.encoded.json`.
5. `npm run dao:simulate` — `eth_call({from: safe, to, data})` against the live RPC for each action; writes `scripts/dao/fixtures/simulation-logs/<bipId>.<chain_type>.sim.json`.
6. Paste the encoded block into `multisig.hedera.foundation` "Contract interaction" tab; owners approve via HashPack; execute. (Or use `dao:submit` with `SUBMIT=true` once the Hedera Safe Tx Service URL is confirmed.)
7. `TX_IDS=... npm run dao:verify` — reads resulting state, emits the §2.11 execution report to `scripts/dao/fixtures/testnet-reports/`.

## Action registry

Every action kind is a module under `scripts/dao/actions/` exporting `{ kind, defaultTargetSafe, build, preview, verify }`. The central `_registry.ts` maps `ActionKind → ActionModule`. To add a new governable surface, drop a file and wire it into the registry.

Actions available:

| Category | Kinds |
| -------- | ----- |
| Reserve risk params | `setLtv`, `setLiquidationThreshold`, `setLiquidationBonus`, `setReserveFactor`, `configureReserveAsCollateral`, `setReserveInterestRateStrategy` |
| Reserve lifecycle | `activateReserve`, `deactivateReserve`, `freezeReserve`, `unfreezeReserve`, `enableBorrowingOnReserve`, `disableBorrowingOnReserve`, `enableReserveStableRate`, `disableReserveStableRate` |
| Caps | `setSupplyCap`, `setBorrowCap`, `setSupplyBorrowCaps` |
| Reserve listing / upgrades | `batchInitReserve`, `initReserveFromMarketConfig`, `updateAToken`, `updateVariableDebtToken`, `updateStableDebtToken` |
| AddressesProvider | `setPoolAdmin`, `setEmergencyAdmin`, `setLendingPoolImpl`, `setLendingPoolConfiguratorImpl`, `setLendingPoolCollateralManager`, `setPriceOracle`, `setLendingRateOracle`, `setAddress`, `setAddressAsProxy`, `transferProviderOwnership` |
| Oracles | `aaveOracleSetAssetSources`, `aaveOracleSetFallbackOracle`, `lendingRateOracleSetMarketRate` |
| Treasury / staking (stubs) | `aTokenSweepToTreasury`, `stakingSetRewardRate`, `stakingSetRewardsDuration`, `stakingRecoverERC20` |
| Guardian-only | `setPoolPause` |

## Guardian-only action list

`setPoolPause` is the only action whose `defaultTargetSafe === 'guardian'`. Bundle validation rejects any other action inside a `"targetSafe": "guardian"` bundle. Guardian owners should refuse to approve proposals that do not match the `setPoolPause` kind — the Safe itself will also revert if the target is not `LendingPoolConfigurator.setPoolPause`.

## Rollback pattern

Every change has an inverse bundle under `scripts/dao/fixtures/bundles/inverse/` with the pre-change values baked in. Before running a forward bundle, note the current state (`dao:diff`) so the inverse bundle can be authored with accurate values. For time-bounded changes on mainnet, the inverse bundle is prepared alongside the forward bundle.

## Troubleshooting

- **Hedera RPC rate limits:** Hashio rate-limits aggressive polling. Space out consecutive script invocations or use a paid RPC for mainnet (set `PROVIDER_URL_MAINNET`).
- **`eth_call` with `from` override:** Hashio honours it for simulation. If you see "insufficient balance" errors, the Safe may need a dust balance; check the `from` account balance before blaming the script.
- **MultiSend gas:** batch bundles can hit Hedera gas ceilings. If a MultiSend bundle reverts with out-of-gas, split into two smaller bundles.
- **HTS token association:** new HTS asset listings must be associated to the aToken / treasury / Safe before the first transfer. Missing association surfaces as an unhelpful revert; confirm association via HashScan before listing.
- **`RPC URL missing for hedera_mainnet`:** set `PROVIDER_URL_MAINNET` in env — the repo already expects this var (see `scripts/supra-deploy.ts`).
- **Tests fail locally:** run `npm run test:dao`, which runs only the `dao-*.spec.ts` files against a local-only mock provider (no RPC required).

## Directory layout

```
scripts/dao/
├── actions/            # one module per governable surface
├── lib/                # multiSend, formatter helpers
├── schema/             # JSON schemas + validator
├── fixtures/
│   ├── bundles/        # forward bundles
│   ├── bundles/inverse # rollback bundles
│   ├── invalid/        # negative fixtures for §11.3
│   ├── simulation-logs/
│   └── testnet-reports/
├── abi/                # vendored ABIs (empty until §0.2 lands)
├── output/             # encode.ts output artifacts (gitignored in practice)
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
