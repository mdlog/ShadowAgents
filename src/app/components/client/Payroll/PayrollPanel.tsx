"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";
import styles from "../../../uni.module.css";
import * as constants from "@/utils/constants";
import { buildClaimActions, buildFundActions } from "@/lib/escrow/actions";
import { commitmentHash, randomSecret } from "@/lib/escrow/commitment";
import { type DryRunResult, claimLink, parseClaimHash } from "@/lib/escrow/submit";
import { ONE_STRK, fmtStrk, parseStrk } from "@/lib/format";
import { scheduleClaims } from "@/lib/planner/schedule";
import { splitAmounts } from "@/lib/planner/split";
import PlanPreview from "./PlanPreview";
import type { PayrollPlan, PlanRow } from "./types";

const DEFAULT_RECIPIENTS = "Alice, Bob, Carol";
const TOKEN = constants.addrSTRK;

type Props = {
  poolFee: bigint | null;
  shieldedBalance: bigint | null;
  isConnected: boolean;
  connectedAddress: string;
  onDryRun: (actions: WALLET_API.STRK20_ACTION[]) => Promise<DryRunResult>;
  onSubmit: (
    actions: WALLET_API.STRK20_ACTION[],
    amountLabel: string,
  ) => Promise<string | undefined>;
  result: ReactNode;
  onDeployEscrow: () => void;
  deployingEscrow: boolean;
  deployResult: ReactNode;
};

/**
 * Private payroll: turn an intent into a plan, fund one batch, hand out claim links.
 *
 * The plan, the secrets and the commitments are all produced locally, so the user
 * can inspect exactly what will reach the chain before any signature.
 */
export default function PayrollPanel(props: Props) {
  const [claim, setClaim] = useState<{ secret: string; amount: bigint } | null>(null);

  // A claim link puts the secret in the fragment, so this component doubles as the
  // recipient's claim screen when one is present.
  useEffect(() => {
    const read = () => setClaim(parseClaimHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  return claim ? <ClaimView claim={claim} {...props} /> : <FundView {...props} />;
}

const escrowAddress = () => {
  try {
    return num.toBigInt(constants.PayrollEscrowAddress) === 0n
      ? null
      : constants.PayrollEscrowAddress;
  } catch {
    return null;
  }
};

function FundView({
  poolFee,
  shieldedBalance,
  isConnected,
  onDryRun,
  onSubmit,
  result,
  onDeployEscrow,
  deployingEscrow,
  deployResult,
}: Props) {
  const [names, setNames] = useState(DEFAULT_RECIPIENTS);
  const [totalText, setTotalText] = useState("30");
  const [windowMinutes, setWindowMinutes] = useState(120);
  const [plan, setPlan] = useState<PayrollPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [funded, setFunded] = useState(false);

  const escrow = escrowAddress();

  const buildPlan = () => {
    setError(null);
    setPlan(null);
    setFunded(false);
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

  const fund = async () => {
    if (!plan || !escrow) return;
    setError(null);
    setBusy(true);
    try {
      const actions = buildFundActions({
        token: TOKEN,
        total: plan.total,
        escrow,
        batchId: plan.batchId,
        commitments: plan.rows.map((r) => r.commitment),
      });

      // Catch a calldata-shape mistake before the wallet prompt, not after.
      const dry = await onDryRun(actions);
      if (!dry.ok) {
        setError(`Dry run failed, nothing was signed: ${dry.error}`);
        return;
      }

      const txHash = await onSubmit(actions, `${fmtStrk(plan.total)} STRK`);
      if (txHash) setFunded(true);
    } finally {
      setBusy(false);
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

      {!escrow && (
        <>
          <div className={styles.warn}>
            PayrollEscrow is not deployed yet. Deploy it with your own wallet below — no
            private key or keystore is involved. You can build and inspect a plan without
            it. This contract is an unaudited draft: read cairo-payroll/AUDIT.md first.
          </div>
          <button
            className={`${styles.btn} ${styles.btnGreen} ${styles.btnBlock}`}
            disabled={!isConnected || deployingEscrow}
            onClick={onDeployEscrow}
          >
            {deployingEscrow ? "Deploying…" : "Declare & deploy PayrollEscrow"}
          </button>
          {deployResult}
        </>
      )}

      {plan && (
        <>
          <PlanPreview plan={plan} poolFee={poolFee} shieldedBalance={shieldedBalance} />

          {funded ? (
            <ClaimLinks plan={plan} />
          ) : (
            <button
              className={styles.btnCta}
              disabled={!escrow || !isConnected || busy}
              onClick={fund}
            >
              {busy
                ? "Funding…"
                : poolFee !== null
                  ? `Fund ${fmtStrk(plan.total)} STRK (+ ${fmtStrk(poolFee)} pool fee)`
                  : `Fund ${fmtStrk(plan.total)} STRK`}
            </button>
          )}
        </>
      )}

      {result}
    </div>
  );
}

/** The links the employer sends out. Each secret is shown once, here, and nowhere else. */
function ClaimLinks({ plan }: { plan: PayrollPlan }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className={styles.planWrap}>
      <div className={styles.planHead}>
        <span>Claim links — share each one privately with its recipient</span>
      </div>
      {plan.rows.map((r) => (
        <div key={r.commitment} className={styles.field}>
          <span>
            {r.label} · {fmtStrk(r.amount)} STRK · suggested +{r.offsetMinutes}m
          </span>
          <input className={styles.input} readOnly value={claimLink(origin, r.secret, r.amount)} />
        </div>
      ))}
      <p className={styles.planNote}>
        These secrets are not stored anywhere and are not recoverable — copy them now.
        Anyone holding a link can claim that amount, so send them over a private channel.
      </p>
    </div>
  );
}

function ClaimView({
  claim,
  isConnected,
  connectedAddress,
  onDryRun,
  onSubmit,
  result,
}: Props & { claim: { secret: string; amount: bigint } }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const escrow = escrowAddress();

  const runClaim = async () => {
    if (!escrow || !connectedAddress) return;
    setError(null);
    setBusy(true);
    try {
      const actions = buildClaimActions({
        token: TOKEN,
        escrow,
        claimer: connectedAddress,
        secret: claim.secret,
        amount: claim.amount,
      });

      const dry = await onDryRun(actions);
      if (!dry.ok) {
        setError(`Dry run failed, nothing was signed: ${dry.error}`);
        return;
      }
      await onSubmit(actions, `${fmtStrk(claim.amount)} STRK`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.payroll}>
      <div className={styles.inputBlock}>
        <div className={styles.inputLabel}>You have a private payment</div>
        <div className={styles.inputMain}>
          <div className={styles.bigValue}>{fmtStrk(claim.amount)}</div>
          <span className={styles.tokenPill}>STRK</span>
        </div>
        <div className={styles.subLine}>
          <span>Claims into a private note you own</span>
        </div>
      </div>

      {!escrow && <div className={styles.warn}>PayrollEscrow is not configured.</div>}
      {error && <div className={styles.warn}>{error}</div>}

      <button
        className={styles.btnCta}
        disabled={!escrow || !isConnected || busy}
        onClick={runClaim}
      >
        {busy ? "Claiming…" : `Claim ${fmtStrk(claim.amount)} STRK`}
      </button>

      <p className={styles.planNote}>
        You do not need to be registered with the pool first — you are the sender of this
        claim, so your wallet registers you on first use. A new note matures for about ten
        blocks before it can be spent, so a short wait after confirmation is expected.
      </p>

      {result}
    </div>
  );
}
