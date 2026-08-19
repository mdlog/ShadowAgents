import { describe, expect, it } from "vitest";
import { buildClaimActions, buildFundActions } from "./actions";

const TOKEN = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ESCROW = "0xabc";
const CLAIMER = "0xdef";

describe("buildFundActions", () => {
  it("withdraws to the escrow then invokes Fund with the commitment span", () => {
    const actions = buildFundActions({
      token: TOKEN,
      total: 30n,
      escrow: ESCROW,
      batchId: "0x7",
      commitments: ["0x11", "0x22"],
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "withdraw",
      token: TOKEN,
      amount: "0x1e",
      recipient: ESCROW,
    });
    // operation=Fund(0), batch_id, token, secret=0, amount=0, note_id=0, span(len, ...items)
    expect(actions[1]).toEqual({
      type: "invoke",
      contract: ESCROW,
      calldata: ["0x0", "0x7", TOKEN, "0x0", "0x0", "0x0", "0x2", "0x11", "0x22"],
    });
  });
});

describe("buildClaimActions", () => {
  it("opens a note for the claimer then invokes Claim against it", () => {
    const actions = buildClaimActions({
      token: TOKEN,
      escrow: ESCROW,
      claimer: CLAIMER,
      secret: "0x2a",
      amount: 12n,
    });

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: "transfer",
      token: TOKEN,
      amount: "OPEN",
      recipient: CLAIMER,
    });
    // operation=Claim(1), batch_id=0, token=0, secret, amount, note placeholder, empty span
    expect(actions[1]).toEqual({
      type: "invoke",
      contract: ESCROW,
      calldata: ["0x1", "0x0", "0x0", "0x2a", "0xc", "${openNoteIds[0]}", "0x0"],
    });
  });
});
