import { describe, expect, it } from "vitest";
import { ONE_STRK, fmtStrk, parseStrk, shortHex } from "./format";

describe("parseStrk / fmtStrk", () => {
  it("round-trips whole and fractional amounts", () => {
    expect(parseStrk("10")).toBe(10n * ONE_STRK);
    expect(parseStrk("1.5")).toBe(15n * ONE_STRK / 10n);
    expect(fmtStrk(10n * ONE_STRK)).toBe("10");
    expect(fmtStrk(15n * ONE_STRK / 10n)).toBe("1.5");
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", "abc", "1e18", "-5", "1.2.3", " 1,5 "]) {
      expect(() => parseStrk(bad)).toThrow();
    }
  });

  it("rejects more precision than STRK has decimals", () => {
    expect(() => parseStrk("1." + "0".repeat(19))).toThrow(/precision/i);
  });

  it("shortens long hex only", () => {
    expect(shortHex("0x1234")).toBe("0x1234");
    expect(shortHex("0x" + "a".repeat(60))).toMatch(/^0xaaaaa\.\.\.aaaa$/);
  });
});
