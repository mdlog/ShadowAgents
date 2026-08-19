import type { WALLET_API } from "@starknet-io/types-js";
import type { ProviderInterface } from "starknet";
import { PRIVACY_POOL_MAINNET } from "@/utils/constants";

/** Just enough of WalletAccountV6 to prepare a batch, so tests need no wallet. */
type Preparer = {
  strk20PrepareInvoke: (actions: WALLET_API.STRK20_ACTION[], simulate?: boolean) => Promise<unknown>;
};

export type DryRunResult = { ok: true } | { ok: false; error: string };

/**
 * Build and prove the batch without submitting it.
 *
 * This is the cheapest way to catch a calldata-shape mistake, and it runs before
 * the user is asked to sign — a malformed invoke should never reach a wallet
 * prompt, let alone cost a pool fee.
 */
export async function dryRun(
  account: Preparer,
  actions: WALLET_API.STRK20_ACTION[],
): Promise<DryRunResult> {
  try {
    await account.strk20PrepareInvoke(actions, true);
    return { ok: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The flat per-operation pool fee, read live.
 *
 * It is governance-set, so hardcoding it means the operation fails after the
 * user has already signed. Wallet flows sponsor gas but not this fee.
 */
export async function readPoolFee(provider: ProviderInterface): Promise<bigint> {
  const res = await provider.callContract({
    contractAddress: PRIVACY_POOL_MAINNET,
    entrypoint: "get_fee_amount",
    calldata: [],
  });
  const raw = Array.isArray(res) ? res[0] : (res as unknown as { result: string[] }).result[0];
  return BigInt(raw);
}

/** Encode a claim link. The secret rides in the fragment, so it never reaches a server. */
export function claimLink(origin: string, secret: string, amount: bigint): string {
  return `${origin}/#claim=${secret}.${amount.toString()}`;
}

/** Decode a claim link fragment; null when the fragment is absent or malformed. */
export function parseClaimHash(hash: string): { secret: string; amount: bigint } | null {
  const m = /^#claim=(0x[0-9a-fA-F]+)\.(\d+)$/.exec(hash);
  if (!m) return null;
  try {
    return { secret: m[1], amount: BigInt(m[2]) };
  } catch {
    return null;
  }
}
