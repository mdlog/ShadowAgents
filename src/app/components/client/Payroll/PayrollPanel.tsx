"use client";

import { useState } from "react";
import { num } from "starknet";
import styles from "../../../uni.module.css";
import * as constants from "@/utils/constants";
import { commitmentHash, randomSecret } from "@/lib/escrow/commitment";
import { ONE_STRK, parseStrk } from "@/lib/format";
import { scheduleClaims } from "@/lib/planner/schedule";
import { splitAmounts } from "@/lib/planner/split";
import PlanPreview from "./PlanPreview";
import type { PayrollPlan, PlanRow } from "./types";

const DEFAULT_RECIPIENTS = "Alice, Bob, Carol";

/**
 * Turns a payroll intent into a privacy-shaped plan.
 *
 * Nothing here touches the chain: the plan, the secrets and the commitments are
 * all produced locally so the user can inspect them before any signature.
 */
export default function PayrollPanel({
  poolFee,
  shieldedBalance,
}: {
  poolFee: bigint | null;
  shieldedBalance: bigint | null;
}) {
  const [names, setNames] = useState(DEFAULT_RECIPIENTS);
  const [totalText, setTotalText] = useState("30");
  const [windowMinutes, setWindowMinutes] = useState(120);
  const [plan, setPlan] = useState<PayrollPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const escrowReady = (() => {
    try {
      return num.toBigInt(constants.PayrollEscrowAddress) !== 0n;
    } catch {
      return false;
    }
  })();

  const buildPlan = () => {
    setError(null);
    setPlan(null);
    try {
      const labels = names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (labels.length === 0) throw new Error("Add at least one recipient.");

      const total = parseStrk(totalText);
      if (total < BigInt(labels.length) * (ONE_STRK / 1000n)) {
        throw new Error("Total is too small to split meaningfully.");
      }

      const rng = Math.random;
      const amounts = splitAmounts(total, labels.length, rng);
      const offsets = scheduleClaims(labels.length, windowMinutes, rng);

      const rows: PlanRow[] = labels.map((label, i) => {
        const secret = randomSecret();
        return {
          label,
          amount: amounts[i],
          offsetMinutes: offsets[i],
          secret,
          commitment: commitmentHash(secret, amounts[i]),
        };
      });

      setPlan({ rows, total, batchId: randomSecret() });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.payroll}>
      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>Private payroll</div>

        <label className={styles.field}>
          <span>Recipients (comma separated)</span>
          <input
            className={styles.input}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder="Alice, Bob, Carol"
          />
        </label>

        <label className={styles.field}>
          <span>Total to pay (STRK)</span>
          <input
            className={styles.input}
            value={totalText}
            onChange={(e) => setTotalText(e.target.value)}
            inputMode="decimal"
          />
        </label>

        <label className={styles.field}>
          <span>Claim window: {windowMinutes} minutes</span>
          <input
            className={styles.range}
            type="range"
            min={10}
            max={720}
            step={10}
            value={windowMinutes}
            onChange={(e) => setWindowMinutes(Number(e.target.value))}
          />
        </label>

        <button className={`${styles.btn} ${styles.btnBlock}`} onClick={buildPlan}>
          Build plan
        </button>
      </div>

      {error && <div className={styles.warn}>{error}</div>}

      {!escrowReady && (
        <div className={styles.warn}>
          PayrollEscrow is not deployed yet — set NEXT_PUBLIC_PAYROLL_ESCROW to fund a
          batch. You can still build and inspect a plan.
        </div>
      )}

      {plan && (
        <PlanPreview plan={plan} poolFee={poolFee} shieldedBalance={shieldedBalance} />
      )}
    </div>
  );
}
