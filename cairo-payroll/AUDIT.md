# PayrollEscrow — state-inconsistency audit

Scope: `src/lib.cairo` (`PayrollEscrow`). Method: coupled-state mapping, mutation
matrix, then a PoC test per finding (`tests/test_audit.cairo`, 5 probes, all passing).

**This contract is a draft and has had no external audit.** What follows is an
internal pass, not a substitute for one.

## Coupled state

| Pair | Invariant |
| --- | --- |
| P1 | `accounted[token]` == Σ `batches[*].remaining` over batches holding that token |
| P2 | `balance_of(self)` >= `accounted[token]` — promises are covered by tokens actually held |
| P3 | a commitment may decrement `batches[id].remaining` exactly once |

## Mutation matrix

| State | Fund | Claim | Other paths |
| --- | --- | --- | --- |
| `batches[id]` | created with `remaining = delta` | `remaining -= amount` | none |
| `accounted[token]` | `+= delta` | `-= amount` | none |
| `commitments[h]` | created, `claimed = false` | `claimed = true` | none |

Fund raises both sides of P1 by the same value; Claim lowers both by the same
value; `claimed` blocks a second decrement. **P1 and P3 hold on every path.**
There is no admin path, no emergency path, and no upgrade path to break them.

P2 is different: it depends on the ERC-20 balance, which the contract does not
control. Both findings live there.

## Findings

### SI-001 · Unsolicited transfers are absorbed by the next batch · MEDIUM

`Fund` measures new funding as `balance_of(self) - accounted[token]`. A plain
ERC-20 transfer to the escrow raises the balance without raising `accounted`, and
nobody can prevent such a transfer. The next `Fund` counts it as part of its own
delta.

Proven by `a_donation_is_absorbed_by_the_next_batch`: 5 sent in unsolicited plus a
30 withdrawal produces a batch with `remaining == 35`.

**Contained, and that containment is the point of the per-batch design.** A later
`Fund` cannot alter an existing batch, and a claim can only draw down its own
batch — proven by `an_existing_batch_is_untouched_by_a_later_fund` and
`a_claim_draws_down_only_its_own_batch`. So the exposure is limited to value that
nobody had a claim on; no employer's funds can be taken by another.

Not fixed. Removing it would need a sweep function, which needs an owner, which
would make a trustless escrow custodial. The app instead funds and registers in
one transaction, so a donation can only ever inflate a batch, never deflate one.

### SI-002 · Surplus above the registered commitments is stranded · MEDIUM

If a batch's `remaining` exceeds what its commitments can claim, the difference
stays in the contract permanently. There is no sweep, by design.

Proven by `surplus_beyond_the_registered_commitments_is_stranded`: a batch funded
with 30 against a single 12 commitment leaves 18 unreachable.

Mitigated in the app rather than the contract: the planner splits the total
exactly, so registered commitments always sum to the funded amount. The residual
risk is SI-001 inflating a batch after the split was computed.

### SI-003 · Claims are publicly groupable by batch · LOW (disclosure, not loss)

`Claimed` indexes `batch_id`, so an observer can group every claim belonging to one
payroll and read the amounts as they land. Identities stay hidden, but "these
claims are one employer's payroll" does not.

The linkage exists regardless of the event, because `batch_id` is a public calldata
parameter of `Fund`; the event only makes it trivially indexable. Fixed where it
mattered: the UI's Public column now states it, because the disclosure panel
previously implied more privacy than the design delivers.

## False positives eliminated

- **Reentrancy through a malicious token.** `Fund` calls `balance_of` and `Claim`
  calls `approve` on an employer-chosen token. A reentrant call fails the
  `CALLER_NOT_PRIVACY` assert, because the reentrant caller is the token, not the
  pool. Independently, every state write in `Claim` precedes the external call, so
  even a bypass would find state already settled.
- **`assert(balance > accounted)` masking a broken invariant.** It is a guard, not
  a mask: no underflow is possible behind it. It would, however, report `NO_INPUT`
  if P2 were ever violated, which reads as "nothing arrived" rather than
  "accounting is broken". Informational only — P2 cannot be violated by any path
  in this contract.

## Summary

Coupled pairs mapped 3 · mutation paths 6 · findings 3 (2 MEDIUM, 1 LOW) ·
false positives eliminated 2. No path breaks P1 or P3. Both MEDIUM findings sit on
P2, are contained to value nobody had a claim on, and are accepted trade-offs of
having no privileged owner.

**Before mainnet with meaningful value: get an external audit.**
