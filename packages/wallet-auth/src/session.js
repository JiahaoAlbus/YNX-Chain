import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { PRODUCT_DEVICE_ALGORITHM } from "./protocol.js";

const CHALLENGE_FIELDS = [
  "version", "challenge", "requestDigest", "productClientId", "bundleId", "productDeviceAlgorithm",
  "productDeviceKey", "account", "scopes", "issuedAt", "expiresAt",
];
const COMPLETION_FIELDS = ["challenge", "deviceSignature"];
const SIGNING_DOMAIN = "YNX_PRODUCT_SESSION_CHALLENGE_V1";

export function createGatewayChallenge(approval, input, at = new Date()) {
  exactFields(input, ["challenge", "expiresAt"], "Gateway challenge input");
  const now = validDate(at, "Gateway challenge issue time");
  const issuedAt = now.toISOString();
  const expiresAt = strictTime(input.expiresAt, "expiresAt");
  const approvalIssuedAt = strictTime(approval.issuedAt, "approval issuedAt");
  const approvalExpiresAt = strictTime(approval.expiresAt, "approval expiresAt");
  if (issuedAt < approvalIssuedAt || issuedAt >= approvalExpiresAt) throw new WalletAuthError("INVALID_CHALLENGE_TIME", "Gateway challenge must be issued during the Wallet approval lifetime");
  if (expiresAt <= issuedAt || expiresAt > approvalExpiresAt) throw new WalletAuthError("INVALID_CHALLENGE_EXPIRY", "Gateway challenge expiry must be after issue time and no later than the Wallet approval expiry");
  return parseGatewayChallenge({
    version: "1",
    challenge: requiredPattern(input.challenge, "challenge", /^[A-Za-z0-9_-]{32,64}$/),
    requestDigest: approval.requestDigest,
    productClientId: approval.productClientId,
    bundleId: approval.bundleId,
    productDeviceAlgorithm: approval.productDeviceAlgorithm,
    productDeviceKey: approval.productDeviceKey,
    account: approval.account,
    scopes: approval.grantedScopes,
    issuedAt,
    expiresAt,
  });
}

