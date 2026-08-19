import { describe, expect, it } from "vitest";
import { claimLink, dryRun, parseClaimHash } from "./submit";

describe("dryRun", () => {
  it("reports ok when the wallet prepares the batch", async () => {
    const account = { strk20PrepareInvoke: async () => ({}) };
    expect(await dryRun(account, [])).toEqual({ ok: true });
  });

  it("returns the error instead of throwing, so the UI can show it", async () => {
    const account = {
      strk20PrepareInvoke: async () => {
        throw new Error("calldata length mismatch");
      },
    };
    expect(await dryRun(account, [])).toEqual({
      ok: false,
      error: "calldata length mismatch",
    });
  });
});

describe("claim links", () => {
  it("round-trips a secret and amount through the fragment", () => {
    const link = claimLink("https://x.example", "0x2a", 12n);
    expect(link).toBe("https://x.example/#claim=0x2a.12");
    expect(parseClaimHash(new URL(link).hash)).toEqual({ secret: "0x2a", amount: 12n });
  });

  it("keeps the secret in the fragment, never the query string", () => {
    const link = claimLink("https://x.example", "0xdeadbeef", 1n);
    expect(link.split("#")[0]).not.toContain("0xdeadbeef");
  });

  it("rejects a malformed or absent fragment", () => {
    for (const bad of ["", "#claim=", "#claim=zz.12", "#claim=0x2a", "#other=1"]) {
      expect(parseClaimHash(bad)).toBeNull();
    }
  });
});
