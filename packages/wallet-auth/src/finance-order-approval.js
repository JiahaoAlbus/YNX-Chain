import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { evmAddressFromYNX, walletIdentity, walletIdentityFromPublicKey } from "./crypto.js";

export const FINANCE_ORDER_DOMAIN = "YNX_FINANCE_ORDER_V1";
export const FINANCE_ORDER_APPROVAL_DOMAIN = "YNX_FINANCE_ORDER_APPROVAL_V1";
export const FINANCE_ORDER_APPROVAL_REVOKE_DOMAIN = "YNX_FINANCE_ORDER_APPROVAL_REVOKE_V1";
export const FINANCE_PRODUCT_CLIENT_ID = "ynx-finance-v1";

const ORDER_FIELDS = ["assetClass", "assetId", "currency", "extendedHours", "feeBoundSource", "limitPrice", "maxCost", "maxFee", "orderId", "orderType", "qty", "side", "symbol", "timeInForce"];
const UNSIGNED_FIELDS = ["account", "accountPublicKey", "applicationId", "brokerAccountId", "callbackStateHash", "chainEnvironment", "chainId", "challengeId", "expiresAt", "issuedAt", "nonce", "order", "orderHash", "origin", "platform", "productId", "provider", "requestId", "subjectId", "tradingEnvironment", "version"];
const SIGNED_FIELDS = [...UNSIGNED_FIELDS, "signature"];
const REVOCATION_UNSIGNED_FIELDS = ["account", "accountPublicKey", "approvalDigest", "reason", "requestId", "revokedAt", "version"];
const REVOCATION_FIELDS = [...REVOCATION_UNSIGNED_FIELDS, "signature"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ACCOUNT = /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
const PUBLIC_KEY = /^(02|03)[0-9a-f]{64}$/;
const SYMBOL = /^[A-Z][A-Z0-9.]{0,11}$/;
const SUBJECT = /^subject_[0-9a-f]{64}$/;
const PRICE = /^(?:0\.[0-9]{0,3}[1-9]|[1-9][0-9]{0,8}(?:\.[0-9]{0,3}[1-9])?)$/;
const MONEY = /^(?:0|0\.[0-9]{0,5}[1-9]|[1-9][0-9]{0,12}(?:\.[0-9]{0,5}[1-9])?)$/;
const MAX_LIFETIME_MS = 300_000;
const MAX_BYTES = 32 * 1024;

/** Hash the exact frozen one-order object. This is an approval correlation
 * digest, not a Broker identifier, chain transaction hash or execution proof. */
export function financeOrderHash(input) {
  return domainHash(FINANCE_ORDER_DOMAIN, parseFinanceOrder(input));
}

/** Parse the unsigned portion of the frozen proof schema. Finance must still
 * compare every returned field with its authenticated durable challenge. */
export function parseFinanceOrderApprovalUnsigned(input) {
  return unsignedSnapshot(input);
}

/** Sign only the already frozen unsigned envelope. Wallet does not create or
 * normalize Broker facts. The selected key must match both account fields. */
export function createSignedFinanceOrderApproval(input, at) {
  const fields = record(input, ["accountSecret", "approval"], "Finance order approval signing input");
  const approval = unsignedSnapshot(fields.approval);
  assertFinanceOrderApprovalActive(approval, at);
  const identity = walletIdentity(text(fields.accountSecret, "accountSecret", /^[0-9a-f]{64}$/));
  if (identity.account !== approval.account || identity.accountPublicKey !== approval.accountPublicKey) fail("ACCOUNT_MISMATCH", "Finance order approval account does not match the signing key");
  const secret = hexToBytes(fields.accountSecret);
  try {
    const signature = bytesToHex(secp256k1.sign(approvalDigestBytes(approval), secret, { prehash: false, format: "compact", lowS: true }));
    return parseSignedFinanceOrderApproval({ ...approval, signature });
  } finally { secret.fill(0); }
}

/** Parse canonical JSON or a plain data object, validate the complete frozen
 * schema, order arithmetic, order hash, signature, public key and YNX account. */
export function parseSignedFinanceOrderApproval(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) {
    bounded(raw);
    try { value = JSON.parse(raw); } catch { fail("INVALID_FINANCE_APPROVAL", "Finance order approval JSON is invalid"); }
  }
  const fields = record(value, SIGNED_FIELDS, "Signed Finance order approval");
  const unsigned = unsignedSnapshot(pick(fields, UNSIGNED_FIELDS));
  const signature = text(fields.signature, "signature", /^[0-9a-f]{128}$/);
  const proof = Object.freeze({ ...unsigned, signature });
  const encoded = canonicalJSON(proof); bounded(encoded);
  if (raw !== null && raw !== encoded) fail("INVALID_ENCODING", "Finance order approval JSON must be canonical without duplicate fields");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(signature), approvalDigestBytes(unsigned), hexToBytes(unsigned.accountPublicKey), { prehash: false, format: "compact", lowS: true })
      && walletIdentityFromPublicKey(unsigned.accountPublicKey) === unsigned.account;
  } catch { valid = false; }
  if (!valid) fail("INVALID_FINANCE_APPROVAL_SIGNATURE", "Finance order approval signature, public key or account is invalid");
  return proof;
}

