import type { Rng } from "./types";

const ONE_TOKEN = 10n ** 18n;

/**
 * Split `total` into `n` uneven, non-round amounts that sum to exactly `total`.
 *
 * Round figures are the strongest amount fingerprint a payout leaves, so every
 * part is nudged off a whole-token boundary. All arithmetic is bigint on the
 * token's smallest unit — the sum is exact, never approximate.
 */
export function splitAmounts(total: bigint, n: number, rng: Rng): bigint[] {
  if (n <= 0) throw new Error("splitAmounts: need at least one recipient");
  if (total < BigInt(n)) {
    throw new Error("splitAmounts: total too small for that many recipients");
  }

  // Integer weights keep the division exact; floats would lose precision at 1e18.
  const weights = Array.from({ length: n }, () => BigInt(Math.round((1 + rng()) * 1_000_000)));
  const weightSum = weights.reduce((a, b) => a + b, 0n);

  const parts = weights.map((w) => (total * w) / weightSum);
  // Whatever integer division dropped goes to the last part, so the sum stays exact.
  const assigned = parts.reduce((a, b) => a + b, 0n);
  parts[n - 1] += total - assigned;

  return deround(parts, rng);
}

/**
 * Nudge whole-token amounts off their boundary, conserving the total.
 *
 * Every nudge is a matched pair: what one part loses another gains, so the sum
 * is invariant. A nudge is skipped rather than applied when it would drive a
 * part to zero or below.
 */
function deround(parts: bigint[], rng: Rng): bigint[] {
  const out = [...parts];
  const last = out.length - 1;
  if (out.length === 1) return out;

  for (let i = 0; i < last; i++) {
    if (out[i] % ONE_TOKEN !== 0n) continue;
    const nudge = BigInt(Math.floor(rng() * 1e15)) + 1n;
    if (out[i] - nudge <= 0n) continue;
    out[i] -= nudge;
    out[last] += nudge;
  }

  // The last part absorbed every nudge above, so it is de-rounded separately.
  if (out[last] % ONE_TOKEN === 0n) {
    const nudge = BigInt(Math.floor(rng() * 1e15)) + 1n;
    if (out[last] - nudge > 0n) {
      out[last] -= nudge;
      out[0] += nudge;
    }
  }
  return out;
}
