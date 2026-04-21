# Bonzo Finance DAO — Full Technical Specification

---

## Section 1: SaucerSwap DAO Reference Model

This section is a concise technical reference of how SS DAO works, which Bonzo DAO is modelled after.

### 1.1 Governance lifecycle

SaucerSwap DAO uses a three-phase process with explicit quorum and creation thresholds at each stage. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

| Phase    | Min Duration | Creation Requirement | Quorum        | Pass Condition  | Voter Eligibility (SS) |
| -------- | ------------ | -------------------- | ------------- | --------------- | ---------------------- |
| RFC      | 3 days       | None                 | None          | Proceed to Prop | Anyone (forum only)    |
| Proposal | 2 days       | 100,000 VP           | 5,000,000 VP  | Simple majority | All token holders      |
| Election | 2 days       | Same proposer        | 15,000,000 VP | Simple majority | All token holders      |

> **Bonzo DAO modification:** Unlike SaucerSwap where all token holders can vote in both phases, Bonzo restricts the **Proposal phase** to **Governance Delegates** only (accounts with effective VP >= delegate threshold). The **Election phase** remains open to all token holders. See §1.4 and §2.10 for Bonzo-specific thresholds.

If a Proposal or Election fails quorum, the same topic cannot be re-submitted for 2 weeks. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

### 1.2 Voting power formula

