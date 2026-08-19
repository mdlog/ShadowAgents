import { hash, num, shortString } from "starknet";

/** Domain-separation tag. Must stay identical to PAYROLL_COMMITMENT_TAG in Cairo. */
export const PAYROLL_TAG = shortString.encodeShortString("SA_PAYROLL_V1");

/**
 * poseidon(TAG, secret, amount) — the same span the Cairo contract hashes.
 *
 * The amount lives inside the preimage, which is what keeps per-recipient
 * amounts out of the funding calldata. Parity with the Cairo implementation is
 * asserted in commitment.test.ts against a vector printed by snforge.
 */
export function commitmentHash(secret: string, amount: bigint): string {
  return hash.computePoseidonHashOnElements([PAYROLL_TAG, secret, num.toHex(amount)]);
}

/** A 248-bit random secret, generated in the browser and never transmitted. */
export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return num.toHex(BigInt("0x" + hex));
}
