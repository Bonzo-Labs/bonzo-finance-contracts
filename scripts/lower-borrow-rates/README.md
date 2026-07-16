# Lower Borrow Rates — All Hedera Mainnet Reserves

Reduces `variableRateSlope1` and `variableRateSlope2` for all 14 configured
reserves. Slopes are `immutable` in `DefaultReserveInterestRateStrategy`, so
each reserve gets a **freshly deployed strategy** (all other params preserved
from the live on-chain strategy) which is then wired in via
`setReserveInterestRateStrategyAddress`.

## Safe while paused

`setReserveInterestRateStrategyAddress` is a pool-admin action:
`LendingPoolConfigurator` (`onlyPoolAdmin`) → `LendingPool`
(`onlyLendingPoolConfigurator`). **Neither hop has `whenNotPaused`**, so this
runs with the protocol paused. No unpause is performed or required.

The script reads every reserve's current strategy and parameters live before
deploying its replacement. Existing deployment and wiring records remain in
`rate-update-state.json`; missing reserves start with an empty current entry.

## Configure targets

The approved target is defined centrally in `rateConfig.ts` using decimal
strings so JavaScript floating-point conversion is not involved:

```text
baseVariableBorrowRate = 0
variableRateSlope1     = 0.005% (script decimal 0.00005)
variableRateSlope2     = 0.005% (script decimal 0.00005)
maximum variable rate = 0.01%
```

Each reserve changes its base and `variableRateSlope1/2`.
`optimalUtilization` and the stable slopes are always preserved. A guard
**refuses to deploy** unless every target is a genuine reduction (≤ current for
base and both slopes, `<` for at least one).

`wireStrategy` fully validates the deployed strategy before pointing a reserve at
it: bytecode present + matching the recorded hash, `addressesProvider` matches
the live pool, every param equals the recorded intent, and the address differs
from the current strategy. The deploy step records a full audit trail (Hedera tx
id, consensus timestamp, contract/EVM address, runtime bytecode hash, deployer,
constructor params) in `rate-update-state.json`.

Hedera JSON-RPC may briefly return `0x` for a newly created contract even after
the SDK receipt is available. The deploy step waits for two consecutive,
matching, non-empty runtime-code reads before hashing and recording the code. A
legacy empty-code hash can only be reconciled after the deployed strategy's
provider and every recorded parameter have been verified on-chain.

## Env

- `CHAIN_TYPE=hedera_mainnet` (guarded)
- `PROVIDER_URL_MAINNET` — JSON-RPC URL (read/verify)
- `PRIVATE_KEY_MAINNET_ADMIN` — pool-admin ECDSA key (strategy deploy + wire)
- `MAINNET_ADMIN_ACCOUNT_ID` — Hedera account id for the SDK deploy
- `PRIVATE_KEY_MAINNET_PROXY` — optional transaction payer for deploying the
  atomic executor; falls back to the admin key if absent

## Run

Inspect current state first (no edits needed):

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/lowerBorrowRates.ts --network hedera_mainnet
```

Deploy and wire one reserve at a time by uncommenting exactly one
`deployNewStrategy(...)` or `wireStrategy(...)` call in `main()`, then running
the same command. After each deploy and wire pair, run the read-only verifier:

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/verifyBorrowRates.ts --network hedera_mainnet
```

Deployed addresses, preserved params and tx hashes are recorded in
`rate-update-state.json`, which the verifier reads back.

### Rerunning after the intermediate 1% strategies

The state file is rewritten after each successful deployment and wiring
transaction. When a replacement deployment is recorded, the script:

1. moves the reserve's previous `deploy` and `wire` records into its `history`;
2. writes the new `deploy` record; and
3. removes the active `wire` record until the replacement strategy is actually
   wired.

This prevents an old `wire.completed: true` value from being combined with a
new deployment address. After the subsequent wire transaction, the active
`wire` record is written with the new transaction hash and strategy address.
Do not manually replace the existing JSON before rerunning because it is the
audit record of the currently wired 1% strategies.

## Phase 2: atomic stored-rate refresh

Swapping a strategy does not update its reserve's stored borrow rate. The safe
refresh path is `AtomicRatePokeExecutor.sol`, a non-upgradeable, four-batch
contract that executes the following inside each batch transaction:

```text
unpause -> mode-0 flash loan of one atomic unit per batch reserve -> pause
```

The four immutable batches are `WHBAR/USDC/WETH`,
`BONZO/HBARX/SAUCE/XSAUCE`, `KARATE/GRELF/DOVU/HST`, and
`PACK/STEAM/KBL`. Each flash loan calls `updateState()` and
`updateInterestRates()` for only its batch. The reserves stay frozen. Any
failure reverts that complete batch transaction, including the unpause, and no
external transaction can interleave. The pool remains paused between batches.

`deployAndTestAtomicRatePokeExecutor.ts` verifies the live roles, pool pause,
all reserve freezes, strategy wiring, every recorded strategy runtime hash and
full constructor parameter set, and target liquidity. It then deploys and
validates the runtime against the current compiled source while masking only the
known immutable slots, and verifies the protocol addresses, constructor-fixed
reserve configuration, empty completion bitmap, and emergency-admin gate. It
never changes a protocol role.