export function parseGatewayChallenge(input) {
  exactFields(input, CHALLENGE_FIELDS, "Gateway challenge");
  const challenge = {
    version: requiredPattern(input.version, "version", /^1$/),
    challenge: requiredPattern(input.challenge, "challenge", /^[A-Za-z0-9_-]{32,64}$/),
    requestDigest: requiredPattern(input.requestDigest, "requestDigest", /^[0-9a-f]{64}$/),
    productClientId: requiredPattern(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: requiredPattern(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    productDeviceAlgorithm: requiredPattern(input.productDeviceAlgorithm, "productDeviceAlgorithm", /^p256-sha256$/),
    productDeviceKey: strictDeviceKey(input.productDeviceKey),
    account: requiredPattern(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    scopes: strictScopes(input.scopes),
    issuedAt: strictTime(input.issuedAt, "issuedAt"),
    expiresAt: strictTime(input.expiresAt, "expiresAt"),
  };
  if (challenge.expiresAt <= challenge.issuedAt) throw new WalletAuthError("INVALID_CHALLENGE_EXPIRY", "Gateway challenge expiry must be after issue time");
  return Object.freeze({ ...challenge, scopes: Object.freeze([...challenge.scopes]) });
}

export function gatewayChallengeSignBytes(challenge) {
  return `${SIGNING_DOMAIN}\n${canonicalJSON(parseGatewayChallenge(challenge))}`;
}

export function signGatewayChallenge(challenge, productDeviceSecret) {
  const parsed = parseGatewayChallenge(challenge);
  if (parsed.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", "Gateway challenge product device algorithm is unsupported");
  const secret = decodeKey(productDeviceSecret, 32, "product device secret");
  const publicKey = encodeBase64url(p256.getPublicKey(secret, true));
  if (publicKey !== parsed.productDeviceKey) throw new WalletAuthError("DEVICE_MISMATCH", "Gateway challenge is bound to another product device");
  const signature = p256.sign(utf8ToBytes(gatewayChallengeSignBytes(parsed)), secret, { format: "der" });
  return Object.freeze({ challenge: parsed, deviceSignature: encodeBase64url(signature) });
}

export function verifyGatewayCompletion(completion, expected, at = new Date()) {
  exactFields(completion, COMPLETION_FIELDS, "Gateway completion");
  const challenge = parseGatewayChallenge(completion.challenge);
  const now = validDate(at, "Gateway verification time").toISOString();
  const expectedIssuedAt = strictTime(expected.issuedAt, "approval issuedAt");
  const expectedExpiresAt = strictTime(expected.expiresAt, "approval expiresAt");
  const expectedScopes = strictScopes(expected.grantedScopes);
  if (challenge.issuedAt > now) throw new WalletAuthError("ISSUED_IN_FUTURE", "Gateway challenge issue time is in the future");
  if (challenge.expiresAt <= now) throw new WalletAuthError("EXPIRED", "Gateway challenge has expired");
  if (challenge.issuedAt < expectedIssuedAt || challenge.expiresAt > expectedExpiresAt) throw new WalletAuthError("SESSION_LIFETIME_MISMATCH", "Gateway challenge exceeds the Wallet approval lifetime");
  for (const key of ["requestDigest", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "account"]) {
    if (challenge[key] !== expected[key]) throw new WalletAuthError("SESSION_BINDING_MISMATCH", `Gateway challenge ${key} does not match the Wallet approval`);
  }
  if (challenge.scopes.join("\n") !== expectedScopes.join("\n")) throw new WalletAuthError("SESSION_SCOPE_MISMATCH", "Gateway challenge scopes do not exactly match the Wallet approval");
  const publicKey = decodeKey(challenge.productDeviceKey, 33, "product device key");
  const signature = decodeBase64url(completion.deviceSignature, "device signature");
  if (signature.length < 68 || signature.length > 72) throw new WalletAuthError("INVALID_KEY", "device signature has the wrong length");
  let valid = false;
  try { valid = p256.verify(signature, utf8ToBytes(gatewayChallengeSignBytes(challenge)), publicKey, { format: "der", lowS: false }); } catch { valid = false; }
  if (!valid) throw new WalletAuthError("INVALID_DEVICE_PROOF", "Gateway challenge device signature is invalid");
  return Object.freeze({
    sessionBinding: bytesToHex(sha256(utf8ToBytes(canonicalJSON(challenge)))),
    productClientId: challenge.productClientId,
    bundleId: challenge.bundleId,
    productDeviceAlgorithm: challenge.productDeviceAlgorithm,
    account: challenge.account,
    scopes: Object.freeze([...challenge.scopes]),
    expiresAt: challenge.expiresAt,
  });
}

function strictDeviceKey(value) {
  const normalized = requiredPattern(value, "productDeviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeKey(normalized, 33, "product device key");
  if (encodeBase64url(bytes) !== normalized || (bytes[0] !== 2 && bytes[0] !== 3)) throw new WalletAuthError("INVALID_DEVICE_KEY", "product device key must be canonical compressed P-256 SEC1");
  try { p256.Point.fromBytes(bytes); } catch { throw new WalletAuthError("INVALID_DEVICE_KEY", "product device key is not a valid P-256 point"); }
  return normalized;
}

function strictScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new WalletAuthError("INVALID_SCOPES", "scopes must contain between one and eight entries");
  const scopes = value.map((scope) => requiredPattern(scope, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(scopes).size !== scopes.length || [...scopes].sort().join("\n") !== scopes.join("\n")) throw new WalletAuthError("INVALID_SCOPES", "scopes must be unique and sorted");
  return scopes;
}

function strictTime(value, label) {
  const normalized = requiredPattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return normalized;
}

function requiredPattern(value, label, pattern) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.trim() !== value || !pattern.test(value)) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return value;
}

function validDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return value;
}

function decodeKey(value, length, label) {
  const bytes = decodeBase64url(value, label);
  if (bytes.length !== length) throw new WalletAuthError("INVALID_KEY", `${label} has the wrong length`);
  return bytes;
}