Voting power is calculated from wallet balances using Hedera mirror node historical data, sampled every minute during the voting period: [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

\[
\text{VP}(t) = \text{SAUCE}(t) + (\text{xSAUCE}(t) \times \text{conversionRate}(t))
\]

SAUCE held inside LP positions is explicitly excluded from voting power. Tokens are **not locked** during voting — they only need to be in the voter's wallet at the moment balance snapshots are taken each minute. If a voter moves tokens mid-vote, their voting weight changes in proportion. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

### 1.3 Voting power delegation (Bonzo extension)

> **Note:** SaucerSwap does not currently implement voting power delegation. This section describes a Bonzo-specific extension to the SaucerSwap governance model.

Token holders can delegate their voting power to another account ("delegatee"). Delegation is full and non-transitive:

- **Full delegation** — the delegator's entire VP transfers to the delegatee. The delegator cannot vote while delegation is active (their vote would carry 0 weight).
- **Non-transitive** — if A delegates to B, and B delegates to C, then A's VP stays with B; only B's own VP flows to C.
- **Non-custodial** — tokens are not locked or moved. Delegation only affects how VP is counted during vote tallying.
- **Revocable** — a delegator can revoke at any time by submitting a REVOKE message or delegating to themselves.

Delegation is tracked via signed messages on a dedicated HCS topic (see §2.4). The backend resolves delegation state at the snapshot timestamp to compute each account's effective VP.

**Effective VP formula:**

$$
\text{VP}_{\text{effective}}(\text{account}, t)
  = \text{VP}_{\text{own}}(\text{account}, t)
  + \sum_{\text{delegators}} \text{VP}_{\text{own}}(\text{delegator}, t)
$$

Where `VP_own` is the base voting power from BONZO + xBONZO balances (§1.2).

### 1.4 Governance Delegates — restricted Proposal voting (Bonzo extension)

> **Note:** SaucerSwap allows all token holders to vote in both Proposal and Election phases. Bonzo introduces a delegate-only restriction on the Proposal phase as an additional governance safeguard.

The Proposal phase is a gatekeeper step: only **Governance Delegates** can vote. A Governance Delegate is any account whose effective VP (own + delegated) meets or exceeds the **delegate threshold** at the phase snapshot timestamp. This is not a static whitelist — eligibility is computed dynamically by the backend at vote validation time.

- **Delegate threshold (SaucerSwap reference):** Governance parameter — recommend aligning with the Proposal creation requirement or higher (see §2.10)
- **Proposal phase:** Backend rejects votes from accounts below the delegate threshold
- **Election phase:** No eligibility restriction — any token holder with VP > 0 can vote

This two-tier model ensures that proposals are vetted by stakeholders with meaningful skin in the game before going to the broader community for final ratification.

### 1.5 Vote submission mechanism (HCS)

Votes are submitted as signed JSON messages to a dedicated Hedera Consensus Service (HCS) topic. The backend service reads all messages on that topic, resolves voter balances from the mirror node at each timestamp, deduplicates (last message wins per voter per proposal), and tallies results. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

**Vote message schema:**

```json
{
  "proposalId": "42",
  "voteType": "ELECTION",
  "choice": "FOR",
  "voterAccount": "0.0.123456",
  "consensusTimestamp": "1741205823.123456789",
  "nonce": "a1b2c3"
}
```

The message is signed by the voter's Hedera private key (ED25519 or ECDSA). Message submission to HCS costs ~$0.0001. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

### 1.6 Execution model

SaucerSwap's AMM contracts are **immutable** — bytecode is never upgraded. A DAO vote mandates the multisig or a set of authorized controller accounts to execute parameter-adjustment transactions such as: creating new farms (Masterchef pool entries), adjusting emission weights, modifying treasury splits, or creating V2 liquidity pools. The multisig posts transaction IDs back to the forum thread as proof of execution. [docs.saucerswap](https://docs.saucerswap.finance/governance/overview)

### 1.7 Forum structure

The Discourse forum (`gov.saucerswap.finance`) has the following categories: General, RFC, Proposal, Election Results, Meta. All proposals must follow a template containing: Summary, Motivation, Specification (exact changes + calldata), Risk Assessment, Rollback Plan, and a defined "No change" option. [gov.saucerswap](https://gov.saucerswap.finance/t/governance-instructions-and-templates/22)

### 1.8 Legal wrapper

SaucerSwap DAO was formally registered as a Wyoming **Decentralized Unincorporated Nonprofit Association (DUNA)** in February 2026, providing legal personhood to the DAO and limited liability protection for token holders acting in good faith. [reddit](https://www.reddit.com/r/Hedera/comments/1r8ypn1/saucerswap_dao_governance_wyoming_duna_formation/)

---

## Section 2: Bonzo Finance DAO — Technical Specification

### 2.1 Architecture overview

Bonzo DAO uses the identical governance lifecycle as SaucerSwap (RFC → Proposal → Election) with four physical system components:

1. **Discourse forum** — off-chain deliberation and proposal drafting
2. **HCS Voting Service** — on-network vote submission and tallying
3. **DAO Executor Multisig (Hedera account)** — executes configuration changes after successful elections
4. **Guardian Multisig** — emergency pause only; no governance powers

Bonzo lending incentive rewards are currently stopped and are not planned to restart in the near term. DAO v1 therefore excludes lending-emissions governance and focuses on risk parameters, staking reward governance through the existing staking module, admin surfaces, emergency controls, and other existing Bonzo protocol configuration paths. All active governance-controlled protocol changes route through existing admin contracts such as `LendingPoolConfigurator`, `LendingPoolAddressesProvider`, and any existing staking-module admin surface.

---

### 2.2 Existing deployed contracts (Bonzo mainnet)

These are the contracts your DAO Executor multisig will call. [docs.bonzo](https://docs.bonzo.finance/hub/developer/bonzo-lend/lend-contracts)

| Contract                               | Address (Mainnet)                            |
| -------------------------------------- | -------------------------------------------- |
| `LendingPoolAddressesProvider`         | `0x873575d4AeeBe015AcF3BB17AAa9DD248cc76D68` |
| `LendingPoolAddressesProviderRegistry` | `0xA5B57E3d0205436Eb3bb7d0F49bf1C9E399110F8` |
| `LendingPool`                          | `0xf67DBe9bD1B331cA379c44b5562EAa1CE831EbC2` |
| `LendingPoolConfigurator` (proxy)      | `0x6Fa59558495a4D8B1701ab7924fc5a249d63cfF0` |
| `LendingPoolConfiguratorImpl`          | `0xfa36F969AA5eFef29ADb2cf895c5B286a8eD72b1` |
| `LendingPoolCollateralManager`         | `0x35426e22F51165008fD594265b789C258f68D457` |
| `AaveOracle`                           | `0x9B940a1e60D652bCaf09C1d2224d1A4a544FDFb0` |
| `PriceOracle`                          | `0xF6e755380518589dE02f0F6BaA1D291C016992Cb` |
| `LendingRateOracle`                    | `0xeC4a61EEb3d4015CCed52E51697347bf893931E7` |
| `AaveProtocolDataProvider`             | `0x121A2AFFA5f595175E60E01EAeF0deC43Cc3b024` |
| `WETHGateway (WHBARGateway)`           | `0x16197Ef10F26De77C9873d075f8774BdEc20A75d` |
| **xBONZO staking token (HTS)**         | **`0.0.8490541`**                            |

**Note:** Lending rewards-controller and lending-emissions-controller integration is intentionally out of scope for DAO v1. If Bonzo later decides to restart lending incentives, that should be treated as a separate architecture and governance workstream. This does not prevent the DAO from governing the existing staking module through multisig.

---

### 2.3 Governance token & voting power

Bonzo has both BONZO and xBONZO already deployed. The key distinction from SaucerSwap's voting mechanics: [docs.bonzo](https://docs.bonzo.finance/hub/staking-nfts-and-points/single-sided-staking)

> **BONZO** staked into the xBONZO contract is **locked inside the staking contract** — unlike SAUCE, which simply needs to be in the wallet. This means xBONZO holders have their underlying BONZO secured against vote manipulation (they can't sell BONZO mid-vote). The conversion rate improves continuously as rewards accrue.

The **base voting power** formula (mirror of SS) is:

\[
\text{VP}_{\text{own}}(t) = \text{BONZO}_{\text{wallet}}(t) + (\text{xBONZO}_{\text{wallet}}(t) \times \text{conversionRate}(t))
\]

The **effective voting power** (used for vote tallying and Governance Delegate eligibility) includes delegated VP:

\[
\text{VP}_{\text{effective}}(\text{account}, t) = \text{VP}_{\text{own}}(\text{account}, t) + \sum_{\text{delegators}} \text{VP}_{\text{own}}(\text{delegator}, t)
\]

Delegation is full: a delegator's entire `VP_own` transfers to the delegatee. The delegator's effective VP becomes 0 while delegation is active. Delegation is non-transitive (see §1.3).

**Recommended exclusions from VP:**

- BONZO deposited as collateral in Bonzo Lend (aToken balances of BONZO market)
- BONZO in LP positions on SaucerSwap
- BONZO in vesting/lockup contracts

**Token IDs to track:**

- BONZO HTS token ID — verify on HashScan; used as `IERC20` at its EVM mirror address
- xBONZO HTS token ID: `0.0.8490541` [docs.bonzo](https://docs.bonzo.finance/hub/staking-nfts-and-points/single-sided-staking)
- xBONZO EVM address: derive from `0.0.8490541` → `0x0000000000000000000000000000000000818a0d`

---

### 2.4 HCS Voting Service — implementation spec

#### 2.4.1 HCS topics to create

Create three dedicated HCS topics (no submit key, so anyone can post; tamper-evident via consensus timestamps):

| Topic                    | Purpose                                   |
| ------------------------ | ----------------------------------------- |
| `bonzo-gov-proposals`    | Records Proposal phase votes              |
| `bonzo-gov-elections`    | Records Election phase votes              |
| `bonzo-gov-delegations`  | Records delegation and revocation messages |

Optionally: a fourth `bonzo-gov-rfcs` topic for on-chain acknowledgement of RFC phase transitions.

#### 2.4.2 Delegation message schema

```json
{
  "protocol": "bonzo-dao",
  "version": "1",
  "type": "DELEGATE | REVOKE",
  "delegatorAccount": "0.0.XXXXXX",
  "delegateeAccount": "0.0.YYYYYY",
  "nonce": "uuid-v4",
  "signature": "hex(ed25519_sign(sha256(canonicalized_payload)))"
}
```

**Rules:**

- One active delegation per account — last valid message per `delegatorAccount` wins
- `DELEGATE` transfers the delegator's full VP to the delegatee
- `REVOKE` removes any active delegation (delegatee field is ignored)
- Self-delegation (`delegatorAccount == delegateeAccount`) is equivalent to REVOKE
- Delegation state is resolved at the snapshot timestamp for each voting phase
- Delegation does not lock tokens — the delegator retains full custody of their BONZO/xBONZO

#### 2.4.3 Vote message schema

```json
{
  "protocol": "bonzo-dao",
  "version": "1",
  "proposalId": "string (e.g. BIP-007)",
  "phase": "PROPOSAL | ELECTION",
  "choice": "FOR | AGAINST | ABSTAIN",
  "voterAccount": "0.0.XXXXXX",
  "eligibilityBlock": "hedera_mirror_timestamp_at_snapshot",
  "nonce": "uuid-v4",
  "signature": "hex(ed25519_sign(sha256(canonicalized_payload)))"
}
```

**Rules:**

- Only the last valid message per `(voterAccount, proposalId, phase)` tuple counts
- Messages submitted outside the voting window are rejected
- `eligibilityBlock` is set to the opening snapshot timestamp — used to look up balance at that moment
- **Proposal phase only:** Backend verifies the voter is a Governance Delegate (effective VP >= delegate threshold at snapshot). Non-delegate votes in the Proposal phase are rejected.
- **Election phase:** No eligibility restriction beyond having VP > 0

#### 2.4.4 Vote-weight engine (backend service — Node.js/TypeScript)

```typescript
// Base VP from token balances (BONZO + xBONZO)
async function computeOwnVotingPower(
  accountId: string,
  snapshotTimestamp: string, // nanosecond string from HCS
): Promise<BigNumber> {
  const mirrorUrl = `https://mainnet-public.mirrornode.hedera.com/api/v1`;

  // 1. BONZO balance at snapshot (HTS token)
  const bonzoBalance = await getTokenBalanceAtTimestamp(accountId, BONZO_TOKEN_ID, snapshotTimestamp);

  // 2. xBONZO balance at snapshot
  const xBonzoBalance = await getTokenBalanceAtTimestamp(accountId, XBONZO_TOKEN_ID, snapshotTimestamp);

  // 3. xBONZO conversion rate at snapshot
  const conversionRate = await getConversionRateAtBlock(snapshotTimestamp);

  // 4. Exclude BONZO in aTokens (collateral) + LP positions
  const excludedBonzo = await getExcludedBonzo(accountId, snapshotTimestamp);

  const rawBonzo = bonzoBalance.sub(excludedBonzo);
  const xBonzoAsBonzo = xBonzoBalance.mul(conversionRate).div(WAD);

  return rawBonzo.add(xBonzoAsBonzo);
}

// Effective VP including delegated power
async function computeEffectiveVotingPower(
  accountId: string,
  snapshotTimestamp: string,
): Promise<BigNumber> {
  // 1. Own VP
  const ownVP = await computeOwnVotingPower(accountId, snapshotTimestamp);

  // 2. Resolve delegation state at snapshot from bonzo-gov-delegations topic
  // Find all accounts that have delegated to this accountId (last-message-wins per delegator)
  const delegators = await getActiveDelegatorsAt(accountId, snapshotTimestamp);

  // 3. Sum delegated VP (non-transitive: only count delegators' own VP, not their received delegations)
  let delegatedVP = BigNumber.from(0);
  for (const delegator of delegators) {
    delegatedVP = delegatedVP.add(await computeOwnVotingPower(delegator, snapshotTimestamp));
  }

  // 4. If this account has delegated to someone else, their own VP is 0
  const hasActiveDelegation = await hasDelegatedToOther(accountId, snapshotTimestamp);
  if (hasActiveDelegation) {
    return delegatedVP; // own VP transferred to delegatee
  }

  return ownVP.add(delegatedVP);
}

// Governance Delegate check (for Proposal phase eligibility)
async function isGovernanceDelegate(
  accountId: string,
  snapshotTimestamp: string,
  delegateThreshold: BigNumber, // e.g. 500,000 VP
): Promise<boolean> {
  const effectiveVP = await computeEffectiveVotingPower(accountId, snapshotTimestamp);
  return effectiveVP.gte(delegateThreshold);
}
```

**Snapshot frequency:** Mirror every 60 seconds during the voting period (same as SS). Final VP = average of all valid snapshots OR VP at opening snapshot (recommended: use opening snapshot to prevent last-minute manipulation).

---

### 2.5 Multisig setup (Hedera)

Hedera does not have a Gnosis Safe-equivalent natively, but you can implement this in two ways:

**Option A (simplest, like SS):** Use a Hedera multi-sig account (key type = `KeyList` with threshold):

```
KeyList {
  threshold: 3,
  keys: [key1, key2, key3, key4, key5]  // 3-of-5
}
```

The account ID becomes the PoolAdmin. Each multisig signer constructs the transaction, gathers signatures off-chain (via a coordination channel like Telegram / private forum), and one signer broadcasts the fully-signed Hedera transaction.

**Option B (more decentralised):** Deploy a Solidity multisig (e.g. Safe-like) on Hedera EVM. The EVM contract address becomes the `poolAdmin` in `LendingPoolAddressesProvider`. This enables on-chain audit trail of signatures and a proper timelock.

**Recommended for Bonzo v1 DAO:** Option A with 3-of-5 signers. Upgrade to Option B (EVM multisig + 48h timelock) as DAO matures.

#### Multisig accounts to create

| Multisig             | Role         | Threshold | Controls                                                      |
| -------------------- | ------------ | --------- | ------------------------------------------------------------- |
| `bonzo-dao-executor` | DAO Executor | 3-of-5    | `setPoolAdmin`, `LendingPoolConfigurator`, staking-module admin actions |
| `bonzo-guardian`     | Emergency    | 2-of-3    | `setPoolPause(true/false)` only                               |

---

### 2.6 Aave v2 parameters changeable by the DAO multisig

All of these are callable from `LendingPoolConfigurator` (`0x6Fa59558495a4D8B1701ab7924fc5a249d63cfF0`), gated by `onlyPoolAdmin` (the DAO Executor multisig). [git.instadapp](https://git.instadapp.io/Instadapp/aave-protocol-v2/src/commit/b387bcf8454d3cd43c2d5f32b6f90874dbd51155/contracts/lendingpool/LendingPoolConfigurator.sol)

#### Per-reserve risk parameters

| Function                                                 | Description                  | Example calldata                                    |
| -------------------------------------------------------- | ---------------------------- | --------------------------------------------------- |
| `setLtv(asset, ltv)`                                     | Max loan-to-value            | `setLtv(WHBAR_addr, 6500)` = 65%                    |
| `setLiquidationThreshold(asset, threshold)`              | Liquidation trigger          | `setLiquidationThreshold(WHBAR_addr, 7000)` = 70%   |
| `setLiquidationBonus(asset, bonus)`                      | Bonus for liquidators        | `setLiquidationBonus(WHBAR_addr, 10500)` = 5% bonus |
| `setReserveFactor(asset, reserveFactor)`                 | Protocol fee cut             | `setReserveFactor(USDC_addr, 1000)` = 10%           |
| `enableBorrowingOnReserve(asset, stableEnabled)`         | Allow borrowing              | `enableBorrowingOnReserve(BONZO_addr, false)`       |
| `disableBorrowingOnReserve(asset)`                       | Disable borrowing            | Used for deprecation                                |
| `setReserveInterestRateStrategyAddress(asset, strategy)` | Change interest rate curve   | Set to a new deployed strategy contract             |
| `activateReserve(asset)`                                 | Activate a paused reserve    |                                                     |
| `deactivateReserve(asset)`                               | Remove a reserve from active |                                                     |
| `freezeReserve(asset)`                                   | Block new deposits + borrows | Emergency/deprecation                               |
| `unfreezeReserve(asset)`                                 | Re-enable frozen reserve     |                                                     |

#### Listing new reserves (high-impact, higher quorum recommended)

```solidity
// Calldata for adding a new asset (e.g. a new HTS token)
struct InitReserveInput {
    address aTokenImpl;
    address stableDebtTokenImpl;
    address variableDebtTokenImpl;
    uint8 underlyingAssetDecimals;
    address interestRateStrategyAddress;
    address underlyingAsset;
    address treasury;
    address incentivesController;
    string underlyingAssetName;
    string aTokenName;
    string aTokenSymbol;
    string variableDebtTokenName;
    string variableDebtTokenSymbol;
    string stableDebtTokenName;
    string stableDebtTokenSymbol;
    bytes params;
}
LendingPoolConfigurator.batchInitReserve(InitReserveInput[])
```

#### Proxy upgrades (critical — highest quorum recommended)

| Function                                        | Description                                |
| ----------------------------------------------- | ------------------------------------------ |
| `updateAToken(UpdateATokenInput)`               | Upgrade aToken implementation (proxy swap) |
| `updateStableDebtToken(UpdateDebtTokenInput)`   | Upgrade stable debt token                  |
| `updateVariableDebtToken(UpdateDebtTokenInput)` | Upgrade variable debt token                |

#### AddressesProvider-level (owner of the provider = DAO timelock or top-level DAO account)

| Function                                  | Description                |
| ----------------------------------------- | -------------------------- |
| `setPoolAdmin(address)`                   | Reassign PoolAdmin         |
| `setEmergencyAdmin(address)`              | Reassign EmergencyAdmin    |
| `setLendingPoolImpl(address)`             | Upgrade LendingPool proxy  |
| `setLendingPoolConfiguratorImpl(address)` | Upgrade Configurator proxy |
| `setPriceOracle(address)`                 | Change price oracle        |
| `setLendingRateOracle(address)`           | Change rate oracle         |

#### Emergency admin (Guardian multisig only)

```solidity
// LendingPoolConfigurator
setPoolPause(bool val)  // pauses/unpauses entire pool
```

---

### 2.7 Deferred incentives module

Lending incentives are explicitly out of scope for Bonzo DAO v1.

Current assumptions:

- Bonzo lending incentive rewards are stopped.
- DAO v1 does not configure lending emissions, lending reward epochs, or lending reward funding.
- DAO v1 does not require a new lending incentives controller, rewards controller, or transfer strategy.
- DAO v1 may still govern staking reward changes through the existing staking module and multisig execution path.

Future scope boundary:

- If lending incentives are reintroduced later, that work should be specified as a separate module.
- That future module can evaluate whether to reuse an existing controller stack or deploy a new one.
- Lending-incentives governance should not be implied by the initial DAO rollout.

---

### 2.8 Governance surfaces (forum + voting UI)

#### Discourse forum setup

| Setting           | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| Domain            | `gov.bonzo.finance`                                             |
| Hosting           | Communiteq (managed Discourse) or self-hosted on Railway/Fly.io |
| Categories        | General, RFCs, Proposals, Elections, Treasury Reports, Meta     |
| Post restriction  | Proposals category: trust level 2+ (prevents spam)              |
| Proposal template | See §2.9 below                                                  |

#### Voting UI

Embed a governance panel inside the existing Bonzo Finance app at `app.bonzo.finance/governance` with:

- List of active RFCs / Proposals / Elections (pulled from Discourse API + HCS topic)
- Vote button → triggers `TopicMessageSubmitTransaction` to HCS via connected wallet (HashPack / MetaMask)
- Live vote tally (polling HCS topic messages, resolving balances from mirror node)
- **Quorum progress bar** — shows current VP tallied vs. required quorum (e.g. "7.26M / 15M VP")
- **Voter list** — shows each voter's account, choice, and VP weight (see "Election phase — real-world examples" below)
- Voter history (all votes cast by connected account)
- **Governance Delegate badge** — indicator showing whether the connected account qualifies as a Governance Delegate

#### Delegation UI

The governance panel at `app.bonzo.finance/governance` should include a delegation management section:

- **Delegate** — select a delegatee account and submit a signed DELEGATE message to the `bonzo-gov-delegations` HCS topic
- **Revoke** — submit a REVOKE message to remove active delegation
- **Current delegation status** — shows who you have delegated to (if any)
- **Delegators list** — shows accounts that have delegated their VP to you, with each delegator's VP
- **Effective VP display** — shows own VP + delegated VP = total effective VP

#### RFC phase — format and examples

RFCs are community discussions posted on `gov.bonzo.finance` in the **RFCs** category. They have no quorum, no on-chain voting, and no VP threshold. Their purpose is to gather community feedback and refine a proposal before it enters the formal voting pipeline.

**Expected RFC format** (based on SaucerSwap governance patterns):

- **Title:** `[RFC] Proposal to [action description]`
- **Author(s)** and submission date
- **Summary** — one-paragraph TL;DR
- **Abstract** — expanded context and background
- **Motivation** — why this change is needed, key data points (market cap, holders, volume, etc.)
- **Specification & Rationale** — technical details (token pair, contract addresses, parameter changes)
- **Financial impact** — requested allocation, adjustments to existing parameters, which existing allocations are affected
- **Benefits / Risks** — pros and cons
- **Voting options** — Yes / No

**Reference example — SaucerSwap DOSA yield farming RFC:**

A community member (DOSA Team) posted an RFC requesting activation of 1.40% yield farming for the V1 HBAR/DOSA pool. The RFC included market cap (~$350K), holder count (~1,060), token ID, social links, specification of which existing farm weight to reduce (HBAR/BSL: 1.40% → 0.00%), and clear Yes/No voting options. A previous proposal had achieved majority "yes" but failed quorum, demonstrating the importance of community mobilization.

**Reference example — SaucerSwap Top Flight Football RFC:**

A project founder posted an RFC requesting 0.75% farm weight for the HBAR/FOOTBALL V1 pool. The RFC detailed the project's sports-gaming use case, INO results, and proposed weight adjustments across three existing pools (HBAR/KARATE, HBAR/DINO, HBAR/BSL). Community members responded requesting a Sentinel report (independent token rating), showing the role of community vetting during the RFC phase.

RFCs should remain open for a minimum of 3 days before the author can advance to a formal Proposal.

#### Election phase — real-world examples (SaucerSwap reference)

These SaucerSwap election outcomes illustrate how quorum determines success or failure, regardless of vote direction:

**Failed election — DOSA yield farming (August 2025):**

| Metric | Value |
| --- | --- |
| Total votes | 52 |
| Quorum required | 15,000,000 VP |
| Quorum reached | 7,260,000 VP (48.4%) |
| Result breakdown | 98.62% YES, 1.38% AGAINST |
| **Outcome** | **Failed — quorum not met** |

Despite near-unanimous support (98.62% YES), the election failed because quorum was not reached. Only 7.26M of the required 15M VP participated. This demonstrates that **quorum is a hard gate** — strong sentiment alone is insufficient.

**Passed election — USDT0 pool creation (March 2026):**

| Metric | Value |
| --- | --- |
| Total votes | 9 |
| Quorum required | 15,000,000 VP |
| Quorum reached | 21,460,000 VP (143%) |
| Result breakdown | 100% YES, 0% AGAINST |
| **Outcome** | **Passed — quorum met, majority achieved** |

Only 9 voters participated, but several held large positions (8.33M and 8.14M VP), easily clearing the 15M quorum threshold. This shows that **few voters with high VP can meet quorum** and that the system works with concentrated participation.

**Bonzo equivalents (scaled thresholds):**

Bonzo's recommended thresholds are lower than SaucerSwap's to account for a smaller circulating supply. A Bonzo election would require 5,000,000 VP quorum (vs. SS's 15,000,000), making quorum more achievable while still requiring meaningful community participation.

---

### 2.9 Proposal template

Every Proposal and Election post must include:

```markdown
## [BIP-XXX] — Title

**Phase:** RFC | Proposal | Election
**Author:** @handle
**Date:** YYYY-MM-DD
**Related RFC:** link

---

### Summary

One paragraph TL;DR.

### Motivation

Why is this change needed? What problem does it solve?

### Specification

Exact changes to be made. For each action:

- **Contract:** `0xAddress` (ContractName)
- **Function:** `functionName(types)`
- **Arguments:** { param: value, ... }
- **Expected event:** `EventName(args)`

### Risk Assessment

- Smart contract risk (if any upgrade)
- Market risk (if changing LTV/liquidation params)
- Liquidity risk (if changing reserve config or market availability)

### Rollback Plan

How to reverse this change if it goes wrong.

### Voting Options

- FOR — Apply the specification above
- AGAINST — Take no action
- ABSTAIN — Counted for quorum, not direction
```

---

### 2.10 Governance thresholds (recommended for Bonzo)

Mirror SS thresholds scaled to BONZO's circulating supply. Adjust these once BONZO supply is better understood.

| Parameter                               | SaucerSwap (reference) | Bonzo (recommended)                     |
| --------------------------------------- | ---------------------- | --------------------------------------- |
| RFC minimum duration                    | 3 days                 | 3 days                                  |
| Proposal creation requirement           | 100,000 VP             | 100,000 VP (effective VP)               |
| **Governance Delegate threshold**       | N/A                    | **500,000 VP (effective VP)**           |
| Proposal voter eligibility              | All token holders      | **Governance Delegates only**           |
| Proposal quorum                         | 5,000,000 VP           | 2,500,000 VP (scale up as supply grows) |
| Proposal duration                       | 2 days                 | 2 days                                  |
| Election voter eligibility              | All token holders      | All token holders with VP > 0           |
| Election quorum                         | 15,000,000 VP          | 5,000,000 VP                            |
| Election duration                       | 2 days                 | 2 days                                  |
| Failed quorum cooldown                  | 2 weeks                | 2 weeks                                 |
| Multisig execution deadline             | N/A                    | 5 days after Election passes            |
| High-risk action (proxy upgrade) quorum | N/A                    | 10,000,000 VP (special threshold)       |

---

### 2.11 Full execution runbook (post-election)

Once an Election passes, the DAO Executor multisig runs the following:

**Step 1 — Parse and simulate**

```bash
# Decode proposal calldata and simulate on a Hedera testnet fork
npx hardhat run scripts/simulate-proposal.ts --network hedera-fork \
  --proposal BIP-007 \
  --actions actions.json
```

**Step 2 — Construct Hedera transactions**

For EVM contract calls (for example `LendingPoolConfigurator`), use `ContractExecuteTransaction`:

```typescript
const tx = new ContractExecuteTransaction()
  .setContractId(ContractId.fromEvmAddress(0, 0, CONFIGURATOR_EVM))
  .setGas(500_000)
  .setFunction("setLtv", new ContractFunctionParameters().addAddress(assetEvmAddress).addUint256(6500));
const signedTx = await tx.sign(signer1PrivateKey).sign(signer2PrivateKey).sign(signer3PrivateKey).execute(client);
```

**Step 3 — Verify on-chain**

- Confirm events emitted match proposal specification
- Confirm data via `AaveProtocolDataProvider.getReserveConfigurationData(asset)`

**Step 4 — Post-execution report**
Post to the Discourse Election thread:

```markdown
## ✅ Execution Report — BIP-007

**Executed by:** bonzo-dao-executor (0.0.XXXXX)
**Hedera TX IDs:** 0.0.XXXXX@1741205823 | 0.0.XXXXX@1741205901
**HashScan links:** [link] [link]
**Decoded actions confirmed:** YES
**Data verification:** [AaveProtocolDataProvider output screenshot/JSON]
```

---

### 2.12 Recommended build sequence

1. **Week 1:** Deploy `bonzo-dao-executor` Hedera KeyList account (3-of-5). Transfer `LendingPoolAddressesProvider` ownership and `poolAdmin` role to it.
2. **Week 2:** Launch Discourse forum at `gov.bonzo.finance`. Publish governance instructions + proposal template. Create three HCS topics (`bonzo-gov-proposals`, `bonzo-gov-elections`, `bonzo-gov-delegations`), record their Topic IDs.
3. **Week 3:** Build and deploy HCS Voting Service backend (Node.js) including delegation indexing, effective VP computation, and Governance Delegate eligibility checks. Integrate governance panel (voting + delegation UI) into the Bonzo app. Run testnet dry-run of a full RFC → Proposal (delegate-only) → Election (open) → Execution cycle.
4. **Week 4:** Run BIP-001 (a low-stakes parameter change, e.g. adjusting one `reserveFactor` by 1%) as a live DAO vote to validate the system end-to-end. Seed initial delegations from early governance participants.
5. **Later optional scope:** If Bonzo decides to restart incentives, define a separate incentives-governance module and rollout plan.

