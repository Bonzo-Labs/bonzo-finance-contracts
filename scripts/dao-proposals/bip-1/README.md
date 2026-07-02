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
reviewing each transaction on HashScan before proceeding:

1. `deployNewRateStrategy()` — deploy `rateStrategyDOVUv2`; copy the printed EVM
   address into `NEW_RATE_STRATEGY_ADDRESS` in the script.
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
