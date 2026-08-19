import { describe, expect, it } from "vitest";
import { scheduleClaims } from "./schedule";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("scheduleClaims", () => {
  it("returns ascending offsets inside the window", () => {
    const offsets = scheduleClaims(5, 120, seeded(3));
    expect(offsets).toHaveLength(5);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(offsets[offsets.length - 1]).toBeLessThanOrEqual(120);
    expect(offsets[0]).toBeGreaterThan(0);
  });

  it("spreads non-uniformly, so gaps are not all equal", () => {
    const offsets = scheduleClaims(6, 180, seeded(5));
    const gaps = offsets.slice(1).map((o, i) => o - offsets[i]);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });
});
