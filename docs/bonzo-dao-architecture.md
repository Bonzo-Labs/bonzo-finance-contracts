# Bonzo DAO v1 Technical Architecture

## 1. System Overview

Bonzo DAO v1 is composed of the following components:

| Component | Type | Responsibility |
| --- | --- | --- |
| Discourse forum | Off-chain | RFC discussion, proposal drafting, final proposal publication |
| Governance backend | Off-chain | Indexes forum proposals, validates vote messages, resolves delegation state, materializes executable action bundles |
| HCS vote topics | Hedera native | Ordered vote-message transport for Proposal and Election phases |
| HCS delegation topic | Hedera native | Ordered delegation/revocation message transport |
| Mirror-node vote-weight engine | Off-chain | Computes effective voting power from BONZO/xBONZO balances + delegated VP at snapshot timestamps |
| DAO executor multisig | HederaGnosisSafe multisig (EVM) | Executes passed proposal action bundles against Bonzo admin contracts |
| Guardian multisig | HederaGnosisSafe multisig (EVM) | Emergency pause/unpause only |
| Bonzo lending admin surfaces | Existing contracts | Risk parameter changes, reserve configuration, admin-role changes |
| Bonzo staking module | Existing contract(s) | Existing staking-reward parameter changes governed through multisig if required |

Bonzo DAO v1 does not include:

- No governor contract
- No timelock contract
- No custom smart contracts — multisigs are deployed via the existing MultisigDAOFactory
- No on-chain proposal storage
- No on-chain vote tallying
- No changes to `LendingPool` core logic
- No incentives-controller deployment in v1
- No emissions-governance surface in v1

### 1.1 Architecture diagram

```text
                        BONZO DAO v1

   +-------------------+        +-------------------------+
   | Discourse Forum   | -----> | Governance Backend      |
   | RFC / Proposal    |        | proposal index +        |
   | discussion        | <----- | execution status        |
   +-------------------+        +-----------+-------------+
                                             |
                        +--------------------+--------------------+
                        |                    |                    |
                        v                    v                    v
            +-----------+------+ +-----------+------+ +----------+--------+
            | HCS Vote Topics  | | HCS Delegation   | | Mirror-node       |
            | proposal /       | | Topic            | | balance lookups   |
            | election         | | delegate/revoke  | |                   |
            +-----------+------+ +-----------+------+ +----------+--------+
                        |                    |                    |
                        +--------------------+--------------------+
                                             |
                                             v
                                 +-----------+-------------+
                                 | Vote Validation +       |
                                 | Delegation Resolution + |
                                 | Mirror Weight Engine    |
                                 | (Delegate eligibility   |
                                 |  check for Proposals)   |
                                 +-----------+-------------+
                                             |
                               passed action bundle frozen
                                             |
                         +-------------------+-------------------+
                         |                                       |
                         v                                       v
             +-----------+-------------+             +-----------+-------------+
             | DAO Executor Multisig   |             | Guardian Multisig       |
             | PoolAdmin               |             | emergency pause only    |
             +-----------+-------------+             +-----------+-------------+
                         |                                       |
                         v                                       v
    +--------------------+-------------------+       +-----------+-------------+
    | Bonzo Admin Surfaces                    |       | Pool pause path         |
    | LendingPoolConfigurator                 |       | setPoolPause(...)       |
    | LendingPoolAddressesProvider            |       +-------------------------+
    | staking reward admin calls             |
    | reserve token upgrades if ever needed  |
    +--------------------+-------------------+
```

### 1.2 Multisig contracts

Both the DAO executor and guardian multisigs are deployed using the `MultisigDAOFactory` — no custom smart contracts are required. Under the hood, each multisig is a **HederaGnosisSafe** (Gnosis Safe adapted for Hedera) paired with a **MultisigDAO** proposal-management contract, all deployed automatically by the factory.

Key properties:

