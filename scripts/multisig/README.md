# Bonzo Multisig Smoke Test

End-to-end proof that the Palmera-deployed Gnosis Safes work in both threshold configurations by sending a real HBAR transfer from each Safe to a signer EOA.

> ⚠️ **Execution policy.** The AI assistant writes these scripts. The human operator runs them. Never autonomous.

## Flow

1. **Deploy** the two Safes via `multisig.hedera.foundation` (Palmera UI). Record addresses.
2. **Fill** `scripts/multisig/config.ts`:
   - `SAFE_ADDRESSES.hedera_testnet.{executor,guardian}` and `.hedera_mainnet.*`
   - `OWNERS.hedera_*.{executor[5], guardian[3]}`
   - `SMOKE_TRANSFER.hedera_*.{receiver, amountTinybar}` — note tinybar (1 HBAR = 1e8), not wei
3. **Fund** each Safe with enough HBAR to cover `amountTinybar` plus gas. Prefer funding via a plain EVM transaction (Hardhat `signer.sendTransaction`, MetaMask) so the balance lands in the EVM-spendable bucket. Hedera-native `CryptoTransfer` deposits (HashPack's default) can leave the Safe's balance inaccessible to the EVM `CALL` op.
4. **Set owner private keys in your `.env`** — never in code. Per network + per Safe:
   ```
   # testnet
   EXECUTOR_OWNER_KEY_1=0x…
   EXECUTOR_OWNER_KEY_2=0x…
   EXECUTOR_OWNER_KEY_3=0x…        # 3-of-5 needs 3 keys; EXECUTOR_OWNER_KEY_4/5 optional
   GUARDIAN_OWNER_KEY_1=0x…
   GUARDIAN_OWNER_KEY_2=0x…        # 2-of-3 needs 2 keys; GUARDIAN_OWNER_KEY_3 optional

   # mainnet (same pattern, _MAINNET_ suffix)
   EXECUTOR_OWNER_KEY_MAINNET_1=0x…
   …
   ```
   Only the first `threshold` keys per list need to be set. The script filters empty/missing env vars and preflight asserts every resolved key belongs to an on-chain owner. The gas-paying wallet is the existing `PRIVATE_KEY` / `PRIVATE_KEY_MAINNET` — it does **not** need to be a Safe owner.
5. **Dry-run** each target:
   ```bash
   DRY_RUN=true CHAIN_TYPE=hedera_testnet TARGET_SAFE=guardian \
     npm run multisig:smoke-transfer -- --network hedera_testnet
   ```
6. **Live-run** guardian (2-of-3):
   ```bash
   CHAIN_TYPE=hedera_testnet TARGET_SAFE=guardian \
     npm run multisig:smoke-transfer -- --network hedera_testnet
   ```
7. **Live-run** executor (3-of-5):
   ```bash
   CHAIN_TYPE=hedera_testnet TARGET_SAFE=executor \
     npm run multisig:smoke-transfer -- --network hedera_testnet
   ```
8. Repeat 5–7 with `CHAIN_TYPE=hedera_mainnet` once testnet is green and two owners have signed off.

Every successful run writes `output/transfer-hbar.<chain_type>.<target>.json` with the Safe txHash, approval tx hashes, execution tx hash, and before/after balances.

## How the multisig is signed

- The script uses **pre-approved signatures**: each owner calls `approveHash(safeTxHash)` on-chain, then the script assembles a v=1 signature blob and calls `execTransaction(...)` with it.
- No EIP-712 off-chain signing. HashPack-compatible. Works on Hedera Safes without any Safe Tx Service dependency.
- `execTransaction` is called by a gas-paying wallet (`PRIVATE_KEY` / `PRIVATE_KEY_MAINNET`) that does **not** need to be a Safe owner — it just pays gas.

## Network convention

- `CHAIN_TYPE` env is authoritative — selects RPC + wallets. Same pattern as `scripts/supra-deploy.ts`.
- `--network` must match `CHAIN_TYPE`. Scripts assert this at startup.
- Only Hedera testnet / mainnet RPCs are permitted. Forks are explicitly refused.

## Config layout

```
scripts/multisig/
├── config.ts               # Safe addresses, owners, smoke target — all in-file consts
├── lib/
│   ├── preflight.ts        # chainId, owner-set, threshold, key-matches-owner checks
│   └── safe.ts             # Safe v1.4.1 ABI + helpers (getTransactionHash, exec, sig blob)
├── smoke/
│   └── transferHbar.ts     # 2-of-3 + 3-of-5 end-to-end smoke test
├── output/                 # per-run artifacts (safeTxHash, tx hashes, before/after)
└── README.md
```

## Troubleshooting

- **"SMOKE_TRANSFER.*.receiver is empty"** — fill `receiver` in `config.ts`.
- **"at least threshold owner keys supplied"** fails preflight — fewer than `threshold` of the `EXECUTOR_OWNER_KEY_*` / `GUARDIAN_OWNER_KEY_*` env vars resolved. Check your `.env` for the expected names (mainnet uses `_MAINNET_` infix).
- **"every supplied owner key resolves to an on-chain owner" fails** — the private keys don't match owners that Palmera actually deployed with. Recheck `getOwners()` vs `OWNERS`.
- **`execTransaction` reverts with "GS025"** — signatures are not sorted. The script sorts ascending by address; double-check nothing upstream reordered them.
- **`execTransaction` reverts with "GS026"** — an owner's `approveHash` isn't in place. The script re-reads `approvedHashes` before executing; if your approver wallet disagrees with the on-chain owner set, that check will catch it first.
- **`execTransaction` reverts with "GS013"** — Safe's outer call ran but the *inner* `to.call{value}("")` returned false. On Hedera the usual culprit is a **unit mismatch**: the EVM `CALL` opcode interprets `value` in **tinybar (1e8)**, not 18-dec wei. If `SMOKE_TRANSFER.amountTinybar` was built with `parseEther(x)` instead of `parseUnits(x, 8)`, the Safe is asked to forward ~1e10× more HBAR than intended and the call fails. Other causes: receiver has `receiver_sig_required=true`, the Safe's HBAR was deposited via a Hedera-native `CryptoTransfer` (not spendable by the EVM `CALL` op), or the receiver is a contract whose `receive()`/`fallback()` reverts. The script's error output points you at the mirror node entry for the receiver.
- **Hashio rate limits** on mainnet — set `PROVIDER_URL_MAINNET` to a paid RPC.
