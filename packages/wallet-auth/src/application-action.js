import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentityFromPublicKey } from "./crypto.js";

// Wire authority: Core 28d30b4b9ac983811f1e6a87f7620ec3bf3f8316,
// internal/consensus/{action_transaction,dex_action}.go. These four actions
// require that newer Core capability; this module does not discover a backend.
export const APPLICATION_ACTION_DOMAIN = "YNX_APPLICATION_ACTION_V1";
export const APPLICATION_ACTION_CHAIN_ID = 6423;
export const APPLICATION_ACTION_FEE_YNXT = 1;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const UNSIGNED_FIELDS = ["version", "chainId", "type", "signer", "nonce", "action", "payload", "payloadHash", "fee", "aiUnits", "payUnits", "publicKey"];
const SIGNED_FIELDS = [...UNSIGNED_FIELDS, "signature"];
const PAYLOAD_FIELDS = Object.freeze({
  dex_swap_exact_input: ["poolId", "assetIn", "amountIn", "minAmountOut", "deadlineUnix"],
  dex_swap_exact_output: ["poolId", "assetOut", "amountOut", "maxAmountIn", "deadlineUnix"],
  dex_liquidity_add: ["poolId", "amount0", "amount1", "minShares", "deadlineUnix"],
  dex_liquidity_remove: ["poolId", "shares", "minAmount0", "minAmount1", "deadlineUnix"],
});

/**
 * Sign a native DEX application action, after the caller has approved the exact
 * action, business payload and nonce for the selected account. Product Session
 * authentication or an HTTP body proof is not that approval.
 *
 * input.payload and result.transaction.payload are business objects. In the
 * native-transfer convention, result.payload is the full canonical JSON wire
 * envelope; result.hash identifies those exact envelope bytes, not a receipt.
 * Numeric inputs deliberately support only the lossless JS safe-integer subset
 * of Core int64/uint64. No rounding, units conversion or identifier normalization
 * is performed. Chain 6423 and the 1 YNXT envelope fee are fixed.
 */
export function createSignedApplicationAction(input) {
  const fields = dataFields(input, ["accountSecret", "action", "payload", "nonce"], "Application action input");
  const action = actionName(fields.action);
  const payload = businessPayload(action, fields.payload);
  const nonce = safeInteger(fields.nonce, "nonce", 1);
  const secret = secretBytes(fields.accountSecret);
  try {
    const publicKey = bytesToHex(secp256k1.getPublicKey(secret, true));
    const unsigned = unsignedAction({
      version: 1, chainId: APPLICATION_ACTION_CHAIN_ID, type: "application_action",
      signer: evmAddressFromYNX(walletIdentityFromPublicKey(publicKey)), nonce,
      action, payload, payloadHash: hashHex(JSON.stringify(payload)),
      fee: APPLICATION_ACTION_FEE_YNXT, aiUnits: 0, payUnits: 0, publicKey,
    });
    const digest = sha256(utf8ToBytes(signJSON(unsigned)));
    const signature = bytesToHex(secp256k1.sign(digest, secret, { prehash: false, format: "der", lowS: true }));
    const transaction = parseSignedApplicationAction({ ...unsigned, signature });
    const encoded = JSON.stringify(transaction);
    return Object.freeze({ transaction, payload: encoded, hash: `0x${hashHex(encoded)}` });
  } finally {
    secret.fill(0);
  }
}

/** Parse canonical wire JSON (or a data object), verify its signature and freeze
 * a detached snapshot. This does not check chain state or a current deadline:
 * historical receipts must remain parsable. Execution freshness and replay
 * protection belong to the approving caller and Core's nonce/state checks.
 */
export function parseSignedApplicationAction(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) {
    boundedJSON(raw, MAX_ENVELOPE_BYTES, "Application action envelope");
    try { value = JSON.parse(raw); }
    catch { throw invalid("Application action JSON is invalid"); }
  }
  const fields = dataFields(value, SIGNED_FIELDS, "Signed application action");
  const unsigned = unsignedAction(fields);
  const signature = exactString(fields.signature, "signature", /^30(?:[0-9a-f]{2}){7,71}$/);
  const transaction = Object.freeze({ ...unsigned, signature });
  const canonical = JSON.stringify(transaction);
  boundedJSON(canonical, MAX_ENVELOPE_BYTES, "Application action envelope");
  if (raw !== null && raw !== canonical) throw invalid("Application action JSON is not canonical");
  let valid = false;
  try {
    valid = evmAddressFromYNX(walletIdentityFromPublicKey(unsigned.publicKey)) === unsigned.signer
      && secp256k1.verify(hexToBytes(signature), sha256(utf8ToBytes(signJSON(unsigned))), hexToBytes(unsigned.publicKey), { prehash: false, format: "der", lowS: true });
  } catch { valid = false; }
  if (!valid) throw new WalletAuthError("INVALID_APPLICATION_ACTION_SIGNATURE", "Application action signature or signer is invalid");
  return transaction;
}

/** Verify the signature AND the exact reviewed request. account is a canonical
 * ynx1 address; all four expectation fields are required. This proves binding,
 * not that a platform displayed an approval, nor that Core accepted the action.
 */
