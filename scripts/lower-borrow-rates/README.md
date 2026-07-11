# Lower Borrow Rates — WHBAR / WETH / USDC (Hedera Mainnet)

Reduces `variableRateSlope1` and `variableRateSlope2` for the WHBAR, WETH and
USDC reserves. Slopes are `immutable` in `DefaultReserveInterestRateStrategy`,
so each reserve gets a **freshly deployed strategy** (all other params preserved
from the live on-chain strategy) which is then wired in via
`setReserveInterestRateStrategyAddress`.

## Safe while paused

`setReserveInterestRateStrategyAddress` is a pool-admin action:
`LendingPoolConfigurator` (`onlyPoolAdmin`) → `LendingPool`
(`onlyLendingPoolConfigurator`). **Neither hop has `whenNotPaused`**, so this
runs with the protocol paused. No unpause is performed or required.

## Current on-chain values (read 2026-07-11)

| Reserve | optimalU | base | variableRateSlope1 | variableRateSlope2 | live strategy |
|---------|---------:|-----:|-------------------:|-------------------:|---------------|
| WHBAR   | 55%      | 0%   | 6.0%               | 150%               | `0x82c5…6d58` |
| USDC    | 85%      | 2%   | 13.0%              | 50%                | `0x…928b25`   |
| WETH    | 80%      | 0%   | 3.3%               | 85%                | `0x…99ab66`   |

> The `outputReserveData.json` manifest is **stale** for these strategy
> addresses; the scripts read the live address from `LendingPool.getReserveData`.

## Configure targets

Edit `TARGETS` in `lowerBorrowRates.ts` (human decimals, `0.06` = 6%). Each
reserve changes `variableRateSlope1/2`; `baseVariableBorrowRate` is optional
(`newBaseVariableBorrowRate` — omit to preserve, set to override, e.g. USDC `0`).
`optimalUtilization` and the stable slopes are always preserved. A guard
**refuses to deploy** unless every target is a genuine reduction (≤ current for
base and both slopes, `<` for at least one), so pre-filled current values are
inert until you lower them.

Current targets: WHBAR/WETH slope1 1%, slope2 1% (base 0% preserved); USDC
slope1 1%, slope2 1%, base 2%→0%. At 100% utilisation that caps the variable
borrow rate at ~2% on all three.

`wireStrategy` fully validates the deployed strategy before pointing a reserve at
it: bytecode present + matching the recorded hash, `addressesProvider` matches
the live pool, every param equals the recorded intent, and the address differs
from the current strategy. The deploy step records a full audit trail (Hedera tx
id, consensus timestamp, contract/EVM address, runtime bytecode hash, deployer,
constructor params) in `rate-update-state.json`.

## Env

- `CHAIN_TYPE=hedera_mainnet` (guarded)
- `PROVIDER_URL_MAINNET` — JSON-RPC URL (read/verify)
- `PRIVATE_KEY_MAINNET_ADMIN` — pool-admin ECDSA key (deploy + wire)
- `MAINNET_ADMIN_ACCOUNT_ID` — Hedera account id for the SDK deploy

## Run (step-gated)

Inspect current state first (no edits needed):

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/lowerBorrowRates.ts --network hedera_mainnet
```

Then, per reserve, uncomment `deployNewStrategy('X')` then `wireStrategy('X')`
in `main()` and re-run — verifying between steps:

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/verifyBorrowRates.ts --network hedera_mainnet
```

Deployed addresses, preserved params and tx hashes are recorded in
`rate-update-state.json`, which the verifier reads back.

## Phase 2 (optional): refresh stored rates via a controlled reopen

Swapping the strategy does **not** refresh a reserve's stored
`currentVariableBorrowRate` - that only updates when `updateInterestRates` runs,
and every path that calls it is `whenNotPaused`. The new strategy is already
active (it applies automatically on the first real interaction after you
reopen), so this phase is **only** needed if you want the stored/displayed rate
refreshed while the protocol is otherwise kept closed.

`pokeRatesReopen.ts` does, in order: `approveAll` (proxy, while paused) →
`preflight` → `reopenSequence` (`unpause` → dust deposit ×3 → `pause`).

> **RUN ONLY AFTER THE ORACLE ROOT CAUSE IS PATCHED.** `setPoolPause` is
> protocol-wide - unpausing re-opens **every** reserve for the whole window.

> The target reserves must be **UNFROZEN** for the dust deposit to work (a frozen
> reserve rejects `deposit`). If you froze them via `freezeAssets.ts`, unfreeze
> the three targets first (`unfreezeOne`), poke, then re-freeze (`freezeOne`).

**Preflight.** `preflight()` aborts (listing all problems) unless: pool is
paused; the admin holds both emergency and pool admin roles; oracle remediation
is attested (`ORACLE_REMEDIATION_CONFIRMED=true`, plus an optional
`EXPECTED_ORACLE_SOURCES` adapter-address check); each strategy was deployed by
the current pool admin and has matching bytecode/hash, params and addresses
provider, is still the wired strategy, its reserve is active and not frozen, and
its stored rate is unchanged since wiring; proxy balances and allowances are
sufficient.

Two signers, by design:

- `PRIVATE_KEY_MAINNET_ADMIN` — pause/unpause (must hold the emergency-admin
  role; also the pool admin for the earlier strategy swaps).
- `PRIVATE_KEY_MAINNET_PROXY` (+ `MAINNET_PROXY_ACCOUNT_ID`) — the dust deposits;
  must hold dust WHBAR/USDC/WETH (WHBAR = the wrapped HTS token, not bare HBAR)
  and receives the dust aTokens. The account id is informational for the
  ethers-based deposits (only the key signs).

Extra env for Phase 2: `PRIVATE_KEY_MAINNET_PROXY`, `MAINNET_PROXY_ACCOUNT_ID`,
and `ORACLE_REMEDIATION_CONFIRMED=true` (set only after the Supra patch is
verified). Steps are commented in `main()`; uncomment `approveAll()`, then
`reopenSequence()`.

## Containment: freeze all reserves (`freezeAssets.ts`)

Freeze is a separate, lighter containment posture than a full pause: a **frozen**
reserve rejects new deposits and new borrows but **still allows withdraw, repay
and liquidation**, so users are not trapped the way a global pause traps them.

`freezeAssets.ts` (signer `PRIVATE_KEY_MAINNET_ADMIN`, pool admin) freezes every
reserve that is not already frozen (some are already frozen; those are detected
and **skipped**), and snapshots the pre-state to `freeze-state.json` so
`unfreezeThisRun()` reverses **only** what this script froze. `status()` prints
the current frozen/active map; `freezeOne`/`unfreezeOne` handle a single reserve
(e.g. to unfreeze a target for the rate poke, then re-freeze).

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/freezeAssets.ts --network hedera_mainnet
```

Steps are commented in `main()`; it prints `status()` by default, then uncomment
`freezeAll()` (or the granular helpers).

## Notes

- "slope 1 / slope 2" here = the **variable** borrow-rate curve
  (`variableRateSlope1/2`). Stable slopes are preserved; extend `TARGETS` and the
  deploy override if you also want to change them.
- Lowering slopes only changes the rate **curve**; rates recompute on the next
  reserve interaction (deposit/borrow/repay) after unpause.
- The dust deposits leave the signer with a tiny aToken balance in each reserve;
  withdraw it at the real reopening or just leave it.
- If you have separately **frozen** any of these reserves (not just paused),
  `deposit` will revert (`VL_RESERVE_FROZEN`) - unfreeze before poking.
