# BIP-1: DOVU Risk Parameter Update

Applies the approved **DOVU Risk Parameter Update** governance proposal (Bonzo Lend)
to the DOVU reserve on **Hedera Mainnet**.

## Parameter changes

| Parameter        | Current                | Recommended            | Encoded value        |
| ---------------- | ---------------------- | ---------------------- | -------------------- |
| Supply Cap       | 19,379,844 DOVU        | 31,250,000 DOVU        | `31250000`           |
| Liq. Threshold   | 59%                    | 45%                    | `4500`               |
| Liq. Bonus       | 6.66%                  | 10%                    | `11000` (100% + 10%) |
| Borrow Cap       | 3,875,968 DOVU         | 15,625,000 DOVU        | `15625000`           |
| Reserve Factor   | 17.25%                 | 25%                    | `2500`               |
| Slope-2 (γ)      | 250%                   | 300%                   | `3.0 * RAY`          |
| LTV              | 20%                    | 20% (unchanged)        | `2000`               |
| Close Factor     | 50%                    | 50% (unchanged)        | protocol-level       |

- **LTV** is unchanged but is still passed to `configureReserveAsCollateral`,
  which writes LTV, liquidation threshold and liquidation bonus together.
- **Close factor** is a protocol-wide constant in this Aave V2 fork and is not
  set per reserve; no change is required.
- **Slope-2** is immutable inside a deployed strategy, so a new
  `DefaultReserveInterestRateStrategy` is deployed (`rateStrategyDOVUv2`, only
  Slope-2 differs from `rateStrategyDOVU`) and attached via
  `setReserveInterestRateStrategyAddress`.

## Files

- `updateDovuRiskParams.ts` — the execution script (mainnet only, step-gated).
- `verifyDovuRiskParams.ts` — checks on-chain state against target values for
  every step that's been run so far.
- `bip1-state.json` — tracks which steps have executed and any addresses/tx
  hashes they produced. Written automatically by `updateDovuRiskParams.ts`,
  read by `verifyDovuRiskParams.ts`. Contains only public on-chain data
  (addresses, tx hashes), safe to commit.
- `markets/hedera/rateStrategies.ts` — adds `rateStrategyDOVUv2` (Slope-2 = 300%).

## Prerequisites

Environment (see `.env.example`, never commit secrets):

- `CHAIN_TYPE=hedera_mainnet` (the script refuses any other value)
- `PROVIDER_URL_MAINNET` — Hedera mainnet JSON-RPC endpoint
- `PRIVATE_KEY_MAINNET_ADMIN` — pool admin key (signs the configurator txns)
- `MAINNET_ADMIN_ACCOUNT_ID` — Hedera account id, required only for the
  strategy deployment step (Hedera SDK `ContractCreateFlow`)

The signer must be the current **pool admin** (`getPoolAdmin()`); all
configurator setters are `onlyPoolAdmin`.

## Execution order

Steps are commented out in `main()` and are meant to be run one at a time,
reviewing each transaction on HashScan **and running the verifier** before
proceeding to the next:

1. `deployNewRateStrategy()` — deploys `rateStrategyDOVUv2`; the resulting
   address is recorded in `bip1-state.json` automatically (step 6 reads it
   back, no manual copy-paste needed).
2. `setSupplyCap()`
3. `setBorrowCap()`
4. `configureCollateral()` — LTV / liquidation threshold / liquidation bonus
5. `setReserveFactor()`
6. `setInterestRateStrategy()` — attach the strategy from step 1

`printCurrentParams('BEFORE')` / `printCurrentParams('AFTER')` are provided to
snapshot and verify the reserve state around the change.

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run scripts/dao-proposals/bip-1/updateDovuRiskParams.ts --network hedera_mainnet
```

## Verifying each step

After uncommenting and running a step above, run the verifier to confirm the
on-chain state matches the proposal's target values:

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run scripts/dao-proposals/bip-1/verifyDovuRiskParams.ts --network hedera_mainnet
```

It reads `bip1-state.json` to see which steps have run, re-reads the relevant
on-chain data for each of those, and prints ✅/❌ per parameter (steps not yet
run print ⏭ and are skipped). Exits non-zero if any completed step fails —
useful as a gate before uncommenting the next step. Specifically:

- **Step 1** — reads back the deployed strategy's `OPTIMAL_UTILIZATION_RATE`,
  `baseVariableBorrowRate`, and both variable/stable slopes, compared against
  `rateStrategyDOVUv2`.
- **Steps 2–5** — reads `getSupplyCap` / `getBorrowCap` /
  `getReserveConfigurationData` on DOVU and compares against `TARGET`.
- **Step 6** — reads `LendingPool.getReserveData(DOVU).interestRateStrategyAddress`
  and compares it to the address recorded for step 1.
