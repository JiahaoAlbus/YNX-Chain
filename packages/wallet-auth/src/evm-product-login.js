import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { exactFields, WalletAuthError } from "./canonical.js";
import { WALLET_PROVIDER_KIND } from "./wallet-provider-discovery.js";

export const EVM_PRODUCT_LOGIN_VERSION = "1";
export const EVM_PRODUCT_LOGIN_SCHEME = "eip4361";
export const EVM_PRODUCT_LOGIN_CHAIN_ID = 6423;
export const EVM_PRODUCT_LOGIN_MAX_LIFETIME_MS = 10 * 60 * 1000;
export const EVM_PRODUCT_LOGIN_DEFAULT_CLOCK_SKEW_MS = 2 * 60 * 1000;

const CHALLENGE_FIELDS = ["version", "scheme", "domain", "uri", "account", "accountType", "chainId", "nonce", "issuedAt", "notBefore", "expirationTime", "requestId", "statement", "productId", "scopes", "providerKind"];
const PROOF_FIELDS = ["challenge", "message", "signature"];

export function parseEvmProductLoginChallenge(input) {
  exactFields(input, CHALLENGE_FIELDS, "EVM product login challenge");
  const value = Object.freeze({
    version: pattern(input.version, "version", /^1$/),
    scheme: pattern(input.scheme, "scheme", /^eip4361$/),
    domain: domain(input.domain), uri: uri(input.uri), account: address(input.account),
    accountType: pattern(input.accountType, "accountType", /^(eoa|contract)$/),
    chainId: input.chainId, nonce: pattern(input.nonce, "nonce", /^[A-Za-z0-9]{16,64}$/),
    issuedAt: time(input.issuedAt, "issuedAt"), notBefore: time(input.notBefore, "notBefore"),
    expirationTime: time(input.expirationTime, "expirationTime"),
    requestId: pattern(input.requestId, "requestId", /^[A-Za-z0-9._~-]{16,128}$/),
    statement: statement(input.statement), productId: pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    scopes: scopeList(input.scopes), providerKind: pattern(input.providerKind, "providerKind", /^(ynx-wallet|metamask)$/),
  });
  if (value.chainId !== EVM_PRODUCT_LOGIN_CHAIN_ID) fail("UNSUPPORTED_CHAIN", "EVM product login is restricted to YNX Testnet chain 6423");
  if (new URL(value.uri).host !== value.domain) fail("DOMAIN_URI_MISMATCH", "EVM product login domain and URI do not match");
  const issued = Date.parse(value.issuedAt), notBefore = Date.parse(value.notBefore), expires = Date.parse(value.expirationTime);
  if (notBefore < issued || expires <= notBefore || expires - issued > EVM_PRODUCT_LOGIN_MAX_LIFETIME_MS) fail("INVALID_EXPIRY", "EVM product login lifetime is invalid");
  return value;
}

export function createEvmProductLoginChallenge(input) {
  return parseEvmProductLoginChallenge({ ...input, version: EVM_PRODUCT_LOGIN_VERSION, scheme: EVM_PRODUCT_LOGIN_SCHEME });
}

export function evmProductLoginMessage(input) {
  const challenge = parseEvmProductLoginChallenge(input);
  const resources = [
    `urn:ynx:product:${challenge.productId}`,
    ...challenge.scopes.map((scope) => `urn:ynx:scope:${scope}`),
    `urn:ynx:provider:${challenge.providerKind}`,
    `urn:ynx:request:${challenge.requestId}`,
  ];
  return `${challenge.domain} wants you to sign in with your Ethereum account:\n${challenge.account}\n\n${challenge.statement}\n\nURI: ${challenge.uri}\nVersion: 1\nChain ID: ${challenge.chainId}\nNonce: ${challenge.nonce}\nIssued At: ${challenge.issuedAt}\nExpiration Time: ${challenge.expirationTime}\nNot Before: ${challenge.notBefore}\nRequest ID: ${challenge.requestId}\nResources:\n${resources.map((resource) => `- ${resource}`).join("\n")}`;
}

export function createEvmProductLoginSigningRequest(input) {
  const challenge = parseEvmProductLoginChallenge(input), message = evmProductLoginMessage(challenge);
  return Object.freeze({ method: "personal_sign", params: Object.freeze([`0x${bytesToHex(utf8ToBytes(message))}`, challenge.account]), message });
}

export function parseEvmProductLoginProof(input) {
  exactFields(input, PROOF_FIELDS, "EVM product login proof");
  const challenge = parseEvmProductLoginChallenge(input.challenge), message = input.message;
  if (typeof message !== "string" || message !== evmProductLoginMessage(challenge)) fail("MESSAGE_MISMATCH", "Signed EVM product login message is not the exact issued challenge");
  const signature = proofSignature(input.signature, challenge.accountType);
  return Object.freeze({ challenge, message, signature });
}

