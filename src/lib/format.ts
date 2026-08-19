/** STRK has 18 decimals; all amounts are bigint on the smallest unit. */
export const STRK_DECIMALS = 18n;
export const ONE_STRK = 10n ** STRK_DECIMALS;

/** Format a smallest-unit amount as a human STRK string ("10", "1.5", "4.213701"). */
export function fmtStrk(amount: bigint, maxFractionDigits = 6): string {
  const whole = amount / ONE_STRK;
  const frac = (amount % ONE_STRK).toString().padStart(18, "0");
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : `${whole}`;
}

/**
 * Parse a human STRK string into smallest units. Throws on anything that is not
 * a plain decimal, so a typo can never be silently read as a different amount.
 */
export function parseStrk(input: string): bigint {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`not a plain decimal amount: "${input}"`);
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 18) throw new Error("more precision than STRK has decimals");
  return BigInt(whole) * ONE_STRK + BigInt(frac.padEnd(18, "0") || "0");
}

/** Shorten a hex value for display ("0x1dc5a1c...1927a"). */
export function shortHex(hex: string): string {
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}...${hex.slice(-4)}`;
}