/** Verify a proof against the complete authoritative unsigned challenge. The
 * expected context must come from Finance's authenticated session and journal,
 * never from the supplied proof. This function does not consume the approval. */
export function verifySignedFinanceOrderApproval(input, expected, at) {
  const trusted = unsignedSnapshot(expected);
  const proof = parseSignedFinanceOrderApproval(input);
  if (canonicalJSON(unsignedFromProof(proof)) !== canonicalJSON(trusted)) fail("BINDING_MISMATCH", "Finance order approval does not match the authoritative challenge and order");
  assertFinanceOrderApprovalActive(proof, at);
  return proof;
}

/** Current-time check kept separate so historical proofs remain parsable after
 * expiry. Revocation and one-time consumption remain durable Finance state. */
export function assertFinanceOrderApprovalActive(input, at) {
  const value = Object.hasOwn(input ?? {}, "signature") ? parseSignedFinanceOrderApproval(input) : unsignedSnapshot(input);
  const now = instant(at);
  if (Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now) fail("EXPIRED_FINANCE_APPROVAL", "Finance order approval is not currently active");
  return value;
}

export function financeOrderApprovalDigest(input) {
  const value = Object.hasOwn(input ?? {}, "signature") ? unsignedFromProof(parseSignedFinanceOrderApproval(input)) : unsignedSnapshot(input);
  return bytesToHex(approvalDigestBytes(value));
}

export function financeOrderApprovalId(input) {
  return `finance_order_approval_${domainHash("YNX_FINANCE_ORDER_APPROVAL_ID_V1", parseSignedFinanceOrderApproval(input))}`;
}

export function deriveFinanceSubjectId(input) {
  const fields = record(input, ["account", "applicationId", "platform", "productClientId"], "Finance subject binding");
  const account = text(fields.account, "account", ACCOUNT); evmAddressFromYNX(account);
  if (fields.applicationId !== "com.ynxweb4.finance.web" || fields.platform !== "web" || fields.productClientId !== FINANCE_PRODUCT_CLIENT_ID) fail("BINDING_MISMATCH", "Finance subject binding is not the frozen Web product");
  return `subject_${domainHash("YNX_FINANCE_SUBJECT_V1", { account, applicationId: fields.applicationId, platform: "web", productClientId: FINANCE_PRODUCT_CLIENT_ID })}`;
}

