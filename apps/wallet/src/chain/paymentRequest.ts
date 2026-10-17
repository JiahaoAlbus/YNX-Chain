import { evmAddressFromYNX, ynxAddressFromEVM } from "@ynx-chain/wallet-auth";

export const PAYMENT_CHAIN_ID = "ynx_6423-1";
export const PAYMENT_ASSET = "YNXT";
const MAX_INPUT_LENGTH = 256;

export class PaymentRequestError extends Error {
  constructor(readonly code: "INVALID_PAYMENT_REQUEST" | "UNSUPPORTED_PAYMENT_NETWORK") {
    super(code === "UNSUPPORTED_PAYMENT_NETWORK"
      ? "This receiving link is for a different network or asset."
      : "Use a valid native ynx1 address or YNX Testnet receiving link.");
  }
}

export type PaymentRecipient = Readonly<{
  recipient: string;
  chainId: typeof PAYMENT_CHAIN_ID;
  asset: typeof PAYMENT_ASSET;
  kind: "address" | "payment-uri";
}>;

function invalid(): never { throw new PaymentRequestError("INVALID_PAYMENT_REQUEST"); }
function canonicalRecipient(value: string): string {
  try {
    if (ynxAddressFromEVM(evmAddressFromYNX(value)) !== value) invalid();
    return value;
  } catch { return invalid(); }
}

/** Public receiving data only. No amount, callback, authorization or action is
 * accepted. Parse raw ASCII deliberately, without URL decoding/normalization. */
export function parsePaymentRecipient(input: unknown): PaymentRecipient {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_INPUT_LENGTH || /[^\x21-\x7e]/.test(input)) invalid();
  if (!input.startsWith("ynx:")) {
    return Object.freeze({ recipient: canonicalRecipient(input), chainId: PAYMENT_CHAIN_ID, asset: PAYMENT_ASSET, kind: "address" });
  }
  const match = /^ynx:(ynx1[023456789acdefghjklmnpqrstuvwxyz]{38})\?([^?#%/\\]+)$/.exec(input);
  if (!match) invalid();
  const pairs = match[2]!.split("&");
  if (pairs.length !== 2) invalid();
  const values = new Map<string, string>();
  for (const pair of pairs) {
    const parts = pair.split("=");
    if (parts.length !== 2 || !["chainId", "asset"].includes(parts[0]!) || values.has(parts[0]!)) invalid();
    values.set(parts[0]!, parts[1]!);
  }
  if (!values.has("chainId") || !values.has("asset")) invalid();
  if (values.get("chainId") !== PAYMENT_CHAIN_ID || values.get("asset") !== PAYMENT_ASSET) throw new PaymentRequestError("UNSUPPORTED_PAYMENT_NETWORK");
  return Object.freeze({ recipient: canonicalRecipient(match[1]!), chainId: PAYMENT_CHAIN_ID, asset: PAYMENT_ASSET, kind: "payment-uri" });
}

export function createPaymentURI(recipient: string): string {
  return `ynx:${canonicalRecipient(recipient)}?chainId=${PAYMENT_CHAIN_ID}&asset=${PAYMENT_ASSET}`;
}
