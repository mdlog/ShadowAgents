import type { WALLET_API } from "@starknet-io/types-js";
import { num } from "starknet";

/** Enum variant indices — must match `PayrollOperation` in Cairo. */
const OP_FUND = "0x0";
const OP_CLAIM = "0x1";
const ZERO = "0x0";

/**
 * Fund one batch: the pool withdraws `total` to the escrow, then calls its
 * privacy_invoke. Calldata order mirrors privacy_invoke's parameters exactly —
 * the pool deserializes straight into them.
 */
export function buildFundActions(a: {
  token: string;
  total: bigint;
  escrow: string;
  batchId: string;
  commitments: string[];
}): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "withdraw", token: a.token, amount: num.toHex(a.total), recipient: a.escrow },
    {
      type: "invoke",
      contract: a.escrow,
      calldata: [
        OP_FUND,
        a.batchId,
        a.token,
        ZERO, // secret — unused on Fund
        ZERO, // amount — unused on Fund
        ZERO, // note_id — unused on Fund
        num.toHex(a.commitments.length), // Span<felt252> length prefix
        ...a.commitments,
      ],
    },
  ];
}

/**
 * Claim one commitment into a fresh open note owned by the claimer.
 *
 * "OPEN" and "${openNoteIds[0]}" are literal placeholders the wallet
 * substitutes during assembly — they must not be hex-normalized.
 */
export function buildClaimActions(a: {
  token: string;
  escrow: string;
  claimer: string;
  secret: string;
  amount: bigint;
}): WALLET_API.STRK20_ACTION[] {
  return [
    { type: "transfer", token: a.token, amount: "OPEN", recipient: a.claimer },
    {
      type: "invoke",
      contract: a.escrow,
      calldata: [
        OP_CLAIM,
        ZERO, // batch_id — resolved from the commitment
        ZERO, // token — resolved from the batch
        a.secret,
        num.toHex(a.amount),
        "${openNoteIds[0]}",
        ZERO, // empty Span<felt252>
      ],
    },
  ];
}
