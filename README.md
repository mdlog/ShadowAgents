# ShadowAgents

**Private payroll on Starknet.** Pay a whole team in one transaction without
publishing the org chart — who is on it, what each person earns, or when they got
paid.

Built on [STRK20](https://strk20-by-example.org/what-is-strk20), the Starknet
privacy pool. Mainnet, `CHAIN_ID = SN_MAIN`.

## The problem

STRK20 hides transfers *inside* the pool, but the edges are public by design:
deposits name the depositor, token and amount; withdrawals name the recipient and
amount. So a naive "private payroll" still leaks. The employer deposits exactly
30 STRK, three withdrawals of 10 / 10 / 10 follow shortly after, and the amounts
and timing line up.

There is a second problem the pool cannot solve on its own: **you cannot privately
transfer to someone who has not registered a viewing key yet.** New hires have not.

## What ShadowAgents does

An agent turns one payroll intent into a privacy-shaped plan, and a Cairo
anonymizer (`PayrollEscrow`) holds the funds against Poseidon commitments.

The agent plans; **your wallet signs.** No key, and no viewing key, ever leaves it.

```
Intent:  "pay Alice, Bob and Carol 30 STRK, claimable over 2 hours"

     │  split into uneven, non-round amounts       ← round figures fingerprint a payout
     │  stagger suggested claim times              ← a tight burst of claims correlates
     │  commit = poseidon(TAG, secret, amount)     ← the amount lives in the preimage
     ▼
1. SHIELD   deposit into the pool, ahead of time and on its own
2. FUND     withdraw total → escrow, one invoke registering N commitments
3. CLAIM    each recipient, in their own transaction, into their own private note
```

Because only the **hashes** reach the funding calldata, no per-recipient amount is
published when payroll is funded. And because each recipient is the *sender* of
their own claim, their wallet registers them on first use — which is what makes
paying a not-yet-registered person work at all.

### What is public, and what is not

Stated plainly, because a privacy claim is worthless if the person relying on it
cannot check it. The app shows this same table before you sign.

| Public | Hidden |
| --- | --- |
| The pool → escrow transfer and the escrow's funded total | Which recipient holds which commitment |
| Each claim's amount, once that recipient claims | Every per-recipient amount, until that recipient claims |
| That a set of claims belongs to one payroll batch | The mapping from the employer to any recipient |
| The timing of every transaction | Which notes were spent |

Known limits, from the protocol's own documentation: the edges are public;
distinctive amounts and rapid in-and-out patterns shrink the anonymity set; opening
a channel and moving funds in tight succession can link a recipient to public
activity.

## Repo layout

```
cairo-payroll/        PayrollEscrow — the anonymizer, plus AUDIT.md      (Cairo, 20 tests)
src/lib/planner/      intent → plan: amount splitting, claim scheduling  (pure TS)
src/lib/escrow/       commitments, STRK20 action batches, dry-run        (TS)
src/app/              the dapp: wallet, shield/unshield/transfer, Payroll tab
docs/superpowers/     the design spec and the implementation plan
```

## Quick start

```bash
npm install
cp .env.example .env.local     # paste your Alchemy Starknet key
npm run dev
```

Needs a free [Alchemy](https://alchemy.com) Starknet RPC key and a privacy-enabled
wallet (Ready) on Mainnet. `.env.local` is gitignored; the key is never committed.

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_PROVIDER_URL` | Alchemy Starknet key **only** — the mainnet URL prefix is built in `src/utils/constants.ts` |
| `NEXT_PUBLIC_PAYROLL_ESCROW` | Deployed `PayrollEscrow` address; `0x0` disables funding |

Deploy the escrow from the Payroll tab with your own wallet — no keystore, no
private key handling. See [`RUNBOOK.md`](./RUNBOOK.md) for the full walkthrough and
what each step costs.

## Testing

```bash
npm test                        # 22 TypeScript tests
cd cairo-payroll && snforge test # 20 Cairo tests
```

Two of those matter more than the rest:

- **Hash parity.** The TypeScript commitment hash is pinned to a vector printed by
  the Cairo test. If the two implementations ever diverge, the suite fails instead
  of every claim silently breaking at runtime.
- **Calldata round-trip.** The pool deserialises raw calldata straight into
  `privacy_invoke`, positionally. A Cairo test dispatches the exact felt layout the
  TypeScript builders emit and asserts the returned span is what the pool applies.

Every batch is also dry-run through `strk20PrepareInvoke(actions, true)` before the
wallet prompt, so a calldata mistake never reaches a signature or costs a pool fee.

## The contract

`PayrollEscrow` is a stateful `privacy_invoke` helper. It pins the pool address at
deploy time and rejects every other caller. Commitments are bound to a `batch_id`
with its own remaining balance, so an employer who over-registers can only strand
their own batch — never reach another employer's funds.

> **This contract is a draft and has had no external audit.** An internal
> state-inconsistency pass is in [`cairo-payroll/AUDIT.md`](./cairo-payroll/AUDIT.md),
> with every finding backed by a test rather than an assertion. Two accepted
> findings are documented there. Get an external audit before putting meaningful
> value in it.

## Sprint

STRK20 Private Sprint · registered as `mdlog/ShadowAgents`.
`strk20.json` carries the mainnet transactions, deployed contracts and demo as they
come to exist. Pool fee is 6 STRK per private operation, read live from
`get_fee_amount` rather than hardcoded.

## Credits

Seeded from the MIT-licensed
[Starknet Privacy Starter Kit](https://github.com/Akashneelesh/strk20-starter-kit)
by Philippe ROSTAN; the original `LICENSE` is retained. STRK20 by
[strk20-by-example.org](https://strk20-by-example.org).

Built by **MDLog** — [@mdlog](https://github.com/mdlog), Telegram `@mdlog`.
