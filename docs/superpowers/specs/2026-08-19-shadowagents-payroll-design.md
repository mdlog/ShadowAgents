# ShadowAgents — Private Payout Agent (MVP design)

Date: 2026-08-19
Status: approved for implementation
Sprint: STRK20 Private Sprint (`starkience/strk20-hackathon`, registered as `mdlog/ShadowAgents`)

## Problem

Paying a team on a public chain leaks the whole org chart: who is paid, how much, and how
often. STRK20 hides transfers *inside* the pool, but two things remain public by design —
deposits (depositor, token, amount) and withdrawals (recipient, amount) — and you cannot
privately transfer to someone who has not registered a viewing key yet.

So a naive "private payroll" still leaks: employer deposits exactly 30 STRK, and shortly
after three withdrawals of 10/10/10 appear. The amounts and the timing correlate.

## What we build

A **co-pilot agent** that turns one payroll intent into a privacy-shaped plan, and a
**PayrollEscrow anonymizer** that lets an employer fund N recipients in a single
transaction while keeping each recipient's amount off-chain until they claim it.

Explicitly *not* built: unattended execution, agent-held keys, vesting schedules.

## Route and trust boundary

Route: **Starknet Wallet API** (`WalletAccountV6`, starknet.js 10.4.0) plus an
app-specific anonymizer contract. Chosen because the app acts on the user's behalf and
must never hold keys.

| Concern | Holder |
| --- | --- |
| Signing key | User's wallet. Never leaves it. |
| Viewing key | User's wallet. The app never asks for it. |
| Note discovery, proving, submission | Wallet |
| Action construction | This app (client-side) |
| Claim secrets | Generated client-side, shared off-chain by the employer |

The app has no backend and no database. Every secret is generated in the browser and
handed to the employer as a claim link; we never transmit or store it.

### Hidden vs visible (state this in-product)

Visible: the employer's deposit (address, token, amount); the pool→escrow withdrawal
(total); the escrow's on-chain balance; each claim's *amount* (open notes carry a public
amount); timing of every transaction; registration events.

Hidden: which recipient claims which commitment, the mapping from employer to recipient,
per-recipient amounts *until that recipient claims*, and which notes were spent.

Known limitations we repeat in the UI: the edges are public; distinctive amounts and
rapid in-and-out patterns shrink the anonymity set; opening a channel and moving funds in
tight succession can link a recipient to public activity.

## Architecture

Four units with separate responsibilities, each testable on its own.

```
lib/planner/        pure TS, no chain     intent -> plan (split, jitter, guidance)
lib/escrow-client/  TS + starknet.js      plan  -> STRK20_ACTION[]; commitment hashing
cairo/payroll_escrow/  Cairo (DRAFT)      stateful privacy_invoke helper
src/app/            Next.js UI            intent form -> plan preview -> sign -> receipts
```

`lib/planner` depends on nothing. `lib/escrow-client` depends on the planner's types and
starknet.js. The UI depends on both. Nothing depends on the UI.

## Flow