export function verifySignedApplicationAction(input, expected) {
  const context = dataFields(expected, ["account", "action", "payload", "nonce"], "Application action binding");
  const account = evmAddressFromYNX(context.account);
  const action = actionName(context.action);
  const payload = businessPayload(action, context.payload);
  const nonce = safeInteger(context.nonce, "nonce", 1);
  const transaction = parseSignedApplicationAction(input);
  if (transaction.signer !== account || transaction.action !== action || transaction.nonce !== nonce
    || JSON.stringify(transaction.payload) !== JSON.stringify(payload)) {
    throw new WalletAuthError("BINDING_MISMATCH", "Application action does not match the exact reviewed account, action, payload and nonce");
  }
  return transaction;
}

/** Ordered Go sign-document JSON, including the domain and excluding signature.
 * Accepts a complete unsigned or signed envelope; does not verify a signature.
 */
export function applicationActionSignJSON(transaction) {
  const signed = transaction !== null && typeof transaction === "object" && Object.hasOwn(transaction, "signature");
  return signJSON(unsignedAction(dataFields(transaction, signed ? SIGNED_FIELDS : UNSIGNED_FIELDS, "Application action sign document")));
}

/** SHA-256 of the typed business JSON, lowercase hex without 0x. */
export function applicationActionPayloadHash(action, payload) {
  return hashHex(JSON.stringify(businessPayload(actionName(action), payload)));
}

/** Core ApplicationActionHash: SHA-256 of the canonical signed envelope, with 0x. */
export function applicationActionHash(input) {
  return `0x${hashHex(JSON.stringify(parseSignedApplicationAction(input)))}`;
}

function unsignedAction(value) {
  const action = actionName(value.action);
  const payload = businessPayload(action, value.payload);
  const payloadHash = exactString(value.payloadHash, "payloadHash", /^[0-9a-f]{64}$/);
  if (payloadHash !== hashHex(JSON.stringify(payload))) throw invalid("Application action payload hash mismatch");
  // Field order and the omitted zero trustUnits are part of the Core wire format.
  return {
    version: exactNumber(value.version, "version", 1),
    chainId: exactNumber(value.chainId, "chainId", APPLICATION_ACTION_CHAIN_ID),
    type: exactString(value.type, "type", /^application_action$/),
    signer: exactString(value.signer, "signer", /^0x[0-9a-f]{40}$/),
    nonce: safeInteger(value.nonce, "nonce", 1), action, payload, payloadHash,
    fee: exactNumber(value.fee, "fee", APPLICATION_ACTION_FEE_YNXT),
    aiUnits: exactNumber(value.aiUnits, "aiUnits", 0),
    payUnits: exactNumber(value.payUnits, "payUnits", 0),
    publicKey: exactString(value.publicKey, "publicKey", /^(02|03)[0-9a-f]{64}$/),
  };
}

function signJSON(unsigned) {
  return JSON.stringify({ domain: APPLICATION_ACTION_DOMAIN, ...unsigned });
}

function businessPayload(action, input) {
  const fields = dataFields(input, PAYLOAD_FIELDS[action], "DEX business payload");
  const result = {};
  for (const key of PAYLOAD_FIELDS[action]) {
    const value = fields[key];
    if (key === "poolId") result[key] = exactString(value, key, /^dex_[a-z0-9][a-z0-9_-]{2,59}$/);
    else if (key === "assetIn" || key === "assetOut") {
      result[key] = exactString(value, key, /^(?:YNXT|[a-z][a-z0-9-]{2,31})$/);
      if (value === "ynxt") throw invalid(`${key} must use the canonical native asset ID YNXT`);
    } else result[key] = safeInteger(value, key, key === "minAmount0" || key === "minAmount1" ? 0 : 1);
  }
  boundedJSON(JSON.stringify(result), MAX_PAYLOAD_BYTES, "DEX business payload");
  return Object.freeze(result);
}

function actionName(value) {
  if (typeof value !== "string" || !Object.hasOwn(PAYLOAD_FIELDS, value)) throw invalid("Unsupported application action; only DEX swap and liquidity actions are enabled");
  return value;
}

function dataFields(value, expected, label) {
  exactFields(value, expected, label);
  // Take one data-only snapshot: accessors, hidden properties and symbols cannot
  // change the reviewed values between validation, hashing and serialization.
  if (Reflect.ownKeys(value).length !== expected.length) throw invalid(`${label} must contain only protocol data fields`);
  const snapshot = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw invalid(`${label} must contain data properties`);
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function secretBytes(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const secret = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(secret)) {
    secret.fill(0);
    throw new WalletAuthError("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  }
  return secret;
}

function safeInteger(value, label, minimum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum) throw invalid(`${label} must be a safe integer greater than or equal to ${minimum}`);
  return value;
}

function exactNumber(value, label, expected) {
  if (!Object.is(value, expected)) throw invalid(`${label} must equal ${expected}`);
  return value;
}

function exactString(value, label, pattern) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) throw invalid(`${label} is invalid`);
  return value;
}

function boundedJSON(value, max, label) {
  if (!value.length || value.length > max || utf8ToBytes(value).length > max) throw invalid(`${label} must be between 1 and ${max} bytes`);
}

function hashHex(value) { return bytesToHex(sha256(utf8ToBytes(value))); }
function invalid(message) { return new WalletAuthError("INVALID_APPLICATION_ACTION", message); }
