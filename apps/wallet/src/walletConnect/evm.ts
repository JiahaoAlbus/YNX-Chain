import { Transaction, TypedDataEncoder, Wallet, formatEther, getAddress, getBytes, toQuantity } from "ethers";
import type { SecureStorageAdapter } from "../storage/walletRepository";

export const EVM_CHAIN_ID = 6423;
export const EVM_CHAIN_HEX = "0x1917";
export const EVM_RPC = "https://rpc-testnet.ynxweb4.com";
const JOURNAL_PREFIX = "ynx.wallet.walletconnect.broadcast.v1.";
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

export type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type PreparedEvmRequest = Readonly<{ method: "personal_sign" | "eth_signTypedData_v4" | "eth_sendTransaction"; account: string; params: readonly unknown[]; review: Readonly<Record<string, unknown>> }>;
export type SignedEvmTransaction = Readonly<{ rawTransaction: string; transactionHash: string }>;
export type BroadcastRecord = Readonly<{ version: 2; account: string; rawTransaction: string; transactionHash: string; status: "broadcasting" | "acknowledged" | "uncertain" | "confirmed" | "rejected" | "cancelled"; attempt: number; unknownHistory: boolean; createdAt: string }>;
const DURABILITY_MODEL = Object.freeze({version:"ynx-local-durability-v1",scope:"local-snapshot",receiptField:"ynxDurability",transactionStatusMethod:"ynx_getTransactionDurability",nativeTransactionField:"ynxNativeTransaction",minedStatus:"durable",pendingStatus:"pending_durable",consensusFinality:false});

