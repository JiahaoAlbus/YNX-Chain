import { nativeQuantity, parseNativeDurabilityModel, parseNativeDurabilityState } from "./nativeDurability";

export const FAUCET_LEDGER_PROFILE = "ynx-native-faucet-receipt-v1";
export type FaucetTransactionBinding = Readonly<{
  hash: string; type: "faucet"; from: "ynx_faucet"; to: string;
  amount: number; fee: 0; nonce: number;
}>;
export class FaucetReceiptInvalid extends Error {
  readonly code = "FAUCET_RECEIPT_INVALID";
  constructor() { super("The original test YNXT claim has no verified durable receipt yet."); }
}

/** Only an authenticated acknowledgement for the reviewed recipient/amount may
 * supply this binding. A transaction hash or an account balance by itself cannot
 * reconstruct a missing acknowledgement or authorize another Faucet POST. */
export function bindFaucetTransaction(value: unknown, recipient: string, amount: number): FaucetTransactionBinding {
  const tx = data(value, ["hash", "type", "from", "to", "amount", "fee", "nonce"]);
  if (typeof recipient !== "string" || !/^0x[0-9a-f]{40}$/.test(recipient) || !Number.isSafeInteger(amount) || amount <= 0 ||
    typeof tx.hash !== "string" || !/^0x[0-9a-f]{64}$/.test(tx.hash) || tx.type !== "faucet" ||
    tx.from !== "ynx_faucet" || tx.to !== recipient || tx.amount !== amount || tx.fee !== 0 ||
    !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) invalid();
  return Object.freeze({ hash: tx.hash, type: "faucet", from: "ynx_faucet", to: recipient, amount, fee: 0, nonce: tx.nonce });
}

/** Validate a node response separately from native signed transfers. Faucet
 * nonce is the accepted ledger nonce, including zero; it is not incremented by
 * the client and is never an idempotency key. Ethereum gas projections do not
 * establish the native amount or zero fee. This proof is a local snapshot only. */
export function parseFaucetDurableReceipt(value: unknown, expected: FaucetTransactionBinding): Readonly<Record<string, unknown>> {
  try {
    const binding = data(expected, ["to", "amount"]);
    const tx = bindFaucetTransaction(binding, binding.to, binding.amount);
    const receipt = data(value, ["ynxDurability", "status", "transactionHash", "from", "to", "contractAddress", "blockNumber", "blockHash", "transactionIndex", "ynxNativeTransaction"]);
    const proof = parseNativeDurabilityState(receipt.ynxDurability, tx.hash);
    if (proof.status !== "durable" || receipt.status !== "0x1" || receipt.transactionHash !== tx.hash ||
      receipt.from !== tx.from || receipt.to !== tx.to || receipt.contractAddress !== null ||
      receipt.blockNumber !== proof.blockNumber || receipt.blockHash !== proof.blockHash) invalid();
    nativeQuantity(receipt.transactionIndex);
    const native = data(receipt.ynxNativeTransaction);
    if (Object.keys(native).sort().join() !== "amountYNXT,feeYNXT,nonce,type" || native.type !== "faucet" ||
      native.amountYNXT !== String(tx.amount) || native.feeYNXT !== "0" || nativeQuantity(native.nonce) !== BigInt(tx.nonce)) invalid();
    return Object.freeze({ transactionHash: tx.hash, from: tx.from, to: tx.to, status: "0x1", contractAddress: null,
      transactionIndex: receipt.transactionIndex, blockNumber: proof.blockNumber, blockHash: proof.blockHash,
      ynxDurability: proof, ynxNativeTransaction: Object.freeze({ ...native }) });
  } catch { return invalid(); }
}

export function createFaucetDurabilityEvidence(origin: string, capability: unknown, receipt: unknown, expected: FaucetTransactionBinding): Readonly<Record<string, unknown>> {
  try {
    // The transport owner must pin this origin and verify actual chain 0x1917
    // and capability again after receipt I/O before using this candidate.
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) invalid();
    return Object.freeze({ version: 1, profile: FAUCET_LEDGER_PROFILE, origin, chainId: "0x1917",
      capability: parseNativeDurabilityModel(capability), receipt: parseFaucetDurableReceipt(receipt, expected) });
  } catch { return invalid(); }
}

function data(value: unknown, required: readonly string[] = []): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  for (const key of required) if (!Object.hasOwn(value, key)) return invalid();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) return invalid();
  }
  return value as Record<string, any>;
}
function invalid(): never { throw new FaucetReceiptInvalid(); }
