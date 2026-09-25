export const DURABILITY_MODEL = Object.freeze({ version: "ynx-local-durability-v1", scope: "local-snapshot", receiptField: "ynxDurability", transactionStatusMethod: "ynx_getTransactionDurability", nativeTransactionField: "ynxNativeTransaction", minedStatus: "durable", pendingStatus: "pending_durable", consensusFinality: false });
export const UINT64_MAX = (1n << 64n) - 1n;
const INT64_MIN = -(1n << 63n), INT64_MAX = (1n << 63n) - 1n;
const HASH = /^0x[0-9a-f]{64}$/, ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export function durabilityError(code = "RPC_RECEIPT_INVALID") { return Object.assign(new Error(code === "RPC_DURABILITY_UNSUPPORTED" ? "This network has not exposed the supported local durability contract. Transactions remain unconfirmed." : "The transaction proof does not match the signed intent and a completed local checkpoint."), { code: 4900, data: { code } }); }
function invalid() { throw durabilityError(); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function exact(value, keys) {
  if (!object(value) || Reflect.ownKeys(value).length !== keys.length || Reflect.ownKeys(value).some(key => !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) invalid();
}
export function uint64(value, { positive = false } = {}) {
  if (typeof value !== "string" || value.length > 18 || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) invalid();
  const number = BigInt(value); if (number > UINT64_MAX || positive && number === 0n) invalid(); return number;
}
function int64(value) {
  if (typeof value !== "string" || value.length > 20 || !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(value)) invalid();
  const number = BigInt(value); if (number < INT64_MIN || number > INT64_MAX) invalid(); return number;
}
function hash(value) { if (typeof value !== "string" || !HASH.test(value)) invalid(); return value; }
export function parseDurabilityModel(value) {
  try { exact(value, Object.keys(DURABILITY_MODEL)); if (Object.entries(DURABILITY_MODEL).some(([key, expected]) => value[key] !== expected)) invalid(); }
  catch { throw durabilityError("RPC_DURABILITY_UNSUPPORTED"); }
  return DURABILITY_MODEL;
}
export function parseDurabilityProof(value, expectedHash) {
  if (!object(value)) invalid();
  const base = ["version", "scope", "status", "transactionHash"], observed = ["blockNumber", "blockHash"], checkpoint = ["checkpointBlockNumber", "checkpointBlockHash", "snapshotIntegrity"];
  let keys;
  if (value.status === "durable") keys = [...base, ...observed, ...checkpoint];
  else if (value.status === "pending_durable") keys = [...base, ...checkpoint];
  else if (["uncertain", "memory_only"].includes(value.status)) keys = [...base, ...(Object.hasOwn(value, "blockNumber") || Object.hasOwn(value, "blockHash") ? observed : [])];
  else if (value.status === "not_found") keys = base;
  else invalid();
  exact(value, keys);
  if (value.version !== DURABILITY_MODEL.version || value.scope !== DURABILITY_MODEL.scope || hash(value.transactionHash) !== hash(expectedHash)) invalid();
  if (keys.includes("blockNumber")) { uint64(value.blockNumber, { positive: true }); hash(value.blockHash); }
  if (keys.includes("checkpointBlockNumber")) { uint64(value.checkpointBlockNumber); hash(value.checkpointBlockHash); hash(value.snapshotIntegrity); }
  if (value.status === "durable") {
    const mined = uint64(value.blockNumber), checkpointHeight = uint64(value.checkpointBlockNumber);
    if (checkpointHeight < mined || (checkpointHeight === mined) !== (value.checkpointBlockHash === value.blockHash)) invalid();
  }
  return Object.freeze(Object.fromEntries(keys.map(key => [key, value[key]])));
}
export function parseNativeTransaction(value, expectedIdentity) {
  const fields = ["type", "amountYNXT", "feeYNXT", "nonce"];
  const extended = object(value) && ["from", "to", "identityProjection"].some(key => Object.hasOwn(value, key));
  exact(value, extended ? [...fields, "from", "to", "identityProjection"] : fields);
  if (extended) {
    const identity = { version: "ynx-native-identity-projection-v1", fromSystemIdentity: false, toSystemIdentity: false, systemAddressDomain: "YNX_NATIVE_IDENTITY_PROJECTION_V1", systemAddressScheme: "last-20-bytes-sha256-nul-domain-exact-native-identity", systemAddressesAreDisplayOnly: true };
    exact(value.identityProjection, Object.keys(identity));
    if (!expectedIdentity || value.from !== expectedIdentity.from || value.to !== expectedIdentity.to || Object.entries(identity).some(([key, expected]) => value.identityProjection[key] !== expected)) invalid();
  }
  if (typeof value.type !== "string" || value.type.length < 1 || value.type.length > 128) invalid();
  int64(value.amountYNXT); int64(value.feeYNXT); uint64(value.nonce);
  return Object.freeze({ type: value.type, amountYNXT: value.amountYNXT, feeYNXT: value.feeYNXT, nonce: value.nonce });
}
/** Exact native-transfer and immutable checkpoint bindings; no BFT/finality claim. */
export function validateDurableReceipt(intent, receipt, capabilities) {
  parseDurabilityModel(capabilities?.durability);
  if (!object(receipt) || !intent || receipt.transactionHash !== intent.hash || typeof receipt.from !== "string" || !ADDRESS.test(receipt.from) || receipt.from.toLowerCase() !== intent.account || typeof receipt.to !== "string" || !ADDRESS.test(receipt.to) || receipt.to.toLowerCase() !== intent.to || receipt.contractAddress !== null || receipt.status !== "0x1" || receipt.type !== "0x0") invalid();
  const proof = parseDurabilityProof(receipt.ynxDurability, intent.hash), native = parseNativeTransaction(receipt.ynxNativeTransaction, { from: receipt.from, to: receipt.to });
  if (proof.status !== "durable" || receipt.blockNumber !== proof.blockNumber || receipt.blockHash !== proof.blockHash) invalid();
  uint64(receipt.gasUsed); uint64(receipt.effectiveGasPrice); uint64(receipt.ynxFeeWei);
  if (receipt.gasUsed !== capabilities.gas || receipt.effectiveGasPrice !== capabilities.gasPrice || receipt.ynxFeeWei !== capabilities.feeWei || BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) !== BigInt(capabilities.feeWei)) invalid();
  const nonce = uint64(intent.nonce), quantum = 1_000_000_000_000_000_000n;
  if (typeof intent.value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(intent.value) || intent.value.length > 128) invalid();
  const amount = BigInt(intent.value);
  if (amount <= 0n || amount % quantum !== 0n || amount / quantum > INT64_MAX || native.type !== "transfer" || native.amountYNXT !== (amount / quantum).toString() || native.feeYNXT !== "1" || nonce === UINT64_MAX || uint64(native.nonce) !== nonce + 1n) invalid();
  return Object.freeze({ transactionHash: receipt.transactionHash, from: receipt.from.toLowerCase(), to: receipt.to.toLowerCase(), contractAddress: null, status: receipt.status, type: "0x0", blockNumber: proof.blockNumber, blockHash: proof.blockHash, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice, ynxFeeWei: receipt.ynxFeeWei, ynxDurability: proof, ynxNativeTransaction: native });
}
export function parseDurabilityErrorData(error) {
  const data = error?.data;
  const status = error?.code === -32002 && data?.status === "transaction_durability_uncertain" ? "uncertain" : error?.code === -32004 && data?.status === "transaction_durability_unavailable" ? "memory_only" : null;
  if (!status || data.durabilityVersion !== DURABILITY_MODEL.version) return null;
  try { const proof = parseDurabilityProof(data.ynxDurability, data.transactionHash); if (proof.status !== status) invalid(); return Object.freeze({ durabilityVersion: DURABILITY_MODEL.version, ynxDurability: proof }); }
  catch { return null; }
}