Three transactions, each a separate private operation (6 STRK pool fee each, verified
live against the mainnet pool's `get_fee_amount` on 2026-08-19).

**1. Shield** — a plain `deposit`, run ahead of time and on its own. Keeping it separate
from the funding transaction is what breaks the public link between the employer's
deposit and the payroll movement. Note: a shield is two wallet prompts (ERC-20 `approve`
must land before the deposit); the UI labels both.

**2. Fund** — one transaction:
```
withdraw(token, total, recipient = escrow)
invoke(escrow, [Fund, batch_id, token, 0, 0, 0, [h_1..h_N]])
```
The client generates one random `secret_i` per recipient and computes
`h_i = poseidon(TAG, secret_i, amount_i)`. Only the hashes go into calldata, so
**per-recipient amounts never appear on-chain at funding time**. Output: N claim links,
each carrying `(secret_i, amount_i)`, shared off-chain by the employer.

**3. Claim** — one transaction per recipient, submitted by that recipient:
```
transfer(token, "OPEN", recipient = claimer)
invoke(escrow, [Claim, 0, 0, secret, amount, ${openNoteIds[0]}, []])
```
The escrow recomputes the hash from `(secret, amount)`, marks the commitment claimed,
approves the pool, and returns an `OpenNoteDeposit` crediting the claimer's open note.

Because the recipient is the *sender* of their own claim transaction, the wallet
registers them automatically on first use. That is what makes paying a not-yet-registered
person work.

## Cairo contract

`PayrollEscrow` — a **draft**. The anonymizer is app-team code: it must pass review and an
audit pass before any mainnet deploy, and it is not derived from an audited package. The
escrow pattern it adapts is an unofficial illustration, not a shipped StarkWare package.

```cairo
enum PayrollOperation { Fund, Claim }

fn privacy_invoke(
    ref self: T,
    operation: PayrollOperation, // Fund | Claim
    batch_id: felt252,           // Fund: fresh id;   Claim: ignored
    token: ContractAddress,      // Fund: token;      Claim: ignored
    secret: felt252,             // Fund: ignored;    Claim: preimage
    amount: u128,                // Fund: ignored;    Claim: revealed amount
    note_id: felt252,            // Fund: ignored;    Claim: open note id
    commitments: Span<felt252>,  // Fund: N hashes;   Claim: empty
) -> Span<OpenNoteDeposit>
```

Calldata order must match this signature exactly — the pool deserializes straight into
these parameters. The variable-length `Span` sits last to keep calldata construction
simple.

Storage:
```cairo
privacy_contract: ContractAddress                  // pinned at deploy
batches:     Map<felt252, Batch>                   // batch_id -> { token, remaining: u128 }
commitments: Map<felt252, Commit>                  // hash -> { batch_id, claimed }
accounted:   Map<ContractAddress, u128>            // tokens already spoken for
```

**Fund** asserts caller is the pool, asserts `batch_id` is unused, measures the incoming
amount as `balance_of(self) - accounted[token]`, writes the batch with that `remaining`,
records each commitment against `batch_id`, increments `accounted[token]`, and returns an
empty span (funds stay parked).

**Claim** recomputes `poseidon(TAG, secret, amount)`, requires the commitment to exist and
be unclaimed, requires `batch.remaining >= amount`, flips `claimed`, decrements both
`batch.remaining` and `accounted[token]`, approves the pool for `amount`, and returns one
`OpenNoteDeposit`.

### Two deliberate departures from the reference escrow

1. **Per-batch isolation.** The reference tracks funds globally. Copied as-is into a
   multi-employer contract, an employer could register commitments exceeding their own
   deposit and drain another employer's escrowed funds. Binding every commitment to a
   `batch_id` with its own `remaining` contains over-registration to the batch that
   caused it.
2. **Balance delta for a stateful helper.** The standard idiom snapshots the balance
   before an external call. This helper holds funds across transactions and the pool has
   already transferred in before `privacy_invoke` runs, so there is no "before" to read.
   `accounted[token]` is that baseline.

### Security rules applied

Caller pinned to the pool; commitment hash domain-separated by a version tag; `claimed`
flag prevents double claims; `u256 -> u128` conversion is explicit and reverts on
overflow; zero token / zero amount / zero commitment rejected; external reverts propagate
so the whole pool transaction aborts; the contract holds no approval outside the
transaction that grants it.

Known accepted risk: an employer who registers commitments summing above their funded
total leaves some of their own recipients unable to claim. Contained to that batch, and
surfaced in the UI before signing.

## Planner

Pure functions, no chain access, fully unit-testable.

- `splitAmounts(total, n)` — n non-round amounts that sum exactly to `total`. Avoids
  round figures because they are the strongest amount fingerprint.
- `scheduleClaims(n, window)` — non-uniform suggested claim times, so recipients do not
  claim in a tight, correlatable burst.
- `guidance(plan)` — the public/hidden breakdown rendered before signing.

Rounding is exact integer arithmetic on the token's smallest unit; the split's sum is
asserted equal to the total, never approximately.

## Error handling

- `strk20PrepareInvoke(actions, true)` dry-runs every transaction before submission — the
  cheapest way to catch a calldata-shape mistake, and it runs before the user signs.
- `waitForTransaction` is bounded by an application timeout. A timeout means "submitted,
  confirmation not visible yet" — keep the explorer link and resume polling; never report
  it as a failure.
- Address comparisons normalize through `BigInt(a) === BigInt(b)`; padded and unpadded
  hex name the same address.
- Pool fee is read live from `get_fee_amount`, never hardcoded, and subtracted before any
  MAX pre-fill.
- New notes mature about 10 blocks before they are spendable; the claim UI states this
  rather than appearing stuck.

## Testing

Cairo (snforge): fund happy path; claim happy path; double claim rejected; wrong secret
rejected; wrong amount with right secret rejected; claim exceeding batch remaining
rejected; caller that is not the pool rejected; two batches isolated from each other.

TypeScript: `splitAmounts` sums exactly and produces no round numbers; `scheduleClaims`
spreads non-uniformly; commitment hashing matches the Cairo implementation on shared
vectors.

Manual, on mainnet: the three-transaction path with small amounts, recorded for the demo.

## Sprint deliverables

`strk20.json` gets the three mainnet transaction hashes (shield, fund, claim), the
deployed `PayrollEscrow` address, and the demo video link. `demo_url` stays empty unless
the deployment is not auto-detected.

Budget: 6 STRK pool fee per private transaction (~18 STRK for the three), plus the
payroll amount and a buffer. Wallet flows sponsor gas but not the pool fee.