export async function ynxEvmRpc(method: string, params: readonly unknown[], fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!Array.isArray(params) || JSON.stringify(params).length > 65_536) fail("INVALID_RPC_PARAMS", "RPC parameters are invalid.");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000); const id = 6423;
  try {
    const response = await fetcher(EVM_RPC, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: controller.signal, redirect: "error" });
    const text = await response.text(); if (text.length > 2_097_152) fail("INVALID_RPC_RESPONSE", "RPC response exceeded Wallet policy.");
    let body: any; try { body = JSON.parse(text); } catch { fail("INVALID_RPC_RESPONSE", "RPC returned invalid JSON."); }
    if (!body || body.jsonrpc !== "2.0" || body.id !== id || Object.hasOwn(body, "error") === Object.hasOwn(body, "result")) fail("INVALID_RPC_RESPONSE", "RPC returned an invalid envelope.");
    if (body.error) { const error = body.error; if (!Number.isInteger(error.code) || typeof error.message !== "string") fail("INVALID_RPC_RESPONSE", "RPC returned an invalid error."); throw Object.assign(new Error(error.message.slice(0, 240)), { code: error.code, rpcResponseValidated: response.ok }); }
    if (!response.ok) fail("RPC_UNAVAILABLE", `RPC failed closed (${response.status}).`); return body.result;
  } catch (error: any) { if (error?.code !== undefined) throw error; fail("RPC_UNAVAILABLE", "YNX Testnet RPC is unavailable."); }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function prepareEvmRequest(expectedAccount: string, method: string, rawParams: unknown, rpc: Rpc = ynxEvmRpc): Promise<PreparedEvmRequest> {
  const account = address(expectedAccount); const params = Array.isArray(rawParams) ? rawParams : [];
  if (method === "personal_sign") {
    if (params.length !== 2 || address(params[1]) !== account || typeof params[0] !== "string" || !HEX.test(params[0]) || params[0].length > 8194) fail("INVALID_SENSITIVE_PARAMS", "Message parameters are invalid.");
    const bytes = getBytes(params[0] as string); let text: string; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { text = "Invalid UTF-8; review the exact hex bytes."; }
    return frozen({ method, account, params: [params[0], account], review: { account, messageHex: params[0], messageBytes: bytes.length, messageText: escapeInvisible(text), warning: "This signature may authorize external actions." } });
  }
  if (method === "eth_signTypedData_v4") {
    if (params.length !== 2 || address(params[0]) !== account || typeof params[1] !== "string" || params[1].length > 65_536) fail("INVALID_TYPED_DATA", "Typed data parameters are invalid.");
    let typed: any; try { typed = JSON.parse(params[1] as string); const types = { ...typed.types }; delete types.EIP712Domain; if (BigInt(typed.domain.chainId) !== 6423n || TypedDataEncoder.from(types).primaryType !== typed.primaryType) throw new Error(); TypedDataEncoder.hash(typed.domain, types, typed.message); } catch { fail("INVALID_TYPED_DATA", "Typed data cannot be signed exactly as displayed for YNX Testnet."); }
    return frozen({ method, account, params: [account, JSON.stringify(typed)], review: { account, domain: typed.domain, primaryType: typed.primaryType, message: typed.message, types: typed.types, warning: "Typed data can authorize transfers or spending. Review every field." } });
  }
  if (method === "eth_sendTransaction") {
    if (params.length !== 1 || !plain(params[0])) fail("INVALID_TRANSACTION", "Transaction parameters are invalid.");
    const input: any = params[0]; const allowed = new Set(["from", "to", "value", "data", "chainId", "nonce", "gas", "gasLimit", "gasPrice", "type"]); if (Object.keys(input).some(key => !allowed.has(key))) fail("INVALID_TRANSACTION", "Transaction contains unsupported fields.");
    if (input.gas !== undefined && input.gasLimit !== undefined) fail("INVALID_TRANSACTION", "Specify gas or gasLimit, never both.");
    if (input.type !== undefined && ![0, "0", "0x0"].includes(input.type)) fail("INVALID_TRANSACTION", "Only exact legacy type-0 transactions are supported.");
    const from = address(input.from), to = address(input.to); if (from !== account || input.chainId !== undefined && ![6423, "6423", EVM_CHAIN_HEX].includes(input.chainId)) fail("WRONG_NETWORK", "Transaction account or chain changed.");
    const data = input.data ?? "0x"; if (data !== "0x") fail("UNSUPPORTED_CONTRACT_CALL", "Contract calls are unavailable until the chain exposes a verified full-EVM fee capability.");
    const value = quantity(input.value ?? "0x0", "value"); if (BigInt(value) <= 0n || BigInt(value) % 10n ** 18n !== 0n) fail("INVALID_TRANSACTION", "YNX native transfers require a positive whole-YNXT value.");
    if (await rpc("eth_chainId", []) !== EVM_CHAIN_HEX) fail("WRONG_NETWORK", "RPC did not prove YNX Testnet chain 6423.");
    const nonce = quantity(await rpc("eth_getTransactionCount", [from, "pending"]), "nonce"); if (input.nonce !== undefined && quantity(input.nonce, "nonce") !== nonce) fail("TRANSACTION_NONCE_CHANGED", "Pending nonce changed.");
    const gasPrice = quantity(await rpc("eth_gasPrice", []), "gas price"); if (gasPrice !== "0x246139ca8000" || input.gasPrice !== undefined && quantity(input.gasPrice, "gas price") !== gasPrice) fail("INVALID_TRANSACTION_FEE", "Gas price must match the proven fixed YNX fee model.");
    const gasLimit = quantity(input.gasLimit ?? input.gas ?? "0x61a8", "gas limit"); const estimate = quantity(await rpc("eth_estimateGas", [{ from, to, value, data, gas: gasLimit, gasPrice, type: "0x0" }]), "gas estimate"); if (estimate !== "0x61a8" || BigInt(gasLimit) < 25000n) fail("INVALID_TRANSACTION_GAS", "Gas estimate no longer matches the fixed YNX fee model.");
    const balance = BigInt(quantity(await rpc("eth_getBalance", [from, "pending"]), "balance")); const maximumFee = BigInt(gasLimit) * BigInt(gasPrice); if (balance < BigInt(value) + maximumFee) fail("INSUFFICIENT_FUNDS", "Insufficient YNXT for amount and maximum fee.");
    const transaction = frozen({ to, value, data, chainId: EVM_CHAIN_ID, nonce: Number(BigInt(nonce)), gasLimit, gasPrice, type: 0 }); Transaction.from(transaction).unsignedSerialized;
    return frozen({ method, account, params: [transaction], review: { account, from, to, amount: formatEther(value), maximumFee: formatEther(maximumFee), total: formatEther(BigInt(value) + maximumFee), nonce, gasLimit, gasPrice, chainId: EVM_CHAIN_HEX, symbol: "YNXT", warning: "Review the exact recipient, amount, nonce, and maximum network fee." } });
  }
  fail(4200, "Unsupported WalletConnect method.");
}