The deployer does not become the executor controller and does not need a
protocol role. The controller is read from the AddressesProvider owner. Before
broadcasting, the script estimates constructor gas and applies a 10% buffer.
This remains below Hedera's 25% break-even point for its 80%-of-limit charging
floor, so the buffer should not increase charged gas when actual usage is near
the estimate. Estimation uses the public Hashio mainnet relay because the configured
relay rejects contract-creation simulations despite accepting reads and broadcasts.
If Hashio is unavailable, deployment stops unless an explicitly reviewed
`ATOMIC_EXECUTOR_DEPLOY_GAS_LIMIT` is supplied. An override must be at least 5%
above a live estimate when one is available. Failed deployment receipts remain
available on-chain; the JSON state tracks only the current executor attempt.

```bash
# Read-only preflight
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/deployAndTestAtomicRatePokeExecutor.ts --network hedera_mainnet

# Deploy and validate
CHAIN_TYPE=hedera_mainnet CONFIRM_DEPLOY_ATOMIC_RATE_EXECUTOR=DEPLOY \
  npx hardhat run scripts/lower-borrow-rates/deployAndTestAtomicRatePokeExecutor.ts \
  --network hedera_mainnet
```

The deployment is recorded in `atomic-rate-poke-state.json`. Every confirmed
invocation deploys a fresh executor. It never resumes or reuses an executor from
the existing state file. Before deployment, the current sanitised audit state
is appended to the new file's `previousExecutors` array, so an uncommitted state
file is not silently overwritten. The preflight independently requires the
on-chain emergency admin to be the AddressesProvider owner before any new
deployment is broadcast.

`executeAtomicRatePoke.ts` verifies that deployment, assigns emergency admin to
the executor, simulates every remaining batch, executes the remaining batches,
and restores the original EOA. Each confirmed batch is recorded both in the
executor's on-chain completion bitmap and in the `execution.batches` section of
`atomic-rate-poke-state.json`. On restart, the on-chain bitmap is authoritative:
completed batches are skipped and a missing local checkpoint is reconstructed
from the executor event. The script refuses to continue if the JSON claims more
progress than the contract. If reconciliation finds all four batches complete,
the script also clears stale active-transaction and error fields and finalises
the JSON without sending another transaction.

Restoration runs from `finally` and is based on whether a handoff transaction
was submitted, so a stale role read cannot skip restoration. If the pool is
observed open, the script first calls the executor's pause-only rescue path. All
remaining batches must pass `callStatic` simulation before the first batch is
broadcast. The pool-admin role never changes.

```bash
# Read-only preflight
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/executeAtomicRatePoke.ts --network hedera_mainnet

# Handoff, execute, and restore
CHAIN_TYPE=hedera_mainnet CONFIRM_ATOMIC_RATE_REFRESH=HANDOFF_EXECUTE_RESTORE \
  npx hardhat run scripts/lower-borrow-rates/executeAtomicRatePoke.ts \
  --network hedera_mainnet
```

The previous multi-transaction reopen script was removed. Its threat model and
the reason it was rejected remain documented in
`docs/atomic-rate-poke-emergency-admin-flow.md`.

The focused mock suite covers all four batches, completion checkpoints,
duplicate-batch rejection, failed-final-pause rollback, role and callback
gates, zero aToken supply, and pause-only rescue:

```bash
SKIP_LOAD=true npx hardhat test test/atomic-rate-poke-executor.spec.ts --network hardhat
```

This mock suite does not replace the reproduced-mainnet-state rehearsal required
by `docs/atomic-rate-poke-emergency-admin-flow.md` before any mainnet handoff.

## Containment: freeze all reserves (`freezeAssets.ts`)

Freeze is a separate, lighter containment posture than a full pause: a **frozen**
reserve rejects new deposits and new borrows but **still allows withdraw, repay
and liquidation**, so users are not trapped the way a global pause traps them.

`freezeAssets.ts` (signer `PRIVATE_KEY_MAINNET_ADMIN`, pool admin) has two
functions:

- `status()` — prints the frozen/active map for every reserve (default action).
- `freezeAll()` — freezes every reserve that is **not already frozen**
  (already-frozen ones are detected and skipped). It writes `freeze-state.json`
  **after each tx**, so a crash mid-loop leaves an accurate record of exactly
  what was frozen. A `TX_DELAY_MS` (default 2000) pause between txs avoids
  stale-nonce issues from the Hedera relay.

Unfreezing is intentionally **not** in this script. Reverse containment is a
separate, deliberate action.

```bash
CHAIN_TYPE=hedera_mainnet npx hardhat run \
  scripts/lower-borrow-rates/freezeAssets.ts --network hedera_mainnet
```

It prints `status()` by default. Uncomment `freezeAll()` in `main()` only when
all currently active reserves should be frozen.

## Notes

- "slope 1 / slope 2" here = the **variable** borrow-rate curve
  (`variableRateSlope1/2`). Stable slopes are preserved; extend `TARGETS` and the
  deploy override if you also want to change them.
- **Stable borrowing stays OFF.** No script enables it (nothing calls
  `enableReserveStableRate` / `enableBorrowingOnReserve`). As a safety net, every
  script surfaces the reserve-level `stableBorrowRateEnabled` flag: the poke
  preflight and the verifier **fail** if it is on for a target reserve, and
  `lowerBorrowRates` / `freezeAssets` warn. Note this reserve flag is independent
  of the strategy's stable _slopes_ (which we preserve but which are inert while
  the flag is off).
- Lowering slopes only changes the rate **curve**; rates recompute on the next
  reserve interaction (deposit/borrow/repay) after unpause.
- The atomic flash loan borrows and repays one atomic unit per target with zero
  premium at the configured 9-basis-point fee. It leaves no aToken balance and
  does not require any reserve to be unfrozen.
