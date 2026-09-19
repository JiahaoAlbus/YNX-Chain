import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentityFromPublicKey } from "./crypto.js";

export const CARD_APPLICATION_APPROVAL_DOMAIN = "YNX_CARD_APPLICATION_APPROVAL_V1";
const CHALLENGE_FIELDS = ["id", "applicationId", "owner", "chainId", "purpose", "payloadHash", "nonce", "issuedAt", "expiresAt"];
const DETAILS_FIELDS = ["nickname", "useCase", "limitWei", "riskAccepted", "termsVersion"];
const PROOF_FIELDS = ["version", "productId", "challenge", "details", "account", "accountPublicKey", "issuedAt", "expiresAt", "signature"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MAX_BYTES = 16 * 1024;

/** Create only after explicit approval of the complete challenge and details.
 * This is an off-chain Card business approval, not a native transaction, Product
 * Session, P-256 device proof, or evidence that a platform displayed a review.
 * The exact Card service Details hash includes five fields; controls are derived
 * separately and are not represented as approved by this protocol.
 */
export function createSignedCardApplicationApproval(input, at = new Date()) {
  const fields = record(input, ["accountSecret", "challenge", "details"], "Card approval input");
  const challenge = parseChallenge(fields.challenge);
  const details = parseDetails(fields.details);
  assertDetailsHash(challenge, details);
  const now = instant(at);
  assertActive(challenge.issuedAt, challenge.expiresAt, now);
  const secret = secretBytes(fields.accountSecret);
  try {
    const accountPublicKey = bytesToHex(secp256k1.getPublicKey(secret, true));
    const account = walletIdentityFromPublicKey(accountPublicKey);
    if (ownerAddress(challenge.owner) !== evmAddressFromYNX(account)) fail("ACCOUNT_MISMATCH", "Card challenge owner does not match the signing account");
    const unsigned = { version: "1", productId: "card", challenge, details, account, accountPublicKey, issuedAt: now.toISOString(), expiresAt: challenge.expiresAt };
    const signature = bytesToHex(secp256k1.sign(signDigest(unsigned), secret, { prehash: false, format: "compact", lowS: true }));
    return parseSignedCardApplicationApproval({ ...unsigned, signature });
  } finally { secret.fill(0); }
}

/** Validate shape, exact content hashing and the account signature. Historical
 * proofs remain parsable; use verifySignedCardApplicationApproval with trusted
 * current server context and time before accepting an approval.
 */
export function parseSignedCardApplicationApproval(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) {
    boundedBytes(raw);
    try { value = JSON.parse(raw); } catch { fail("INVALID_CARD_APPROVAL", "Card approval JSON is invalid"); }
  }
  const fields = record(value, PROOF_FIELDS, "Signed Card approval");
  if (fields.version !== "1" || fields.productId !== "card") fail("INVALID_CARD_APPROVAL", "Unsupported Card approval version or product");
  const challenge = parseChallenge(fields.challenge), details = parseDetails(fields.details);
  assertDetailsHash(challenge, details);
  const account = text(fields.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  evmAddressFromYNX(account); // Also validate the native account checksum.
  const accountPublicKey = text(fields.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  const issuedAt = timestamp(fields.issuedAt), expiresAt = timestamp(fields.expiresAt);
  if (issuedAt < challenge.issuedAt || expiresAt > challenge.expiresAt || expiresAt <= issuedAt || Date.parse(expiresAt) - Date.parse(issuedAt) > 300_000) fail("INVALID_CARD_APPROVAL_TIME", "Card approval must fit inside its challenge lifetime");
  const unsigned = { version: "1", productId: "card", challenge, details, account, accountPublicKey, issuedAt, expiresAt };
  const signature = text(fields.signature, "signature", /^[0-9a-f]{128}$/);
  const proof = Object.freeze({ ...unsigned, signature });
  const encoded = canonicalJSON(proof);
  boundedBytes(encoded);
  if (raw !== null && raw !== encoded) fail("INVALID_CARD_APPROVAL", "Card approval JSON must be canonical");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(signature), signDigest(unsigned), hexToBytes(accountPublicKey), { prehash: false, format: "compact", lowS: true });
    if (valid) {
      const derived = walletIdentityFromPublicKey(accountPublicKey);
      valid = derived === account && evmAddressFromYNX(derived) === ownerAddress(challenge.owner);
    }
  } catch { valid = false; }
  if (!valid) fail("INVALID_CARD_APPROVAL_SIGNATURE", "Card approval signature, account or owner is invalid");
  return proof;
}

/** expected.account MUST come from an already authenticated, authorized session,
 * never from the supplied proof. expected.challenge and details must be the
 * current server application. This function creates no session, grants no scope
 * and records no replay state. Consume challenge/nonce and idempotency in the
 * server's durable application transaction after this verification succeeds.
 */
export function verifySignedCardApplicationApproval(input, expected, at = new Date()) {
  const context = record(expected, ["challenge", "details", "account"], "Card approval server context");
  const challenge = parseChallenge(context.challenge), details = parseDetails(context.details);
  assertDetailsHash(challenge, details);
  const accountAddress = ownerAddress(context.account);
  const proof = parseSignedCardApplicationApproval(input);
  if (canonicalJSON(proof.challenge) !== canonicalJSON(challenge) || canonicalJSON(proof.details) !== canonicalJSON(details)
    || evmAddressFromYNX(proof.account) !== accountAddress || ownerAddress(challenge.owner) !== accountAddress) {
    fail("BINDING_MISMATCH", "Card approval does not match the current challenge, full details and authenticated account");
  }
  const now = instant(at);
  assertActive(challenge.issuedAt, challenge.expiresAt, now);
  assertActive(proof.issuedAt, proof.expiresAt, now);
  return proof;
}

