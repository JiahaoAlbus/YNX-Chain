import { formatEther } from "ethers";
import { parseDurabilityModel } from "./transaction-durability.mjs";

export function capabilityError(code, message) { return Object.assign(new Error(message), { code: 4900, data: { code } }); }
export function parseFeeModel(value) {
  const expected = { version: "ynx-ethereum-native-v1", chainId: "0x1917", transactionType: "0x0", feeYNXT: "1", feeWei: "0xde0b6b3a7640000", gas: "0x61a8", gasPrice: "0x246139ca8000", decimals: 18, amountQuantumWei: "0xde0b6b3a7640000", scope: "whole-YNXT plain native transfers", fullEVM: false, eip1559: false };
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean" || Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
    throw capabilityError("RPC_CAPABILITIES_UNKNOWN", "The network's amount units and transaction capabilities could not be verified. No balance conversion or signing is available.");
  }
  return Object.freeze({ ...expected, enabled: value.enabled, unit: value.enabled ? "wei" : "whole-YNXT", maxGasLimit: "0x1c9c380", ...(Object.hasOwn(value, "durability") ? { durability: parseDurabilityModel(value.durability) } : {}) });
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function capabilityFingerprint(model) { return JSON.stringify(canonical(model)); }
export function assertSameCapabilities(before, after) {
  if (capabilityFingerprint(before) !== capabilityFingerprint(after)) throw capabilityError("RPC_CAPABILITIES_CHANGED", "The network's amount units or transaction capabilities changed. Refresh and review again.");
}
export function assertCompatibleIntentCapabilities(before, after) {
  const { durability: _before, ...original } = before, { durability: _after, ...current } = after;
  assertSameCapabilities(original, current);
  parseDurabilityModel(after.durability);
}
export function requireTransactionCapabilities(model) {
  if (model?.enabled !== true || model.unit !== "wei") throw capabilityError("RPC_TRANSFERS_DISABLED", "This network currently uses legacy whole-unit balances. Ethereum transaction submission is not enabled.");
  if (model.fullEVM !== true) parseDurabilityModel(model.durability);
}
export function validateTransactionCapabilities(transaction, model) {
  requireTransactionCapabilities(model);
  // The generic Ethereum serializer remains separate. It is reachable only
  // through a capability provider that explicitly describes that future network.
  if (model.fullEVM === true) return;
  if (model.version !== "ynx-ethereum-native-v1") throw capabilityError("RPC_CAPABILITIES_UNKNOWN", "Unsupported network capability version.");
  if (transaction.type !== 0 || transaction.accessList !== undefined || transaction.maxFeePerGas !== undefined || transaction.maxPriorityFeePerGas !== undefined) throw capabilityError("RPC_TRANSACTION_UNSUPPORTED", "This network currently supports legacy type-0 transfers only; access lists and EIP-1559 are unavailable.");
  if (!transaction.to || transaction.data !== "0x") throw capabilityError("RPC_TRANSACTION_UNSUPPORTED", "This network currently supports plain transfers only. Contract calls and deployments are unavailable.");
  if (transaction.to === transaction.from) throw capabilityError("RPC_TRANSACTION_UNSUPPORTED", "This native transfer adapter cannot send an account's funds to itself.");
  const value = BigInt(transaction.value), quantum = BigInt(model.amountQuantumWei);
  if (value <= 0n || value % quantum !== 0n || value / quantum > 9223372036854775807n) throw capabilityError("RPC_AMOUNT_UNSUPPORTED", "This network currently accepts positive whole YNXT amounts within its native ledger range. Fractional transfers are unavailable.");
  if (transaction.gasPrice !== undefined && transaction.gasPrice !== model.gasPrice) throw capabilityError("RPC_FIXED_FEE_MISMATCH", "The gas price differs from the network's fixed native-transfer quote.");
  if (transaction.gasLimit !== undefined && (BigInt(transaction.gasLimit) < BigInt(model.gas) || BigInt(transaction.gasLimit) > BigInt(model.maxGasLimit))) throw capabilityError("RPC_TRANSACTION_UNSUPPORTED", "The native-transfer gas budget must be between 25,000 and 30,000,000.");
}
export function feeReview(model, transaction) {
  const maximum = BigInt(transaction.gasLimit) * BigInt(transaction.gasPrice ?? transaction.maxFeePerGas);
  return Object.freeze({ modelVersion: model.version, fullEVM: model.fullEVM, actualFee: model.fullEVM ? null : formatEther(model.feeWei), maximumFee: formatEther(maximum), feeExplanation: model.fullEVM ? "The maximum fee is a budget; the receipt determines the actual fee." : "The native transfer fee is 1 YNXT. The larger maximum budget reserves headroom and must be covered by your balance; it is not the actual fee." });
}
