import type { Rng } from "./types";

const ONE_TOKEN = 10n ** 18n;

/**
 * Smallest unit a split is allowed to land on: 1e12 = six decimal places.
 *
 * Quantising matters for more than tidiness. Amounts are shown to six decimals,
 * so unquantised parts would display as truncated values that visibly fail to
 * add up to the total — in a payroll tool, numbers that do not sum read as a
 * bug and undermine the thing the user is being asked to trust.
 */
export const QUANTUM = 10n ** 12n;

/**
 * Split `total` into `n` uneven, non-round amounts that sum to exactly `total`.
 *
 * Round figures are the strongest amount fingerprint a payout leaves, so no part
 * is left on a whole-token boundary. All arithmetic is bigint on the token's
 * smallest unit — the sum is exact, never approximate.
 */
export function splitAmounts(total: bigint, n: number, rng: Rng, quantum = QUANTUM): bigint[] {
  if (n <= 0) throw new Error("splitAmounts: need at least one recipient");
  if (total < BigInt(n) * quantum) {
    throw new Error("splitAmounts: total too small for that many recipients");
  }

  // Work in whole quanta, then scale back, so every part lands on a displayable value.
  const units = total / quantum;
  const dust = total % quantum;

  // Integer weights keep the division exact; floats would lose precision at 1e18.
  const weights = Array.from({ length: n }, () => BigInt(Math.round((1 + rng()) * 1_000_000)));
  const weightSum = weights.reduce((a, b) => a + b, 0n);

  const unitParts = weights.map((w) => (units * w) / weightSum);
  // Whatever integer division dropped goes to the last part, so the sum stays exact.
  const assigned = unitParts.reduce((a, b) => a + b, 0n);
  unitParts[n - 1] += units - assigned;

  if (unitParts.some((p) => p <= 0n)) {
    throw new Error("splitAmounts: total too small for that many recipients");
  }

  const parts = unitParts.map((p) => p * quantum);
  // Any sub-quantum dust rides along on the last part rather than being lost.
  parts[n - 1] += dust;

  return deround(parts, rng, quantum);
}

/**
 * Nudge whole-token amounts off their boundary, conserving the total.
 *
 * Every nudge is a matched pair — what one part loses another gains — so the sum
 * is invariant, and each nudge is a whole number of quanta so parts stay exact
 * at display precision.
 */
function deround(parts: bigint[], rng: Rng, quantum: bigint): bigint[] {
  const out = [...parts];
  const last = out.length - 1;
  if (out.length === 1) return out;

  const nudge = () => (BigInt(Math.floor(rng() * 900)) + 1n) * quantum;

  for (let i = 0; i < last; i++) {
    if (out[i] % ONE_TOKEN !== 0n) continue;
    const delta = nudge();
    if (out[i] - delta <= 0n) continue;
    out[i] -= delta;
    out[last] += delta;
  }

  // The last part absorbed every nudge above, so it is de-rounded separately.
  if (out[last] % ONE_TOKEN === 0n) {
    const delta = nudge();
    if (out[last] - delta > 0n) {
      out[last] -= delta;
      out[0] += delta;
    }
  }
  return out;
}