/** Exactly sha256(JSON.stringify(Card.digestInput(details))). All five keys are
 * fixed ASCII, so canonicalJSON's key ordering equals the service's locale sort.
 * There is no amount coercion, whitespace normalization or hidden extra payload.
 */
export function cardApplicationDetailsHash(details) { return hash(canonicalJSON(parseDetails(details))); }

/** Stable, signature-verified proof identifier for receipt/idempotency lookup.
 * It is not a chain transaction hash or an assertion that Card is active.
 */
export function cardApplicationApprovalId(input) {
  return `card_approval_${hash(canonicalJSON(parseSignedCardApplicationApproval(input)))}`;
}

function parseChallenge(input) {
  const fields = record(input, CHALLENGE_FIELDS, "Card business challenge");
  const owner = fields.owner; ownerAddress(owner);
  if (fields.chainId !== "0x1917" || fields.purpose !== "create-testnet-card") fail("INVALID_CARD_CHALLENGE", "Card challenge chain or purpose is invalid");
  const issuedAt = timestamp(fields.issuedAt), expiresAt = timestamp(fields.expiresAt);
  if (expiresAt <= issuedAt || Date.parse(expiresAt) - Date.parse(issuedAt) > 300_000) fail("INVALID_CARD_APPROVAL_TIME", "Card challenge lifetime must be positive and at most 300 seconds");
  return Object.freeze({
    id: text(fields.id, "challenge id", new RegExp(`^challenge_${UUID}$`)),
    applicationId: text(fields.applicationId, "application id", new RegExp(`^application_${UUID}$`)),
    owner, chainId: "0x1917", purpose: "create-testnet-card",
    payloadHash: text(fields.payloadHash, "payloadHash", /^[0-9a-f]{64}$/),
    nonce: text(fields.nonce, "nonce", new RegExp(`^${UUID}$`)), issuedAt, expiresAt,
  });
}

function parseDetails(input) {
  const fields = record(input, DETAILS_FIELDS, "Card application details");
  const nickname = boundedText(fields.nickname, "nickname", 2, 48), useCase = boundedText(fields.useCase, "useCase", 4, 160);
  const limitWei = text(fields.limitWei, "limitWei", /^[1-9][0-9]{0,77}$/);
  if (BigInt(limitWei) > 2n ** 256n - 1n) fail("INVALID_CARD_DETAILS", "Card YNXT limit exceeds uint256");
  if (fields.riskAccepted !== true || fields.termsVersion !== "card-testnet-v1") fail("INVALID_CARD_DETAILS", "Explicit Testnet risk acceptance and current terms are required");
  return Object.freeze({ nickname, useCase, limitWei, riskAccepted: true, termsVersion: "card-testnet-v1" });
}

function record(value, fields, label) {
  exactFields(value, fields, label);
  if (Reflect.ownKeys(value).length !== fields.length) fail("INVALID_CARD_APPROVAL", `${label} contains hidden fields`);
  const out = {};
  for (const key of fields) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) fail("INVALID_CARD_APPROVAL", `${label} must contain plain data fields`);
    out[key] = property.value;
  }
  return out;
}

function ownerAddress(value) {
  if (typeof value === "string" && value.startsWith("ynx1")) return evmAddressFromYNX(value);
  return text(value, "owner", /^0x[0-9a-f]{40}$/);
}
function timestamp(value) {
  text(value, "timestamp", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail("INVALID_CARD_APPROVAL_TIME", "Card approval timestamp is invalid");
  return value;
}
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_CARD_APPROVAL_TIME", "Card approval requires valid authority time"); return value; }
function assertActive(issuedAt, expiresAt, at) { if (Date.parse(issuedAt) > at.getTime() || Date.parse(expiresAt) <= at.getTime()) fail("CARD_APPROVAL_EXPIRED", "Card approval is not currently valid"); }
function assertDetailsHash(challenge, details) { if (hash(canonicalJSON(details)) !== challenge.payloadHash) fail("BINDING_MISMATCH", "Card challenge hash does not match the exact business details"); }
function boundedText(value, label, min, max) { if (typeof value !== "string" || value.trim() !== value || value.length < min || value.length > max) fail("INVALID_CARD_DETAILS", `Card ${label} is invalid`); return value; }
function text(value, label, pattern) { if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) fail("INVALID_CARD_APPROVAL", `Card ${label} is invalid`); return value; }
function boundedBytes(raw) { if (!raw.length || raw.length > MAX_BYTES || utf8ToBytes(raw).length > MAX_BYTES) fail("INVALID_CARD_APPROVAL", "Card approval exceeds its byte limit"); }
function hash(value) { return bytesToHex(sha256(utf8ToBytes(value))); }
function signDigest(unsigned) { return sha256(utf8ToBytes(`${CARD_APPLICATION_APPROVAL_DOMAIN}\n${canonicalJSON(unsigned)}`)); }
function secretBytes(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const bytes = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(bytes)) { bytes.fill(0); fail("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range"); }
  return bytes;
}
function fail(code, message) { throw new WalletAuthError(code, message); }