export async function signPreparedEvmRequest(secretHex: string, prepared: PreparedEvmRequest, assertAuthorized: () => void): Promise<string | SignedEvmTransaction> {
  assertAuthorized(); const wallet = new Wallet(`0x${secretHex}`); if (wallet.address.toLowerCase() !== prepared.account) fail("SIGNER_ACCOUNT_MISMATCH", "Protected key does not match the reviewed account."); let result: string | SignedEvmTransaction;
  if (prepared.method === "personal_sign") result = await wallet.signMessage(getBytes(prepared.params[0] as string));
  else if (prepared.method === "eth_signTypedData_v4") { const typed = JSON.parse(prepared.params[1] as string), types = { ...typed.types }; delete types.EIP712Domain; result = await wallet.signTypedData(typed.domain, types, typed.message); }
  else { const tx: any = prepared.params[0], rawTransaction = await wallet.signTransaction(tx), parsed = Transaction.from(rawTransaction); if (parsed.from?.toLowerCase() !== prepared.account || parsed.unsignedSerialized !== Transaction.from(tx).unsignedSerialized) fail("SIGNED_TRANSACTION_MISMATCH", "Signature changed the reviewed transaction."); result = frozen({ rawTransaction, transactionHash: parsed.hash!.toLowerCase() }); }
  assertAuthorized(); return result;
}