export function createSignedFinanceOrderApprovalRevocation(input, at) {
  const fields = record(input, ["accountSecret", "approval"], "Finance approval revocation signing input");
  const approval = assertFinanceOrderApprovalActive(fields.approval, at);
  if (!Object.hasOwn(approval, "signature")) fail("INVALID_FINANCE_REVOCATION", "A signed Finance approval is required before revocation");
  const identity = walletIdentity(text(fields.accountSecret, "accountSecret", /^[0-9a-f]{64}$/));
  if (identity.account !== approval.account || identity.accountPublicKey !== approval.accountPublicKey) fail("ACCOUNT_MISMATCH", "Finance approval revocation account does not match the signing key");
  const unsigned = Object.freeze({ account: approval.account, accountPublicKey: approval.accountPublicKey,
    approvalDigest: financeOrderApprovalDigest(approval), reason: "USER_REVOKED", requestId: approval.requestId,
    revokedAt: instantDate(at).toISOString(), version: "1" });
  const secret = hexToBytes(fields.accountSecret);
  try {
    const signature = bytesToHex(secp256k1.sign(revocationDigestBytes(unsigned), secret, { prehash: false, format: "compact", lowS: true }));
    return parseSignedFinanceOrderApprovalRevocation({ ...unsigned, signature });
  } finally { secret.fill(0); }
}

export function parseSignedFinanceOrderApprovalRevocation(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) { bounded(raw); try { value = JSON.parse(raw); } catch { fail("INVALID_FINANCE_REVOCATION", "Finance approval revocation JSON is invalid"); } }
  const fields = record(value, REVOCATION_FIELDS, "Signed Finance approval revocation");
  const unsigned = revocationSnapshot(pick(fields, REVOCATION_UNSIGNED_FIELDS));
  const signature = text(fields.signature, "signature", /^[0-9a-f]{128}$/), revocation = Object.freeze({ ...unsigned, signature });
  const encoded = canonicalJSON(revocation); bounded(encoded);
  if (raw !== null && raw !== encoded) fail("INVALID_ENCODING", "Finance approval revocation JSON must be canonical without duplicate fields");
  let valid = false;
  try { valid = secp256k1.verify(hexToBytes(signature), revocationDigestBytes(unsigned), hexToBytes(unsigned.accountPublicKey), { prehash: false, format: "compact", lowS: true })
      && walletIdentityFromPublicKey(unsigned.accountPublicKey) === unsigned.account; } catch { valid = false; }
  if (!valid) fail("INVALID_FINANCE_REVOCATION_SIGNATURE", "Finance approval revocation signature, public key or account is invalid");
  return revocation;
}

export function verifySignedFinanceOrderApprovalRevocation(input, approvalInput, expected, at) {
  const approval = verifySignedFinanceOrderApproval(approvalInput, expected, at);
  const revocation = parseSignedFinanceOrderApprovalRevocation(input);
  if (revocation.account !== approval.account || revocation.accountPublicKey !== approval.accountPublicKey || revocation.requestId !== approval.requestId
    || revocation.approvalDigest !== financeOrderApprovalDigest(approval)) fail("BINDING_MISMATCH", "Finance approval revocation does not match the approved proof");
  const revoked = Date.parse(revocation.revokedAt);
  if (revoked < Date.parse(approval.issuedAt) || revoked >= Date.parse(approval.expiresAt) || revoked > instant(at)) fail("INVALID_FINANCE_REVOCATION_TIME", "Finance approval revocation is outside the active proof lifetime");
  return revocation;
}

export function financeOrderApprovalRevocationDigest(input) {
  const value = Object.hasOwn(input ?? {}, "signature") ? pick(parseSignedFinanceOrderApprovalRevocation(input), REVOCATION_UNSIGNED_FIELDS) : revocationSnapshot(input);
  return bytesToHex(revocationDigestBytes(value));
}

