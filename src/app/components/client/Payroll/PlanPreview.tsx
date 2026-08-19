"use client";

import styles from "../../../uni.module.css";
import { fmtStrk, shortHex } from "@/lib/format";
import type { PayrollPlan } from "./types";

/**
 * Shows the plan before anything is signed, alongside an explicit account of
 * what this flow makes public. The privacy claim has to be legible to the person
 * relying on it, so the visible column is stated as plainly as the hidden one.
 */
export default function PlanPreview({
  plan,
  poolFee,
  shieldedBalance,
}: {
  plan: PayrollPlan;
  poolFee: bigint | null;
  shieldedBalance: bigint | null;
}) {
  const needed = poolFee === null ? plan.total : plan.total + poolFee;
  const short = shieldedBalance !== null && shieldedBalance < needed;

  return (
    <div className={styles.planWrap}>
      <div className={styles.planHead}>
        <span>Plan · batch {shortHex(plan.batchId)}</span>
        <span className={styles.planTotal}>{fmtStrk(plan.total)} STRK</span>
      </div>

      <div className={styles.planTable}>
        <div className={`${styles.planRow} ${styles.planRowHead}`}>
          <span>Recipient</span>
          <span>Amount</span>
          <span>Claim at</span>
          <span>Commitment</span>
        </div>
        {plan.rows.map((r) => (
          <div key={r.commitment} className={styles.planRow}>
            <span>{r.label}</span>
            <span className={styles.planNum}>{fmtStrk(r.amount)}</span>
            <span className={styles.planNum}>+{r.offsetMinutes}m</span>
            <span className={styles.planMono}>{shortHex(r.commitment)}</span>
          </div>
        ))}
      </div>

      {short && (
        <div className={styles.warn}>
          Shielded balance is {fmtStrk(shieldedBalance!)} STRK but this needs{" "}
          {fmtStrk(needed)} STRK ({fmtStrk(plan.total)} payroll
          {poolFee !== null ? ` + ${fmtStrk(poolFee)} pool fee` : ""}). Shield more first.
        </div>
      )}

      <div className={styles.disclose}>
        <div className={styles.discloseCol}>
          <div className={styles.discloseHeadPublic}>Public</div>
          <ul>
            <li>The pool → escrow transfer, and the escrow&apos;s funded total</li>
            <li>Each claim&apos;s amount, once that recipient claims</li>
            <li>The timing of every transaction</li>
          </ul>
        </div>
        <div className={styles.discloseCol}>
          <div className={styles.discloseHeadHidden}>Hidden</div>
          <ul>
            <li>Which recipient holds which commitment</li>
            <li>Every per-recipient amount, until that recipient claims</li>
            <li>The mapping from you to any recipient</li>
          </ul>
        </div>
      </div>

      <p className={styles.planNote}>
        Amounts are deliberately uneven and non-round: round figures are the strongest
        fingerprint a payout leaves. Claim times are staggered because a tight burst of
        claims is correlatable even though each claim is individually private.
      </p>
    </div>
  );
}