export class WalletConnectBroadcastJournal {
  constructor(private readonly storage: SecureStorageAdapter) {}
  async read(account: string): Promise<BroadcastRecord | null> { const value = await this.storage.getItem(JOURNAL_PREFIX + address(account)); if (!value) return null; return parseRecord(JSON.parse(value), address(account)); }
  async broadcast(account: string, signed: SignedEvmTransaction, rpc: Rpc = ynxEvmRpc): Promise<string> {
    const normalized = address(account); if (await this.read(normalized)) fail("TRANSACTION_PENDING", "A prior WalletConnect transaction requires status resolution.");
    await requireDurability(rpc);
    const record: BroadcastRecord = frozen({ version: 2, account: normalized, rawTransaction: signed.rawTransaction, transactionHash: signed.transactionHash, status: "broadcasting", attempt: 1, unknownHistory: false, createdAt: new Date().toISOString() }); await this.#write(record); return this.#dispatch(record, rpc);
  }
  async retryOriginal(account: string, rpc: Rpc = ynxEvmRpc): Promise<string> { const record = await this.read(account); if (!record || !["broadcasting","acknowledged","uncertain"].includes(record.status)) fail("TRANSACTION_NOT_PENDING", "No original signed transaction is pending."); await requireDurability(rpc); const next = frozen({ ...record, status: "broadcasting" as const, attempt: record.attempt + 1, unknownHistory: true }); await this.#write(next); return this.#dispatch(next, rpc); }
  async refresh(account: string, rpc: Rpc = ynxEvmRpc): Promise<BroadcastRecord | null> { const record = await this.read(account); if (!record || ["confirmed","rejected","cancelled"].includes(record.status)) return record; const model = await requireDurability(rpc); const state: any = await rpc("ynx_getTransactionDurability", [record.transactionHash]); if (!state || state.version !== DURABILITY_MODEL.version || state.scope !== DURABILITY_MODEL.scope || state.transactionHash !== record.transactionHash) fail("DURABILITY_UNCONFIRMED", "Durability status does not match the original transaction."); if (state.status === "not_found" || state.status === "uncertain" || state.status === "memory_only" || state.status === "pending_durable") return record; if (state.status !== "durable") fail("DURABILITY_UNCONFIRMED", "Unknown durability status."); const receipt = await rpc("eth_getTransactionReceipt", [record.transactionHash]); verifyDurableReceipt(receipt, Transaction.from(record.rawTransaction), record.transactionHash, model); const confirmed = frozen({ ...record, status: "confirmed" as const, unknownHistory: true }); await this.#write(confirmed); return confirmed; }
  async acknowledgeTerminal(account: string): Promise<void> { const record = await this.read(account); if (!record || !["confirmed","rejected","cancelled"].includes(record.status)) fail("TRANSACTION_PENDING", "Original transaction remains unresolved."); await this.storage.deleteItem(JOURNAL_PREFIX + record.account); }
  async #dispatch(record: BroadcastRecord, rpc: Rpc): Promise<string> { try { const hash = await rpc("eth_sendRawTransaction", [record.rawTransaction]); if (typeof hash !== "string" || hash.toLowerCase() !== record.transactionHash) fail("TRANSACTION_HASH_MISMATCH", "RPC acknowledged a different transaction hash."); await this.#write({ ...record, status: "acknowledged", unknownHistory: true }); return record.transactionHash; } catch (error: any) { if (!record.unknownHistory && record.attempt === 1 && error?.code === -32003 && error?.rpcResponseValidated === true) { await this.#write({ ...record, status: "rejected" }); throw error; } await this.#write({ ...record, status: "uncertain", unknownHistory: true }); throw Object.assign(new Error("Broadcast outcome is uncertain. The original signed transaction is saved; check or resend only these bytes."), { code: "BROADCAST_UNKNOWN", cause: error }); } }
  async #write(record: BroadcastRecord): Promise<void> { await this.storage.setItem(JOURNAL_PREFIX + record.account, JSON.stringify(record)); const read = await this.read(record.account); if (!read || JSON.stringify(read) !== JSON.stringify(record)) fail("BROADCAST_RECORD_UNAVAILABLE", "Signed transaction recovery storage could not be verified."); }
}

function parseRecord(value: any, account: string): BroadcastRecord { try { const tx = Transaction.from(value.rawTransaction); if (value.version !== 2 || value.account !== account || tx.from?.toLowerCase() !== account || tx.hash?.toLowerCase() !== value.transactionHash || tx.chainId !== 6423n || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || typeof value.unknownHistory !== "boolean" || !["broadcasting", "acknowledged", "uncertain", "confirmed", "rejected", "cancelled"].includes(value.status) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error(); return frozen(value); } catch { fail("BROADCAST_RECORD_INVALID", "Stored WalletConnect transaction is invalid; sending remains disabled."); } }
async function requireDurability(rpc: Rpc): Promise<typeof DURABILITY_MODEL> { if (await rpc("eth_chainId", []) !== EVM_CHAIN_HEX) fail("WRONG_NETWORK", "RPC did not prove YNX Testnet chain 6423."); const value: any = await rpc("ynx_getDurabilityModel", []); if (!plain(value) || Object.keys(value).length !== Object.keys(DURABILITY_MODEL).length || Object.entries(DURABILITY_MODEL).some(([key, expected]) => value[key] !== expected)) fail("DURABILITY_UNCONFIRMED", "RPC did not prove the required local durability model."); return DURABILITY_MODEL; }
function verifyDurableReceipt(value: any, tx: Transaction, hash: string, model: typeof DURABILITY_MODEL): void { if (model !== DURABILITY_MODEL || !plain(value)) fail("DURABILITY_UNCONFIRMED", "Receipt identity differs from the original transaction."); const receipt=value as any;if (receipt.transactionHash !== hash || receipt.status !== "0x1" || receipt.from?.toLowerCase() !== tx.from?.toLowerCase() || receipt.to?.toLowerCase() !== tx.to?.toLowerCase() || receipt.contractAddress !== null || receipt.type !== "0x0") fail("DURABILITY_UNCONFIRMED", "Receipt identity differs from the original transaction."); const proof:any = receipt.ynxDurability; if (!plain(proof) || proof.version !== model.version || proof.scope !== model.scope || proof.status !== "durable" || proof.transactionHash !== hash || proof.blockNumber !== receipt.blockNumber || proof.blockHash !== receipt.blockHash) fail("DURABILITY_UNCONFIRMED", "Receipt lacks an exact durable checkpoint."); const native:any = receipt.ynxNativeTransaction; if (!plain(native) || native.type !== "transfer" || typeof native.amountYNXT!=="string" || typeof native.nonce!=="string" || BigInt(native.amountYNXT) !== tx.value / 10n ** 18n || native.feeYNXT !== "1" || BigInt(native.nonce) !== BigInt(tx.nonce) + 1n || receipt.gasUsed !== "0x61a8" || receipt.effectiveGasPrice !== "0x246139ca8000" || receipt.ynxFeeWei !== "0xde0b6b3a7640000") fail("DURABILITY_UNCONFIRMED", "Durable native receipt does not match amount, nonce, or fee."); }
function address(value: unknown): string { try { return getAddress(String(value)).toLowerCase(); } catch { fail("INVALID_SIGNER_ACCOUNT", "EVM account is invalid."); } }
function quantity(value: unknown, label: string): string { if (typeof value !== "string" || !QUANTITY.test(value)) fail("INVALID_TRANSACTION_FIELDS", `${label} must be a canonical hex quantity.`); return toQuantity(BigInt(value)); }
function escapeInvisible(value: string): string { return value.replace(/[\u00ad\u034f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function frozen<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value as any)) frozen(child); Object.freeze(value); } return value; }
function fail(code: string | number, message: string): never { throw Object.assign(new Error(message), { code }); }
