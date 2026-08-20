# Runbook — deploy and run the payroll on mainnet

Everything except the on-chain steps is done and tested. This is the walkthrough for
the part that spends real money.

Read [`cairo-payroll/AUDIT.md`](./cairo-payroll/AUDIT.md) before deploying. The
contract is an unaudited draft and it holds funds across transactions.

## What it costs

The pool charges a flat fee **per private operation**, read live from
`get_fee_amount`. It was **6 STRK** when this was written. Wallet flows sponsor gas
but **not** this fee.

| Step | Private ops | Pool fee | Plus |
| --- | --- | --- | --- |
| Declare + deploy escrow | 0 | none | ordinary gas only |
| 1 · Shield | 1 | 6 STRK | the amount you shield |
| 2 · Fund | 1 | 6 STRK | — (moves already-shielded funds) |
| 3 · Claim (per recipient) | 1 each | 6 STRK each | — |

**A three-transaction demo with one claim needs about 18 STRK in fees**, plus the
payroll amount, plus a buffer. Budget ~40 STRK to be comfortable. Every extra
recipient who claims adds another 6 STRK.

Keep the payroll total small — 3 STRK across three people is enough to demonstrate
the whole flow. The fees dominate either way.

## Before you start

- [ ] Wallet is **Ready** (privacy-enabled) and switched to **Mainnet**
- [ ] `.env.local` has `NEXT_PUBLIC_PROVIDER_URL` set to your Alchemy key
- [ ] `npm run dev` is up, and the Network row in the app reads `MAINNET`
- [ ] The wallet holds enough STRK for fees plus payroll

## Step 0 — deploy the escrow

Payroll tab → **Declare & deploy PayrollEscrow**. Two wallet prompts: declare, then
deploy. The declare is skipped automatically if the class is already on chain.

Deploy is restricted to Mainnet on purpose. The escrow pins its pool address in the
constructor and asserts on it forever, so pinning an unverified address would leave
the contract permanently undrivable with its funds stranded.

When it finishes the receipt shows the address. Then:

```bash
# in .env.local
NEXT_PUBLIC_PAYROLL_ESCROW=0x<the address from the receipt>
```

Restart `npm run dev` — `NEXT_PUBLIC_*` is inlined at build time, so the running
server will not pick it up otherwise.

Record it:

```jsonc
// strk20.json
"contracts": ["0x<escrow address>"]
```

## Step 1 — shield

Shield tab → **Shield**. This deposits into the pool.

Two wallet prompts, and this is expected: the ERC-20 `approve` must land on chain
before the private deposit. If the second prompt looks like a duplicate, it is not.

Shield **more than the payroll total**, because Fund also costs 6 STRK from the
pool. Do this as its own transaction, well before funding — keeping the deposit
separate from the movement is what breaks the public link between them. That
separation is the point, not a formality.

Save the transaction hash.

## Step 2 — fund the payroll

Payroll tab:

1. Recipients: `Alice, Bob, Carol`
2. Total: something small, e.g. `3`
3. Claim window: leave at 120 minutes
4. **Build plan** — check the amounts are uneven, non-round, and sum to your total
5. **Check shielded balance** — the wallet asks for consent; the preview then warns
   if you are short
6. **Fund** — dry-run runs first, then one wallet prompt

If the dry run fails, nothing is signed and nothing is spent. The raw error is shown
verbatim; it is almost always a calldata or balance problem, not a wallet problem.

On success the app shows one **claim link per recipient**. The secret sits in the URL
fragment, so it never reaches a server. **These are shown once and are not
recoverable** — copy them now, and send each over a private channel. Anyone holding
a link can claim that amount.

Save the transaction hash.

## Step 3 — claim

Open a claim link. The Payroll tab switches to the claim view and shows the amount.
Click **Claim**.

The claimer does not need to be registered with the pool beforehand — they are the
sender of their own claim, so their wallet registers them on first use. A new note
matures for about ten blocks before it can be spent, so a short wait after
confirmation is normal, not a stall.

To demo properly, claim from a **different wallet** than the employer's. Claiming
from the same wallet works and proves the mechanism, but it does not show the part
that matters.

Save the transaction hash.

## Step 4 — record the results

```jsonc
// strk20.json
{
  "transactions": [
    "0x<shield tx>",
    "0x<fund tx>",
    "0x<claim tx>"
  ],
  "contracts": ["0x<escrow address>"],
  "demo_video": "https://<3-minute demo>",
  "demo_url": ""
}
```

Leave `demo_url` empty unless the deployment is not detected automatically. The
repository Website field, GitHub Pages, and the most recent successful Vercel or
Netlify deploy are all picked up without being declared.

Commit and push. The hub re-reads the repository every 30 minutes.

## If something goes wrong

| Symptom | What it means |
| --- | --- |
| Dry run fails before any prompt | Calldata or balance problem. Nothing signed, nothing spent. |
| `CALLER_NOT_PRIVACY` | The escrow was pinned to a different pool than the one calling it. Check which network you deployed on. |
| `NO_INPUT` on Fund | The pool transferred nothing new to the escrow. Check the withdraw leg and that you are funding a fresh `batch_id`. |
| `COMMITMENT_NOT_FOUND` on Claim | The secret or the amount does not match the commitment. Both are in the preimage, so a wrong amount fails exactly like a wrong secret. |
| `INSUFFICIENT_BATCH` | The batch has less left than this claim asks for. Someone else claimed first, or commitments were registered above the funded total. |
| Confirmation never appears | Private transactions are relayed. A timeout means "submitted, not visible yet" — keep the explorer link and re-check. |
| Claim seems stuck right after confirming | Note maturity, about ten blocks. Expected. |

Malformed calldata is rejected by the entry-point deserialiser with
`Failed to deserialize param #N` before any contract logic runs.
