import { JsonRpcProvider, Transaction, accessListify, getAddress, toQuantity } from "ethers";
import { CANONICAL_RPC_URL } from "./rpc.mjs";
import { CanonicalAccountNetwork } from "./native-wallet-service.mjs";

export class CanonicalTransactionSender {
  #prepared = new WeakSet();
  constructor({ rpcUrl = CANONICAL_RPC_URL, network, fetchImpl = globalThis.fetch } = {}) {
    if (rpcUrl !== CANONICAL_RPC_URL) throw Object.assign(new Error("Only the frozen canonical RPC is accepted"), { code: "RPC_ENDPOINT_REJECTED" });
    this.provider = new CanonicalJsonRpcProvider(fetchImpl);
    this.network = network ?? new CanonicalAccountNetwork({ fetchImpl });
  }
  async prepare(account, input) {
    try {
      const transaction = normalizeTransaction(account, input);
      await this.network.verifyChain();
      const nonce = rpcQuantity(await this.provider.send("eth_getTransactionCount", [transaction.from, "pending"]), "nonce");
      if (transaction.nonce !== undefined && transaction.nonce !== nonce) fail("TRANSACTION_NONCE_CHANGED", "The requested nonce differs from the account's pending nonce. Request a new review.");
      transaction.nonce = nonce;
      if (BigInt(nonce) > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_TRANSACTION_NONCE", "The transaction nonce exceeds the supported range");
      if (transaction.type === 2) {
        const block = await readFeeField(this.provider, "eth_getBlockByNumber", ["latest", false]);
        const baseFee = BigInt(rpcQuantity(block?.baseFeePerGas, "base fee"));
        transaction.maxPriorityFeePerGas ??= rpcQuantity(await readFeeField(this.provider, "eth_maxPriorityFeePerGas", []), "priority fee");
        transaction.maxFeePerGas ??= toQuantity(baseFee * 2n + BigInt(transaction.maxPriorityFeePerGas));
        if (BigInt(transaction.maxFeePerGas) < baseFee + BigInt(transaction.maxPriorityFeePerGas)) fail("INVALID_TRANSACTION_FEE", "The maximum fee does not cover the current base fee and priority fee");
      } else {
        transaction.gasPrice ??= rpcQuantity(await readFeeField(this.provider, "eth_gasPrice", []), "gas price");
      }
      const estimateInput = { ...transaction };
      delete estimateInput.gasLimit;
      estimateInput.type = toQuantity(transaction.type);
      const estimate = BigInt(rpcQuantity(await readFeeField(this.provider, "eth_estimateGas", [estimateInput]), "gas estimate"));
      if (estimate < 21_000n) fail("INVALID_TRANSACTION_GAS", "The network returned an invalid gas estimate");
      if (transaction.gasLimit !== undefined && BigInt(transaction.gasLimit) < estimate) fail("INVALID_TRANSACTION_GAS", "The requested gas limit is below the network estimate");
      transaction.gasLimit ??= toQuantity((estimate * 120n + 99n) / 100n);
      const balance = BigInt(rpcQuantity(await this.provider.send("eth_getBalance", [transaction.from, "pending"]), "balance"));
      if (balance < BigInt(transaction.value) + BigInt(transaction.gasLimit) * BigInt(transaction.gasPrice ?? transaction.maxFeePerGas)) fail("INSUFFICIENT_FUNDS", "Insufficient YNXT to cover this transaction and its maximum network fee");
      // Validate serialization before showing approval; no key is needed for this check.
      Transaction.from(signingFields(transaction)).unsignedSerialized;
      const snapshot = deepFreeze(transaction);
      this.#prepared.add(snapshot);
      return snapshot;
    } catch (error) { throw normalizeFailure(error, "TRANSACTION_PREPARATION_FAILED", "The network could not prepare a complete transaction for review. Nothing was signed."); }
  }
  async send(wallet, transaction) {
    try {
      if (!transaction || !this.#prepared.has(transaction)) fail("UNREVIEWED_TRANSACTION", "Prepare and review a complete transaction before signing");
      this.#prepared.delete(transaction);
      if (wallet.address?.toLowerCase() !== transaction.from) fail("ACCOUNT_CHANGED", "The selected account changed. Review the transaction again.");
      await this.network.verifyChain();
      const nonce = rpcQuantity(await this.provider.send("eth_getTransactionCount", [transaction.from, "pending"]), "nonce");
      if (nonce !== transaction.nonce) fail("TRANSACTION_NONCE_CHANGED", "The account nonce changed after review. Prepare the transaction again.");
      const fields = signingFields(transaction), expectedUnsigned = Transaction.from(fields).unsignedSerialized;
      // signTransaction never populates network fields; the exact reviewed bytes are broadcast directly.
      const signed = await wallet.signTransaction(fields);
      const decoded = Transaction.from(signed);
      if (decoded.unsignedSerialized !== expectedUnsigned || decoded.from?.toLowerCase() !== transaction.from) fail("TRANSACTION_SNAPSHOT_MISMATCH", "Signed transaction does not match the approved snapshot");
      const hash = await this.provider.send("eth_sendRawTransaction", [signed]);
      if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash) || hash.toLowerCase() !== decoded.hash) fail("TRANSACTION_HASH_MISMATCH", "The network returned a hash that does not match the signed transaction");
      return hash.toLowerCase();
    } catch (error) {
      throw normalizeFailure(error, "TRANSACTION_SUBMISSION_FAILED", "Canonical YNX Testnet transaction submission failed closed");
    }
  }
}

