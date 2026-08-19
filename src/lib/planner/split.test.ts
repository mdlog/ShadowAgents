import { describe, expect, it } from "vitest";
import { QUANTUM, splitAmounts } from "./split";

// Deterministic RNG so a failure is reproducible.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const ONE = 10n ** 18n;

describe("splitAmounts", () => {
  it("sums to exactly the total", () => {
    for (let n = 2; n <= 8; n++) {
      const parts = splitAmounts(30n * ONE, n, seeded(n));
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(30n * ONE);
    }
  });

  it("returns one positive amount per recipient", () => {
    const parts = splitAmounts(30n * ONE, 5, seeded(7));
    expect(parts).toHaveLength(5);
    for (const p of parts) expect(p > 0n).toBe(true);
  });

  it("avoids round amounts, which are the strongest fingerprint", () => {
    const parts = splitAmounts(30n * ONE, 3, seeded(11));
    for (const p of parts) expect(p % ONE).not.toBe(0n);
  });

  it("lands every part on a displayable six-decimal value", () => {
    // Parts that are not whole quanta would render truncated and visibly fail to
    // add up to the stated total.
    for (let n = 2; n <= 6; n++) {
      const parts = splitAmounts(30n * ONE, n, seeded(n * 3));
      for (const p of parts) expect(p % QUANTUM).toBe(0n);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(30n * ONE);
    }
  });

  it("rejects a split that cannot give everyone a positive amount", () => {
    expect(() => splitAmounts(2n, 5, seeded(1))).toThrow(/too small/i);
  });
});