function unsignedSnapshot(input) {
  const fields = record(input, UNSIGNED_FIELDS, "Unsigned Finance order approval");
  if (fields.version !== "1" || fields.productId !== "finance" || fields.applicationId !== "com.ynxweb4.finance.web" || fields.origin !== "https://finance.ynxweb4.com"
    || fields.platform !== "web" || fields.chainId !== "0x1917"
    || fields.chainEnvironment !== "testnet" || fields.tradingEnvironment !== "sandbox" || fields.provider !== "alpaca_broker") {
    fail("BINDING_MISMATCH", "Finance order approval source, platform, chain or Sandbox provider is invalid");
  }
  const account = text(fields.account, "account", ACCOUNT); evmAddressFromYNX(account);
  const accountPublicKey = text(fields.accountPublicKey, "accountPublicKey", PUBLIC_KEY);
  let derived; try { derived = walletIdentityFromPublicKey(accountPublicKey); } catch { fail("INVALID_ACCOUNT", "Finance order approval public key is invalid"); }
  if (derived !== account) fail("ACCOUNT_MISMATCH", "Finance order approval public key does not match its YNX account");
  const issuedAt = timestamp(fields.issuedAt), expiresAt = timestamp(fields.expiresAt);
  const issued = Date.parse(issuedAt), expires = Date.parse(expiresAt);
  if (expires <= issued || expires - issued > MAX_LIFETIME_MS) fail("INVALID_FINANCE_APPROVAL_TIME", "Finance order approval lifetime must be positive and at most 300 seconds");
  const order = parseFinanceOrder(fields.order);
  const orderHash = text(fields.orderHash, "orderHash", HASH);
  if (orderHash !== financeOrderHash(order)) fail("INVALID_FINANCE_ORDER_HASH", "Finance order hash does not match the exact reviewed order");
  const value = {
    account, accountPublicKey, applicationId: "com.ynxweb4.finance.web",
    brokerAccountId: text(fields.brokerAccountId, "brokerAccountId", PROVIDER_UUID),
    callbackStateHash: text(fields.callbackStateHash, "callbackStateHash", HASH),
    chainEnvironment: "testnet", chainId: "0x1917",
    challengeId: prefixedUUID(fields.challengeId, "challengeId", "challenge_"), expiresAt, issuedAt,
    nonce: text(fields.nonce, "nonce", UUID), order, orderHash,
    origin: "https://finance.ynxweb4.com", platform: "web",
    productId: "finance", provider: "alpaca_broker",
    requestId: prefixedUUID(fields.requestId, "requestId", "request_"),
    subjectId: text(fields.subjectId, "subjectId", SUBJECT),
    tradingEnvironment: "sandbox", version: "1",
  };
  if (value.subjectId !== deriveFinanceSubjectId({ account, applicationId: value.applicationId, platform: value.platform, productClientId: FINANCE_PRODUCT_CLIENT_ID })) fail("BINDING_MISMATCH", "Finance subject is not derived from the frozen Product Session identity");
  bounded(canonicalJSON(value));
  return Object.freeze(value);
}

export function parseFinanceOrder(input) {
  const fields = record(input, ORDER_FIELDS, "Finance order");
  if (fields.assetClass !== "us_equity" || fields.currency !== "USD" || fields.orderType !== "limit" || fields.timeInForce !== "day" || fields.extendedHours !== false
    || !["buy", "sell"].includes(fields.side) || !["provider_quote", "provider_current_schedule", "operator_policy"].includes(fields.feeBoundSource)) {
    fail("INVALID_FINANCE_ORDER", "Finance order type, market session, side or fee source is invalid");
  }
  const qtyText = text(fields.qty, "qty", /^(?:[1-9][0-9]{0,5}|1000000)$/);
  const qty = BigInt(qtyText);
  if (qty > 1_000_000n) fail("INVALID_FINANCE_ORDER", "Finance order quantity exceeds one million whole shares");
  const limitPrice = text(fields.limitPrice, "limitPrice", PRICE);
  const maxCost = text(fields.maxCost, "maxCost", MONEY);
  const maxFee = text(fields.maxFee, "maxFee", MONEY);
  const priceMicros = scaled(limitPrice, 6), costMicros = scaled(maxCost, 6), feeMicros = scaled(maxFee, 6);
  const expectedCost = fields.side === "buy" ? qty * priceMicros + feeMicros : feeMicros;
  if (costMicros !== expectedCost) fail("INVALID_FINANCE_ORDER_COST", fields.side === "buy" ? "Buy maxCost must equal quantity times limit price plus maxFee" : "Sell maxCost must equal maxFee");
  return Object.freeze({
    assetClass: "us_equity", assetId: text(fields.assetId, "assetId", PROVIDER_UUID), currency: "USD", extendedHours: false,
    feeBoundSource: fields.feeBoundSource, limitPrice, maxCost, maxFee,
    orderId: text(fields.orderId, "orderId", UUID), orderType: "limit", qty: qtyText, side: fields.side,
    symbol: text(fields.symbol, "symbol", SYMBOL), timeInForce: "day",
  });
}