const INPUT_FIELDS = new Set(["from", "to", "value", "data", "chainId", "nonce", "gas", "gasLimit", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "type", "accessList"]);
function normalizeTransaction(account, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) fail("INVALID_TRANSACTION", "The transaction contains unsupported fields");
  let from, to;
  try { from = getAddress(account).toLowerCase(); to = input.to === undefined || input.to === null ? null : getAddress(input.to).toLowerCase(); }
  catch { fail("INVALID_TRANSACTION", "The transaction account or recipient is invalid"); }
  if (input.from?.toLowerCase() !== from || (input.chainId !== undefined && ![6423, "6423", "0x1917"].includes(input.chainId))) fail("INVALID_TRANSACTION", "The transaction account or chain is not the selected YNX Testnet account");
  if (input.gas !== undefined && input.gasLimit !== undefined && input.gas !== input.gasLimit) fail("INVALID_TRANSACTION_GAS", "Conflicting gas and gasLimit values are not allowed");
  const dynamic = input.maxFeePerGas !== undefined || input.maxPriorityFeePerGas !== undefined;
  if (input.type !== undefined && ![0, 1, 2, "0x0", "0x1", "0x2"].includes(input.type)) fail("INVALID_TRANSACTION", "The transaction type must be legacy, access-list, or EIP-1559");
  const type = input.type === undefined ? dynamic ? 2 : input.accessList !== undefined ? 1 : 0 : Number(input.type);
  if (![0, 1, 2].includes(type) || (type !== 2 && dynamic) || (type === 2 && input.gasPrice !== undefined) || (type === 0 && input.accessList !== undefined)) fail("INVALID_TRANSACTION_FEE", "Transaction type, access list and fee fields are inconsistent");
  const value = input.value === undefined ? "0x0" : inputQuantity(input.value, "value");
  const data = input.data ?? "0x";
  if (typeof data !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(data) || (to === null && data === "0x")) fail("INVALID_TRANSACTION", "The transaction data is invalid or contract creation has no bytecode");
  const result = { from, to, value, data: data.toLowerCase(), chainId: "0x1917", type };
  for (const field of ["nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"]) if (input[field] !== undefined) result[field] = inputQuantity(input[field], field);
  if (input.gasLimit !== undefined || input.gas !== undefined) result.gasLimit = inputQuantity(input.gasLimit ?? input.gas, "gas limit");
  if (type !== 0) {
    try { result.accessList = accessListify(input.accessList ?? []); } catch { fail("INVALID_TRANSACTION", "The transaction access list is invalid"); }
  }
  return result;
}
function signingFields(transaction) { const { from: _from, ...fields } = transaction; return { ...fields, nonce: Number(BigInt(fields.nonce)) }; }
function inputQuantity(value, label) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) fail("INVALID_TRANSACTION", `Transaction ${label} must be a canonical hexadecimal quantity`); if (!["value", "nonce", "maxPriorityFeePerGas"].includes(label) && BigInt(value) <= 0n) fail("INVALID_TRANSACTION_FEE", `Transaction ${label} must be positive`); return toQuantity(BigInt(value)); }
function rpcQuantity(value, label) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || (!["nonce", "balance", "base fee", "priority fee"].includes(label) && BigInt(value) === 0n)) fail("RPC_INVALID_TRANSACTION_FIELDS", `The network did not return a valid ${label}`); return toQuantity(BigInt(value)); }
function deepFreeze(value) { for (const child of Object.values(value)) if (child && typeof child === "object") deepFreeze(child); return Object.freeze(value); }
function fail(code, message) { throw Object.assign(new Error(message), { code: 4900, data: { code } }); }
function normalizeFailure(error, code, message) { if (typeof error?.data?.code === "string") return error; return Object.assign(new Error(message), { code: 4900, data: { code, cause: typeof error?.code === "string" ? error.code : "RPC_ERROR" } }); }
async function readFeeField(provider, method, params) {
  try { return await provider.send(method, params); }
  catch (error) {
    if (error?.error?.code === -32601 || error?.info?.error?.code === -32601) fail("RPC_FEE_UNAVAILABLE", "YNX Testnet cannot provide a complete network fee right now. Nothing was signed.");
    throw error;
  }
}

// The canonical gateway accepts individual JSON-RPC requests. Use the host's
// network stack and disable batching so nonce/fee requests are not combined.
export class CanonicalJsonRpcProvider extends JsonRpcProvider {
  constructor(fetchImpl = globalThis.fetch) {
    super(CANONICAL_RPC_URL, { chainId: 6423, name: "ynx-testnet" }, { staticNetwork: true, batchMaxCount: 1 });
    this.fetchImpl = fetchImpl;
  }
  async _send(payload) {
    if (Array.isArray(payload)) throw new Error("Canonical RPC batching is not supported");
    const response = await this.fetchImpl(CANONICAL_RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Canonical RPC is unavailable");
    return [await response.json()];
  }
}
