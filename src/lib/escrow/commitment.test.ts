import { describe, expect, it } from "vitest";
import { PAYROLL_TAG, commitmentHash, randomSecret } from "./commitment";

// Printed by `snforge test print_parity_vector` (cairo-payroll/tests/test_hash.cairo).
// If this ever disagrees, the TS and Cairo hashes have diverged and every claim breaks.
const CAIRO_PARITY_VECTOR =
  "0x108c73dcc9135c01639b6824c5086a6fedb65d583d48797ddb6c7ff3787c70e";

describe("commitmentHash", () => {
  it("uses the versioned short-string tag the Cairo contract uses", () => {
    expect(PAYROLL_TAG).toBe("0x53415f504159524f4c4c5f5631");
  });

  it("matches the vector printed by the Cairo test", () => {
    expect(BigInt(commitmentHash("0x2a", 100n))).toBe(BigInt(CAIRO_PARITY_VECTOR));
  });

  it("binds both the secret and the amount", () => {
    const a = commitmentHash("0x2a", 100n);
    expect(commitmentHash("0x2b", 100n)).not.toBe(a);
    expect(commitmentHash("0x2a", 101n)).not.toBe(a);
    expect(commitmentHash("0x2a", 100n)).toBe(a);
  });

  it("generates distinct secrets", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => randomSecret()));
    expect(secrets.size).toBe(50);
  });
});
