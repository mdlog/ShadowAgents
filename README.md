# ShadowAgents

**Private autonomous agents for Starknet DeFi — built on [STRK20](https://strk20-by-example.org/what-is-strk20).**

ShadowAgents lets a user delegate DeFi actions to an agent that executes them
*privately*: the agent acts **through the user's own wallet** (`WalletAccountV6`,
starknet.js v10) over STRK20's shielded pool, so strategy, size, and positions stay
confidential while settlement lands on Starknet **mainnet** (`CHAIN_ID = SN_MAIN`).
No viewing key ever leaves the wallet.

Direction: a private intent / execution layer (see IDEAS `IDEA-06`, `IDEA-01`,
`IDEA-15`) where an agent shields funds, performs a protocol action via the STRK20
`privacy_invoke` anonymizer flow, and unshields — with the on-chain trail revealing
neither who acted nor what they did.

> **Status:** early. Scaffolded from the STRK20 starter kit and wired to the mainnet
> STRK20 privacy pool. Shield / unshield / private-transfer / echo actions run through
> the user's wallet today; the agent orchestration layer is what's being built for the
> sprint.

STRK20 privacy pool (mainnet): `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`

## Quick start

```bash
npm install
cp .env.example .env.local     # then paste your Alchemy Starknet key into it
npm run dev                    # http://localhost:3000
```

Needs a free [Alchemy](https://alchemy.com) Starknet RPC key and a privacy-enabled
wallet (Ready) on Mainnet or Sepolia. `.env.local` is gitignored — the RPC key is
**never** committed.

### Environment

| Var | Meaning |
|-----|---------|
| `NEXT_PUBLIC_PROVIDER_URL` | Alchemy Starknet key **only** (the mainnet URL prefix `…/rpc/v0_10/` is built in `src/utils/constants.ts`). |
| `NEXT_PUBLIC_STRK20_ECHO_HELPER_SEPOLIA` | Optional Sepolia anonymizer helper address; `0x0` = not deployed. |

## What's inside

- **Connect** — `get-starknet` v6 wallet discovery + picker → `src/app/components/`
- **Actions** — shield / unshield / private transfer / echo / shielded balance via
  `strk20InvokeTransaction` through the user's wallet
- **Anonymizer** — `cairo/` holds the `privacy_invoke` helper (Cairo) the private
  actions route through
- **`strk20.json`** — sprint manifest (mainnet txns, deployed contracts, demo video/url),
  read by the hub every 30 min

## STRK20 skills & docs

- Docs mirror: [`../docs/strk20-llms-full.md`](../docs/strk20-llms-full.md) (from
  `https://strk20-by-example.org/llms-full.txt`) · in-scope ideas:
  [`../docs/strk20-IDEAS.md`](../docs/strk20-IDEAS.md)
- Reference repos cloned under `../_reference/` (starter kit, awesome-strk20)
- Four `welttowelt/strk20-skills` installed: `strk20-privacy`, `strk20-wallet-api`,
  `strk20-anonymizer-contracts`, `strk20-privacy-sdk`

## Credits & license

Seeded from the MIT-licensed
[Starknet Privacy Starter Kit](https://github.com/Akashneelesh/strk20-starter-kit)
by Philippe ROSTAN — original `LICENSE` retained. STRK20 by
[strk20-by-example.org](https://strk20-by-example.org).

— Built by **MDLog** ([@mdlog](https://github.com/mdlog), Telegram `@mdlog`) · Veiled Markets.
