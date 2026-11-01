import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

export const WALLET_SESSION_CONTROL_PROOF_HEADER = "x-ynx-wallet-control-proof-v2";
export const WALLET_SESSION_CONTROL_AUDIENCE = "https://wallet-auth.ynxweb4.com";
export const WALLET_SESSION_CONTROL_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions", "/v2/product-sessions/wallet/sessions/revoke"]);
export const WALLET_SESSION_CONTROL_INTENT_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions/revoke-all", "/v2/product-sessions/wallet/devices/revoke"]);
export const WALLET_SESSION_CONTROL_REPLAY_PREFIX = "f9c24e16a803b572";
const CLOCK_ANCHOR_PREFIX = "e4ab6187c05d932f";
const CLOCK_ANCHOR_PATTERN = new RegExp(`^${CLOCK_ANCHOR_PREFIX}[0-9a-f]{12}0{36}$`);
const FIELDS = ["version", "chainId", "audience", "account", "accountPublicKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
const INPUT_FIELDS = ["accountSecret", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];

export function createWalletSessionControlProof(input) {
  exactFields(input, INPUT_FIELDS, "Wallet session control proof input");
  const { accountSecret, ...context } = input;
  const identity = walletIdentity(accountSecret);
  const unsigned = parseUnsigned({ version: "2", chainId: "ynx_6423-1", audience: WALLET_SESSION_CONTROL_AUDIENCE, ...identity, ...context });
  const signature = secp256k1.sign(sha256(utf8ToBytes(signBytes(unsigned))), hexToBytes(accountSecret), { prehash: false, format: "compact", lowS: true });
  return Object.freeze({ ...unsigned, signature: bytesToHex(signature) });
}

export function parseWalletSessionControlProof(input) {
  exactFields(input, [...FIELDS, "signature"], "Wallet session control proof");
  const { signature, ...unsigned } = input;
  return Object.freeze({ ...parseUnsigned(unsigned), signature: pattern(signature, "signature", /^[0-9a-f]{128}$/) });
}

export function verifyWalletSessionControlProof(input, expected, at = new Date()) {
  const proof = parseWalletSessionControlProof(input);
  exactFields(expected, ["method", "path", "bodyDigest"], "Wallet session control HTTP context");
  if (proof.method !== expected.method || proof.path !== expected.path || proof.bodyDigest !== expected.bodyDigest) fail("HTTP_BINDING_MISMATCH", "Wallet session control proof does not match this request");
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail("INVALID_TIME", "Wallet session control time is invalid");
  if (proof.issuedAt > at.toISOString()) fail("ISSUED_IN_FUTURE", "Wallet session control proof was issued in the future");
  if (proof.expiresAt <= at.toISOString()) fail("SESSION_EXPIRED", "Wallet session control proof has expired");
  const { signature, ...unsigned } = proof;
  let valid = false;
  try { valid = walletIdentityFromPublicKey(proof.accountPublicKey) === proof.account && secp256k1.verify(hexToBytes(signature), sha256(utf8ToBytes(signBytes(unsigned))), hexToBytes(proof.accountPublicKey), { prehash: false, format: "compact", lowS: true }); } catch { valid = false; }
  if (!valid) fail("INVALID_SIGNATURE", "Wallet session control requires the owning account signature");
  return proof;
}

export function walletSessionControlReplayKey(input) {
  const proof = parseWalletSessionControlProof(input);
  // Keep the old 64-hex snapshot format while making this namespace expire.
  // Matching live nonces ignores the expiry portion, preventing a signer from
  // evading replay rejection by changing only expiresAt.
  const expires = Date.parse(proof.expiresAt).toString(16).padStart(12, "0");
  return `${WALLET_SESSION_CONTROL_REPLAY_PREFIX}${expires}${digestHex("YNX_WALLET_SESSION_CONTROL_NONCE_V2", { account: proof.account, nonce: proof.nonce }).slice(0, 36)}`;
}

export function walletSessionControlReplayExpiry(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value) || !value.startsWith(WALLET_SESSION_CONTROL_REPLAY_PREFIX)) return null;
  const expires = Number.parseInt(value.slice(16, 28), 16);
  return Number.isSafeInteger(expires) && expires >= 0 && Number.isFinite(new Date(expires).getTime()) ? expires : null;
}

// The old gateway retains arbitrary 64-hex replay records, so this permanent
// anchor also survives rollback to a runtime that replaces the entire audit.
export function walletSessionControlClockAnchor(at) {
  const milliseconds = at.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffffffff) fail("INVALID_TIME", "Wallet session control clock cannot be represented");
  return `${CLOCK_ANCHOR_PREFIX}${milliseconds.toString(16).padStart(12, "0")}${"0".repeat(36)}`;
}
export function walletSessionControlClockAnchorTime(value) {
  if (typeof value !== "string" || !CLOCK_ANCHOR_PATTERN.test(value)) return null;
  return Number.parseInt(value.slice(16, 28), 16);
}
export function walletSessionControlClockFloor(snapshot) {
  return snapshot.consumedProofs.reduce((latest, value) => Math.max(latest, walletSessionControlClockAnchorTime(value) ?? 0), snapshot.audit.reduce((latest, event) => Math.max(latest, Date.parse(event.at)), 0));
}

export function encodeWalletSessionControlProofHeader(input) {
  const proof = parseWalletSessionControlProof(input);
  return encodeBase64url(utf8ToBytes(canonicalJSON(proof)));
}

export function decodeWalletSessionControlProofHeader(value) {
  if (typeof value !== "string" || value.length > 16_384) fail("INVALID_PROOF_HEADER", "Wallet session control header is invalid");
  let text, input;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value, "Wallet session control proof header")); input = JSON.parse(text); }
  catch { fail("INVALID_PROOF_HEADER", "Wallet session control header is invalid"); }
  if (canonicalJSON(input) !== text) fail("INVALID_PROOF_HEADER", "Wallet session control header must use canonical JSON");
  return parseWalletSessionControlProof(input);
}

function parseUnsigned(input) {
  exactFields(input, FIELDS, "Unsigned Wallet session control proof");
  if (input.version !== "2" || input.chainId !== "ynx_6423-1" || input.audience !== WALLET_SESSION_CONTROL_AUDIENCE || input.method !== "POST" || ![...WALLET_SESSION_CONTROL_PATHS, ...WALLET_SESSION_CONTROL_INTENT_PATHS].includes(input.path)) fail("INVALID_CONTROL_BINDING", "Wallet session control chain, audience or route is invalid");
  const proof = {
    version: "2", chainId: input.chainId, audience: input.audience,
    account: pattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    method: "POST", path: input.path, bodyDigest: pattern(input.bodyDigest, "bodyDigest", /^[0-9a-f]{64}$/),
    nonce: pattern(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time(input.issuedAt), expiresAt: time(input.expiresAt),
  };
  if (proof.expiresAt <= proof.issuedAt || Date.parse(proof.expiresAt) - Date.parse(proof.issuedAt) > 30_000) fail("INVALID_EXPIRY", "Wallet session control proof lifetime must be at most thirty seconds");
  return Object.freeze(proof);
}
function signBytes(unsigned) { return `YNX_WALLET_SESSION_CONTROL_PROOF_V2\n${canonicalJSON(unsigned)}`; }
function time(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail("INVALID_TIME", "Wallet session control timestamp is invalid"); return value; }
function pattern(value, label, regex) { if (typeof value !== "string" || !regex.test(value)) fail("INVALID_FIELD", `Wallet session control ${label} is invalid`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