- **No contracts to write or deploy manually** — call `MultisigDAOFactory.createDAO()` to create each multisig
- **On-chain approvals** — owners approve transaction hashes directly on-chain (no off-chain ECDSA signing required; compatible with HashPack and other Hedera wallets)
- **Arbitrary EVM calls** — the base `proposeTransaction(to, data, ...)` function accepts any target address and calldata, so it can call `LendingPoolConfigurator`, `LendingPoolAddressesProvider`, or any other admin surface
- **Batch execution** — `proposeBatchTransaction()` batches multiple calls into a single execution via `HederaMultiSend`
- **HTS token support** — built-in functions for token association and fungible token transfers
- **CertiK audited** — all factory and Safe contracts are [audited by CertiK](https://skynet.certik.com/projects/swirlds-labs-dao-as-a-service)

Deployment inputs for each multisig:

```solidity
MultisigDAOFactory.createDAO({
    admin:       // admin address
    name:        // e.g. "Bonzo DAO Executor"
    logoUrl:     // Bonzo logo
    infoUrl:     // link to gov.bonzo.finance
    owners:      // array of owner addresses (5 for executor, 3 for guardian)
    threshold:   // approval threshold (3 for executor, 2 for guardian)
    isPrivate:   // false (publicly listed)
    description: // purpose description
    webLinks:    // governance forum links
})
```

Proposal → approval → execution flow:

```text
 proposer calls proposeTransaction(target, calldata, ...)
      |
      v
 MultisigDAO stores proposal + computes txHash via GnosisSafe
      |
      v
 each owner calls approveHash(txHash) on HederaGnosisSafe
      |
      v
 once threshold approvals reached → state = Approved
      |
      v
 anyone calls executeTransaction(to, value, data, operation, nonce)
      |
      v
 HederaGnosisSafe verifies approvals, executes the call
```

Contract references:

| Contract | Source | Role |
| --- | --- | --- |
| `MultisigDAOFactory` | [MultisigDAOFactory.sol](https://github.com/hashgraph/hedera-accelerator-defi-dex/blob/main/contracts/dao/MultisigDAOFactory.sol) | Factory that deploys multisig DAO instances |
| `MultisigDAO` | [MultisigDAO.sol](https://github.com/hashgraph/hedera-accelerator-defi-dex/blob/main/contracts/dao/MultisigDAO.sol) | Proposal management — create, track, and query proposals |
| `HederaGnosisSafe` | [HederaGnosisSafe.sol](https://github.com/hashgraph/hedera-accelerator-defi-dex/blob/main/contracts/gnosis/HederaGnosisSafe.sol) | Gnosis Safe adapted for Hedera — holds assets, manages owner approvals, executes transactions |
| `HederaMultiSend` | [HederaMultiSend.sol](https://github.com/hashgraph/hedera-accelerator-defi-dex/blob/main/contracts/gnosis/HederaMultiSend.sol) | Batches multiple calls into a single execution |

## 2. On-Chain Components

### 2.1 Existing protocol contracts

The DAO interacts with these existing Bonzo/Aave-compatible contracts:

| Component | Role |
| --- | --- |
| `LendingPoolAddressesProvider` | Top-level admin surface for pool admin, emergency admin, oracle, and implementation pointers |
| `LendingPoolConfigurator` | Reserve parameter updates, reserve activation/freeze, borrow settings, reserve listing, token implementation updates where supported |
| Reserve tokens (`aToken`, `stableDebtToken`, `variableDebtToken`) | Market token layer governed indirectly through configurator and provider-admin actions |
| xBONZO staking contract | Read-only source for xBONZO conversion rate when computing governance voting power |
| Bonzo staking module admin surface | Existing staking reward configuration surface controlled by multisig if Bonzo chooses to adjust staking rewards |

Lending incentives are currently stopped and not planned to restart in the near term, so no lending-incentives-controller work is part of DAO v1. Existing staking rewards may still be adjusted through the staking module if Bonzo decides to change them.

### 2.2 Multisig contracts

Bonzo DAO uses pre-deployed multisig contracts (HederaGnosisSafe + MultisigDAO). These are factory-created — no custom contract development is needed.

| Contract | Deployed by | Role |
| --- | --- | --- |
| `MultisigDAOFactory` | Already deployed on Hedera | Creates new multisig DAO instances on demand |
| `MultisigDAO` | Factory (per instance) | Manages proposals: create, approve, track status |
| `HederaGnosisSafe` | Factory (per instance) | Gnosis Safe adapted for Hedera — holds assets, manages on-chain owner approvals, executes arbitrary EVM calls |
| `HederaMultiSend` | Already deployed on Hedera | Batches multiple calls into one execution |

All contracts are [audited by CertiK](https://skynet.certik.com/projects/swirlds-labs-dao-as-a-service) and [open source under Apache 2.0](https://github.com/hashgraph/hedera-accelerator-defi-dex).

**Why multisig + off-chain voting:**

- Voting is handled off-chain via HCS + mirror-node snapshots, which supports the dual-token VP model (BONZO + xBONZO conversion rate) and VP delegation without any contract modifications.
- The multisig's `proposeTransaction()` function accepts arbitrary EVM calldata, so it can call `LendingPoolConfigurator`, `LendingPoolAddressesProvider`, and any other admin surface directly.
- Using only the multisig keeps the on-chain footprint minimal: factory-deployed Safe contracts with no custom logic.

### 2.3 Contract-level decisions

- `LendingPool` does not need modification.
- Core lending logic does not need modification.
- No new staking contracts are required for governance.
- Existing staking reward changes can be executed through multisig if the staking module already exposes the needed admin functions.
- No rewards-controller deployment is required for DAO v1.
- Lending incentives contracts are deferred until Bonzo decides to restart lending emissions.

## 3. Off-Chain Components

### 3.1 HCS topics

Bonzo DAO v1 uses dedicated Hedera Consensus Service topics:

| Topic | Purpose |
| --- | --- |
| `bonzo-gov-proposals` | Proposal-phase votes (Governance Delegates only) |
| `bonzo-gov-elections` | Election-phase votes (all token holders) |
| `bonzo-gov-delegations` | Delegation and revocation messages |

Topics are public topics with no submit key. Anyone can submit a signed message. Vote eligibility is enforced at the backend validation layer, not at the HCS topic level.

### 3.2 Vote message schema

```json
{
  "protocol": "bonzo-dao",
  "version": "1",
  "proposalId": "BIP-007",
  "phase": "PROPOSAL",
  "choice": "FOR",
  "voterAccount": "0.0.123456",
  "eligibilityBlock": "1741205823.123456789",
  "nonce": "uuid-v4",
  "signature": "0x..."
}
```

Validation rules:

- Last valid message wins per `(voterAccount, proposalId, phase)`
- Messages outside the active voting window are rejected
- `eligibilityBlock` anchors the balance snapshot used for vote-weight computation
- **Proposal phase:** Backend verifies the voter is a Governance Delegate (effective VP >= delegate threshold at snapshot). Non-delegate votes are rejected.
- **Election phase:** No eligibility restriction beyond having VP > 0

### 3.3 Delegation message schema

```json
{
  "protocol": "bonzo-dao",
  "version": "1",
  "type": "DELEGATE | REVOKE",
  "delegatorAccount": "0.0.XXXXXX",
  "delegateeAccount": "0.0.YYYYYY",
  "nonce": "uuid-v4",
  "signature": "hex(...)"
}
```

Validation rules:

- One active delegation per delegator — last valid message per `delegatorAccount` wins
- `DELEGATE` transfers the delegator's full VP to the delegatee for vote-weight computation
- `REVOKE` removes active delegation; self-delegation is equivalent to REVOKE
- Delegation state is resolved at the snapshot timestamp for each voting phase
- Delegation is **non-transitive**: if A delegates to B, and B delegates to C, A's VP stays with B
- Delegation is **non-custodial**: tokens are not locked or moved

### 3.4 Voting-power engine

The backend computes **effective voting power** from mirror-node data and delegation state:

`VP_own = BONZO_wallet + (xBONZO_wallet * conversionRate)`

`VP_effective(account) = VP_own(account) + SUM(VP_own(delegator)) for all active delegators to account`

If an account has delegated to another account, its own VP becomes 0 (full delegation).

Inputs:

- BONZO balance at snapshot timestamp
- xBONZO balance at snapshot timestamp
- xBONZO conversion rate from the staking contract
- Exclusions if governance policy removes BONZO in specific custody locations
- Active delegation state at snapshot timestamp (resolved from `bonzo-gov-delegations` HCS topic)

The effective VP is used for:
- Vote-weight tallying in both Proposal and Election phases
- Governance Delegate eligibility checks (effective VP >= delegate threshold) for Proposal phase voting

### 3.5 Proposal and execution artifacts

The governance backend should materialize two canonical objects per proposal:

| Artifact | Purpose |
| --- | --- |
| Proposal metadata | Forum post ID, phase, proposer, timing, quorum, vote result |
| Action bundle | Deterministic list of executable actions approved by the vote |

Recommended action shape:

```json
{
  "target": "0x...",
  "value": "0",
  "functionSignature": "setReserveFactor(address,uint256)",
  "args": ["0x...", "1000"],
  "expectedEvents": ["ReserveFactorChanged"]
}
```

### 3.6 Execution reporting

The backend records:

- proposal status
- frozen approved action bundle
- multisig execution status
- Hedera transaction IDs
- verification output from post-execution reads

## 4. Authority Model

### 4.1 DAO executor multisig

The DAO executor is a **3-of-5 multisig** (HederaGnosisSafe) and is the primary privileged actor. Created via `MultisigDAOFactory.createDAO()` with 5 owner addresses and threshold 3.

Responsibilities:

- act as `PoolAdmin`
- execute `LendingPoolConfigurator` actions via `proposeTransaction()` with encoded calldata
- execute provider-level admin changes approved by governance
- execute approved staking-module admin actions
- batch multiple actions per proposal using `proposeBatchTransaction()` via `HederaMultiSend`

Execution flow:

1. Governance backend freezes the approved action bundle after vote passes
2. An executor owner encodes the action bundle as calldata and calls `proposeTransaction()` (or `proposeBatchTransaction()` for multi-action bundles) on the `MultisigDAO` contract
3. Each owner reviews the proposal and calls `approveHash(txHash)` on the `HederaGnosisSafe`
4. Once 3-of-5 approvals are reached, any address calls `executeTransaction()` to execute the call against the target admin contract
5. Execution results are verified and posted back to the forum

### 4.2 Guardian multisig

The guardian is a separate **2-of-3 multisig** (HederaGnosisSafe). Created via `MultisigDAOFactory.createDAO()` with 3 owner addresses and threshold 2.

Responsibilities:

- call emergency pause/unpause only via `proposeTransaction()` targeting the emergency admin path

Restrictions:

- no proposal execution authority
- no treasury authority
- proposals should only target `setPoolPause(...)` — guardian owners should reject any other proposal type

### 4.3 Governance Delegates

A Governance Delegate is any account whose **effective VP** (own + delegated) meets or exceeds the **delegate threshold** (recommended: 500,000 VP) at the phase snapshot timestamp. This is not a static whitelist — eligibility is computed dynamically by the backend at vote validation time.

Governance Delegates can:

- vote in the **Proposal phase** (restricted to delegates only)
- vote in the **Election phase** (open to all, but delegates carry higher weight)

Governance Delegates cannot:

- execute passed proposals (that is the executor multisig's role)
- bypass the Election phase — a passed Proposal still requires a separate Election

Delegate status is earned through:

- Holding sufficient BONZO/xBONZO tokens directly
- Receiving delegated VP from other token holders
- Any combination of own + delegated VP meeting the threshold

### 4.4 Delegators

A delegator is any token holder who delegates their VP to a delegatee.

Properties:

- Delegation is **full** — the delegator's entire VP transfers to the delegatee for vote-weight purposes
- Delegation is **non-custodial** — tokens remain in the delegator's wallet; only VP accounting changes
- Delegation is **non-transitive** — if A delegates to B, and B delegates to C, A's VP stays with B
- A delegator **cannot vote** while delegation is active (their vote would carry 0 weight)
- A delegator can **revoke** at any time by submitting a REVOKE message to the `bonzo-gov-delegations` HCS topic

### 4.5 Proposal creators

Proposal creators can:

- create RFCs (no VP requirement)
- author proposal text
- assemble proposed action bundles
- advance a proposal through forum and voting stages

Proposal creators must:

- hold at least **100,000 effective VP** to create a formal Proposal (creation threshold)
- Note: creating a Proposal requires 100,000 VP; **voting** in the Proposal phase requires Governance Delegate status (500,000 VP)

Proposal creators cannot:

- execute passed proposals
- bypass multisig review
- perform privileged on-chain actions directly

### 4.6 Governance backend

The backend is non-custodial and non-privileged.

Responsibilities:

- index forum proposals
- accept and validate vote messages (including Governance Delegate eligibility checks for Proposal phase)
- resolve delegation state from the `bonzo-gov-delegations` HCS topic
- compute effective VP (own + delegated) for vote-weight tallying
- compute results (quorum + majority)
- freeze the approved action bundle
- publish execution and verification status

The backend does not mutate protocol state directly.

## 5. Deferred Lending Incentives Module

Lending incentives are out of scope for DAO v1.

Current assumptions:

- Bonzo incentive rewards are stopped.
- DAO v1 does not need to configure lending emissions, fund lending rewards, or manage lending reward claims.
- The existing rewards-controller wiring can remain dormant.
- This does not exclude governance over the separate staking module if Bonzo wants to adjust staking rewards.

Future extension boundary:

- If Bonzo restarts lending incentives, the integration point is the reserve-token controller hook, not `LendingPool`.
- A future lending-incentives module may reuse an existing controller stack or deploy a new one.
- Lending-incentives governance should be added as a separate scope decision, not implied by DAO v1.

### 5.1 Deferred lending incentives diagram

```text
 DAO v1
    |
    +--> governance over risk params / admin changes / pause / staking rewards
    |
    +--> no lending incentives actions
          no lending emissions config
          no lending reward funding
          no controller deployment

 Future module if lending emissions restart
    |
    +--> reserve tokens -> rewards controller -> reward claims
```

## 6. Governance Action Types

Bonzo DAO v1 action bundles may include:

| Action type | Target surface |
| --- | --- |
| Risk parameter update | `LendingPoolConfigurator` |
| Pause/unpause | Guardian via emergency admin path |
| Reserve activation/freeze | `LendingPoolConfigurator` |
| Reserve listing / reserve init | `LendingPoolConfigurator` |
| Interest-rate strategy change | `LendingPoolConfigurator` |
| Provider admin change | `LendingPoolAddressesProvider` |
| Staking reward parameter change | Existing staking module admin surface |
| Proxy / implementation update where supported | provider/configurator/token admin surfaces |

### 6.1 Multisig proposal types

The `MultisigDAO` contract supports several proposal types. Bonzo DAO uses these as follows:

| MultisigDAO function | Bonzo use case |
| --- | --- |
| `proposeTransaction(to, data, ...)` | **Primary** — arbitrary EVM calls to `LendingPoolConfigurator`, `LendingPoolAddressesProvider`, staking admin, or any other admin surface. Accepts any target address and calldata. |
| `proposeBatchTransaction(targets[], values[], calldatas[])` | Multi-action proposals — e.g. updating multiple reserve parameters in a single execution via `HederaMultiSend` |
| `proposeTransferTransaction(token, receiver, amount)` | Treasury operations — transfer HBAR or HTS tokens from the multisig |
| `proposeTokenAssociateTransaction(token)` | Associate new HTS tokens with the multisig before receiving them |
| `setText(text)` | Text-only governance proposals (no on-chain execution) |

All Bonzo-specific governance actions (risk parameters, reserve config, interest-rate strategy, admin changes) use the generic `proposeTransaction()` function with manually encoded calldata targeting the appropriate admin contract. No custom contract integration is needed.

## 7. User Journeys

### 7.1 Proposal Creator Journey

```text
 Proposal Creator
      |
      v
 +----+------------------+
 | create RFC in forum   |
 +----+------------------+
      |
      v
 +----+------------------+
 | refine action bundle  |
 | with community input  |
 +----+------------------+
      |
      v
 +----+------------------+
 | publish final         |
 | Proposal / Election   |
 +----+------------------+
      |
      v
 +----+------------------+        +----------------------+
 | governance backend    | -----> | HCS voting window    |
 | indexes proposal      |        | voters submit votes  |
 +----+------------------+        +----------+-----------+
      |                                        |
      |                                        v
      |                            +-----------+-----------+
      |                            | mirror-weight engine  |
      |                            | validates + tallies   |
      |                            +-----------+-----------+
      |                                        |
      +----------------------------------------+
                                               |
                                               v
                                   +-----------+-----------+
                                   | proposal result       |
                                   | executable or failed  |
                                   +-----------+-----------+
                                               |
                                               v
                                   +-----------+-----------+
                                   | if passed: frozen     |
                                   | approved action bundle|
                                   +-----------+-----------+
                                               |
                                               v
                                   +-----------+-----------+
                                   | executor multisig     |
                                   | receives payload      |
                                   +-----------+-----------+
                                               |
                                               v
                                   +-----------+-----------+
                                   | tx ids + verification |
                                   | posted back to forum  |
                                   +-----------------------+
```

1. Author creates an RFC thread in the forum (no VP requirement).
2. Community discussion refines the intended contract calls, parameters, and expected effects (minimum 3 days).
3. Author prepares a deterministic action bundle for the proposed on-chain changes.
4. Author publishes the Proposal thread (requires 100,000 effective VP to create).
5. Governance backend indexes the proposal metadata and opens the **Proposal phase** voting window (2 days).
6. **Governance Delegates only** (effective VP >= 500,000) submit signed HCS messages to `bonzo-gov-proposals`.
7. Backend validates signatures, checks Governance Delegate eligibility, resolves delegation state, de-duplicates votes, and computes effective voting power.
8. Backend finalizes Proposal phase: quorum (2,500,000 VP) + simple majority.
9. If the Proposal passes, the same author declares the **Election phase** (2 days, open to all token holders with VP > 0).
10. All token holders vote on `bonzo-gov-elections`. Backend validates and tallies with Election quorum (5,000,000 VP) + simple majority.
11. If the Election passes, backend marks it executable and freezes the approved action bundle.
12. Executor multisig receives the frozen action bundle and associated verification instructions.
13. After execution, transaction IDs and verification results are posted back to the forum thread.

### 7.2 Bonzo Admin / Executor Journey

```text
 passed proposal
      |
      v
 +----+----------------------+
 | executor monitors backend |
 | for executable proposals  |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | retrieve frozen bundle    |
 | compare to forum spec     |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | simulate / sanity check   |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | encode calldata + call    |
 | proposeTransaction() on   |
 | MultisigDAO contract      |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | owners call approveHash() |
 | on HederaGnosisSafe       |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | threshold reached →       |
 | call executeTransaction() |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | verify resulting          |
 | on-chain state            |
 +----+----------------------+
      |
      v
 +----+----------------------+
 | post execution report     |
 | or failure state          |
 +---------------------------+
```

1. Admins monitor governance backend output for proposals marked executable.
2. Admins retrieve the frozen action bundle and compare it against the approved forum specification.
3. Admins perform off-chain sanity checks or simulation before signing.
4. An executor owner encodes the action bundle as calldata and calls `proposeTransaction()` (or `proposeBatchTransaction()`) on the `MultisigDAO` contract.
5. Each multisig owner reviews the proposal details and calls `approveHash(txHash)` on the `HederaGnosisSafe` contract.
6. Once 3-of-5 approvals are reached, any address calls `executeTransaction()` to execute the call on-chain.
7. Admins verify resulting state using read-only contract queries and protocol data provider outputs.
8. Admins publish an execution report with transaction IDs, decoded actions, and verification results.
9. If execution fails, admins publish the failure state, identify the blocking action, and define the remediation path.
10. Guardian operations remain separate and are used only for emergency pause handling, not standard proposal execution.

### 7.3 Delegation Journey

```text
 Token Holder
      |
      v
 +----+---------------------------+
 | connect wallet at              |
 | app.bonzo.finance/governance   |
 +----+---------------------------+
      |
      v
 +----+---------------------------+
 | view delegation panel:         |
 | own VP, current delegation,    |
 | potential delegatees           |
 +----+---------------------------+
      |
      +------------------+------------------+
      |                  |                  |
      v                  v                  v
 +----+------+    +------+------+    +------+------+
 | DELEGATE  |    | REVOKE      |    | VIEW STATUS |
 | select    |    | remove      |    | who has     |
 | delegatee |    | delegation  |    | delegated   |
 +----+------+    +------+------+    | to me       |
      |                  |           +------+------+
      v                  v
 +----+---------------------------+
 | sign + submit message to       |
 | bonzo-gov-delegations HCS topic|
 +----+---------------------------+
      |
      v
 +----+---------------------------+
 | backend indexes delegation     |
 | delegatee's effective VP       |
 | updates accordingly            |
 +--------------------------------+
```

1. Token holder connects wallet and navigates to the delegation panel.
2. Token holder views their own VP, current delegation status, and a list of potential delegatees.
3. To delegate: select a delegatee and submit a signed DELEGATE message to the `bonzo-gov-delegations` HCS topic.
4. To revoke: submit a signed REVOKE message (or self-delegation) to remove active delegation.
5. Backend indexes the delegation message and updates effective VP for the delegatee.
6. The delegator's effective VP becomes 0 while delegation is active. Their VP is counted under the delegatee.
7. Delegation does not lock tokens — the delegator retains full custody of their BONZO/xBONZO.