export async function verifyEvmProductLoginProof(input, expected, at = new Date()) {
  const proof = parseEvmProductLoginProof(input);
  exactFields(expected, ["challenge", "clockSkewMs", "verifyContractSignature"], "EVM product login verification context");
  const reference = parseEvmProductLoginChallenge(expected.challenge);
  if (evmProductLoginMessage(reference) !== proof.message) fail("LOGIN_BINDING_MISMATCH", "EVM product login challenge changed after issuance");
  const now = validDate(at).getTime(), skew = clockSkew(expected.clockSkewMs);
  if (Date.parse(proof.challenge.issuedAt) > now + skew) fail("ISSUED_IN_FUTURE", "EVM product login challenge was issued in the future");
  if (Date.parse(proof.challenge.notBefore) > now + skew) fail("NOT_YET_VALID", "EVM product login challenge is not active");
  // Expiry is a hard server-authority cutoff. Clock skew can delay activation
  // checks for a client clock, but must never extend write authority.
  if (Date.parse(proof.challenge.expirationTime) <= now) fail("LOGIN_EXPIRED", "EVM product login challenge expired");
  const digest = ethereumPersonalMessageDigest(proof.message);
  if (proof.challenge.accountType === "eoa") {
    if (recoverEthereumAddress(proof.signature, digest) !== proof.challenge.account) fail("INVALID_SIGNATURE", "EVM product login signature does not match the selected account");
  } else {
    if (typeof expected.verifyContractSignature !== "function") fail("CONTRACT_ACCOUNT_UNSUPPORTED", "Contract account login requires an EIP-1271 verifier");
    const valid = await expected.verifyContractSignature(Object.freeze({ account: proof.challenge.account, chainId: proof.challenge.chainId, message: proof.message, digest: `0x${bytesToHex(digest)}`, signature: proof.signature }));
    if (valid !== true) fail("INVALID_SIGNATURE", "Contract account rejected the EVM product login signature");
  }
  return Object.freeze({ verified: true, account: proof.challenge.account, accountType: proof.challenge.accountType, chainId: proof.challenge.chainId, productId: proof.challenge.productId, scopes: proof.challenge.scopes, providerKind: proof.challenge.providerKind, nonce: proof.challenge.nonce, requestId: proof.challenge.requestId, message: proof.message });
}

export async function verifyAndConsumeEvmProductLoginProof(input, expected, consume, at = new Date()) {
  if (typeof consume !== "function") fail("REPLAY_STORE_REQUIRED", "EVM product login requires an atomic replay consumer");
  const verified = await verifyEvmProductLoginProof(input, expected, at);
  const consumed = await consume(Object.freeze({ nonce: verified.nonce, requestId: verified.requestId, account: verified.account, productId: verified.productId, expirationTime: input.challenge.expirationTime }));
  if (consumed !== true) fail("REPLAY", "EVM product login challenge was already consumed");
  return verified;
}

export function ethereumPersonalMessageDigest(message) {
  if (typeof message !== "string") fail("INVALID_MESSAGE", "EVM product login message is invalid");
  const bytes = utf8ToBytes(message), prefix = utf8ToBytes(`\u0019Ethereum Signed Message:\n${bytes.length}`);
  return keccak_256(concatBytes(prefix, bytes));
}

function recoverEthereumAddress(signature, digest) {
  try {
    const raw = hexToBytes(signature.slice(2)), recovery = raw[64] >= 27 ? raw[64] - 27 : raw[64];
    if (recovery !== 0 && recovery !== 1) fail("INVALID_SIGNATURE", "EVM product login recovery id is invalid");
    if (secp256k1.Signature.fromBytes(raw.slice(0, 64), "compact").hasHighS()) fail("INVALID_SIGNATURE", "EVM product login signature is malleable");
    const recovered = concatBytes(Uint8Array.of(recovery), raw.slice(0, 64));
    const publicKey = secp256k1.recoverPublicKey(recovered, digest, { prehash: false });
    const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
    return `0x${bytesToHex(keccak_256(uncompressed.slice(1)).slice(-20))}`;
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    fail("INVALID_SIGNATURE", "EVM product login signature is invalid");
  }
}

function proofSignature(value, accountType) {
  if (typeof value !== "string" || value.trim() !== value || !/^0x(?:[0-9a-fA-F]{2}){1,2048}$/.test(value)) fail("INVALID_SIGNATURE", "EVM product login signature is invalid");
  if (accountType === "eoa" && !/^0x[0-9a-fA-F]{130}$/.test(value)) fail("INVALID_SIGNATURE", "EOA product login signature must be 65 bytes");
  return value;
}

function uri(value) { const normalized = pattern(value, "uri", /^https:\/\/[^\s#]+$/); let parsed; try { parsed = new URL(normalized); } catch { fail("INVALID_URI", "EVM product login URI is invalid"); } if (parsed.username || parsed.password || parsed.hash || parsed.toString() !== normalized) fail("INVALID_URI", "EVM product login URI is unsafe or non-canonical"); return normalized; }
function domain(value) { return pattern(value, "domain", /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{2,5})?$/); }
function address(value) { return pattern(value, "account", /^0x[0-9a-f]{40}$/); }
function statement(value) { const normalized = pattern(value, "statement", /^[^\r\n]{8,160}$/); if (normalized.includes("URI:")) fail("INVALID_STATEMENT", "EVM product login statement is invalid"); return normalized; }
function scopeList(value) { if (!Array.isArray(value) || value.length < 1 || value.length > 8) fail("INVALID_SCOPES", "EVM product login scopes are invalid"); const result = value.map((scope) => pattern(scope, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)); if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n")) fail("INVALID_SCOPES", "EVM product login scopes must be unique and sorted"); return Object.freeze(result); }
function time(value, label) { const normalized = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail("INVALID_TIME", `${label} is invalid`); return normalized; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "EVM product login verification time is invalid"); return value; }
function clockSkew(value) { if (!Number.isSafeInteger(value) || value < 0 || value > EVM_PRODUCT_LOGIN_DEFAULT_CLOCK_SKEW_MS) fail("INVALID_CLOCK_SKEW", "EVM product login clock skew is invalid"); return value; }
function pattern(value, label, regex) { if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail("INVALID_FIELD", `${label} is invalid`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
