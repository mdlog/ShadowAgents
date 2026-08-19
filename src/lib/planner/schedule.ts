import type { Rng } from "./types";

/**
 * Suggested claim offsets, in minutes, spread unevenly across `windowMinutes`.
 *
 * Claims that land in a tight burst are correlatable even though each one is
 * individually private, so the gaps are deliberately irregular.
 */
export function scheduleClaims(n: number, windowMinutes: number, rng: Rng): number[] {
  if (n <= 0) throw new Error("scheduleClaims: need at least one recipient");
  if (windowMinutes < n) {
    throw new Error("scheduleClaims: window too short for that many claims");
  }

  const picks = new Set<number>();
  while (picks.size < n) {
    picks.add(1 + Math.floor(rng() * windowMinutes));
  }
  return [...picks].sort((a, b) => a - b);
}