function unsignedFromProof(proof) { const value = {}; for (const key of UNSIGNED_FIELDS) value[key] = proof[key]; return Object.freeze(value); }
function revocationSnapshot(input) {
  const fields = record(input, REVOCATION_UNSIGNED_FIELDS, "Unsigned Finance approval revocation");
  const account = text(fields.account, "account", ACCOUNT); evmAddressFromYNX(account);
  const accountPublicKey = text(fields.accountPublicKey, "accountPublicKey", PUBLIC_KEY);
  let derived; try { derived = walletIdentityFromPublicKey(accountPublicKey); } catch { fail("INVALID_ACCOUNT", "Finance approval revocation public key is invalid"); }
  if (derived !== account) fail("ACCOUNT_MISMATCH", "Finance approval revocation public key does not match its YNX account");
  if (fields.version !== "1" || fields.reason !== "USER_REVOKED") fail("INVALID_FINANCE_REVOCATION", "Finance approval revocation version or reason is invalid");
  return Object.freeze({ account, accountPublicKey, approvalDigest: text(fields.approvalDigest, "approvalDigest", HASH), reason: "USER_REVOKED",
    requestId: prefixedUUID(fields.requestId, "requestId", "request_"), revokedAt: timestamp(fields.revokedAt), version: "1" });
}
function pick(value, keys) { const out = {}; for (const key of keys) out[key] = value[key]; return out; }
function approvalDigestBytes(unsigned) { return sha256(utf8ToBytes(`${FINANCE_ORDER_APPROVAL_DOMAIN}\n${canonicalJSON(unsigned)}`)); }
function revocationDigestBytes(unsigned) { return sha256(utf8ToBytes(`${FINANCE_ORDER_APPROVAL_REVOKE_DOMAIN}\n${canonicalJSON(unsigned)}`)); }
function domainHash(domain, value) { return bytesToHex(sha256(utf8ToBytes(`${domain}\n${canonicalJSON(value)}`))); }
function scaled(value, scale) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale)); }
function prefixedUUID(value, label, prefix) { if (typeof value !== "string" || !value.startsWith(prefix)) fail("INVALID_FINANCE_APPROVAL", `${label} is invalid`); return `${prefix}${text(value.slice(prefix.length), label, UUID)}`; }
function text(value, label, pattern) { if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) fail("INVALID_FINANCE_APPROVAL", `${label} is invalid`); return value; }
function timestamp(value) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("INVALID_FINANCE_APPROVAL_TIME", "Finance order approval timestamp is invalid"); return value; }
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "A valid authority time is required"); return value.getTime(); }
function instantDate(value) { instant(value); return new Date(value.getTime()); }
function record(value, fields, label) {
  exactFields(value, fields, label);
  if (Reflect.ownKeys(value).length !== fields.length) fail("INVALID_SHAPE", `${label} contains hidden fields`);
  const out = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("INVALID_SHAPE", `${label} cannot contain accessors or non-enumerable fields`);
    out[key] = descriptor.value;
  }
  return out;
}
function bounded(raw) { if (!raw.length || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) fail("INVALID_ENCODING", "Finance order approval exceeds its byte limit"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
