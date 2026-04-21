# Repository Guidelines — Bonzo Finance Contracts

## Project overview

This repository holds **Bonzo Finance** smart contracts, markets configuration, and Hardhat tooling. Bonzo is a **non-custodial liquidity markets protocol**—a fork of **Aave Protocol V2**—adapted for **Hedera** (mainnet chain ID **295**, testnet **296**).

- **Framework**: Hardhat + TypeScript  
- **Solidity**: 0.6.12 and 0.8.19  
- **License**: AGPL v3  

## Critical security — secret files (read this first)

**Agents must never read or write `.env`, `.env.*`, or any secret or credential file** (private keys, mnemonics, API keys, production tokens, keystores, or paths named like `*secret*` / `*private*` when used for sensitive data).

- **Do not** open, grep, or load these files in tools—even to “fix” or “verify” configuration.  
- **Do not** tell users to paste secrets into chat or commit them.  
- **Do** use **`.env.example`** for documenting variable *names* and placeholder shapes.  
- **Do** use placeholders in code (`process.env.SOME_VAR`) and ask humans for **non-sensitive** values when something must be confirmed.

If you need to know what variables exist, read **`.env.example`** only (never real env files).

## Repository layout

- **`contracts/`** — Protocol (`protocol/`), `interfaces/`, `mocks/`, `misc/`, adapters, dependencies  
- **`scripts/`**, **`helpers/`**, **`tasks/`** — Deployments and automation  
- **`markets/`**, **`modules/`** — Market and module configuration  
- **`test/`** — Unit specs (`*.spec.ts`)  
- **`test-suites/`** — Heavier integration flows  
- **`deployments/`** — Deployment artifacts  
- **`artifacts/`**, **`types/`** — Generated; do not edit by hand  

## Build, test, and quality

```bash
npm install
npm run compile
npm test
```

Other useful commands (see `package.json` for the full set):

- **Integration / AMM**: `npm run test-scenarios`, `npm run test-amm`  
- **Coverage**: `npm run dev:coverage`  
- **Formatting**: `npm run prettier:check`, `npm run prettier:write`  

Prefer deterministic tests; use mocks and local fixtures rather than relying on mainnet forks unless the suite is designed for it.

## Hedera networks

- **Testnet (296)** — Development and staging  
- **Mainnet (295)** — Production; double-check `hardhat.config.ts` and network flags before any mainnet task  

Typical patterns:

```bash
npm run hardhat:hedera_testnet -- <task>
npm run hardhat:hedera_mainnet -- <task>
```

Use environment variables for RPC URLs and accounts; never hardcode private keys or production endpoints with embedded secrets.

## Solidity and protocol notes

- Follow checks-effects-interactions, clear access control, and NatSpec where it helps reviewers.  
- This codebase uses proxies and patterns familiar from Aave V2; treat lending, liquidations, and oracle integrations as high-risk when changing behavior.  
- Match existing naming and import style in each area you touch.

## Commits and PRs

- Use **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.).  
- PRs should summarize scope, list test commands run, and call out **affected networks** (testnet vs mainnet) and any deployment or migration steps.  

## Where to look next

- **`CLAUDE.md`** — Short project context and the same non-negotiable rules about secret files.  
- **`docs/`** — Additional product and technical specs when present.  
- **`.env.example`** — Safe template for required environment variables (no real secrets).
