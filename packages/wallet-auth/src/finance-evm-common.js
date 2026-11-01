import { p256 } from "@noble/curves/nist.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { ethereumPersonalMessageDigest, recoverEthereumAddress } from "./evm-product-login.js";

export const FINANCE_EVM_ORIGIN = "https://finance.ynxweb4.com";
export const FINANCE_EVM_CALLBACK = "https://finance.ynxweb4.com/wallet-auth/callback";
export const FINANCE_EVM_CHAIN_ID = 6423;
export const FINANCE_EVM_MAX_LIFETIME_MS = 300_000;
export const FINANCE_EVM_PROOF_MAX_LIFETIME_MS = 60_000;

export function fail(code, message) { throw new WalletAuthError(code, message); }
export function literal(value, expected) {
  if (value !== expected) fail("INVALID_FIELD", "Protocol literal is invalid");
  return expected;
}
export function pattern(value, label, regex) {
  if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail("INVALID_FIELD", label + " is invalid");
  return value;
}
export function evmAccount(value) { return pattern(value, "account", /^0x[0-9a-f]{40}$/); }
export function evmAccountType(value) { return pattern(value, "accountType", /^(eoa|contract)$/); }
export function token(value, label) { return pattern(value, label, /^[A-Za-z0-9_-]{32,64}$/); }
export function digest(value) { return pattern(value, "digest", /^[0-9a-f]{64}$/); }
export function subjectId(value) { return pattern(value, "subjectId", /^evm_subject_[0-9a-f]{64}$/); }
export function time(value, label) {
  const text = pattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail("INVALID_TIME", label + " is invalid");
  return text;
}
export function authorityTime(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Trusted authority time is required");
  return value.getTime();
}
export function activeWindow(issuedAt, expiresAt, maxLifetime, at) {
  const issued = Date.parse(time(issuedAt, "issuedAt")), expires = Date.parse(time(expiresAt, "expiresAt")), now = authorityTime(at);
  if (expires <= issued || expires - issued > maxLifetime) fail("INVALID_EXPIRY", "Lifetime is invalid");
  if (issued > now + 30_000) fail("ISSUED_IN_FUTURE", "Issued time is outside the trusted clock window");
  if (expires <= now) fail("EXPIRED", "Authorization expired");
}
export function deviceKey(value) {
  const bytes = decodeBase64url(value, "deviceKey");
  if (bytes.length !== 33 || ![2, 3].includes(bytes[0]) || encodeBase64url(bytes) !== value) fail("INVALID_DEVICE", "P-256 device key is invalid");
  try { p256.Point.fromBytes(bytes); } catch { fail("INVALID_DEVICE", "P-256 device key is invalid"); }
  return value;
}
export function deviceSignature(value) {
  const bytes = decodeBase64url(value, "deviceSignature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== value) fail("INVALID_DEVICE_PROOF", "Device signature is invalid");
  return value;
}
export function normalizeDeviceSignature(value) {
  const bytes = decodeBase64url(value, "deviceSignature");
  if (bytes.length === 64) {
    try { return encodeBase64url(p256.Signature.fromBytes(bytes, "compact").toBytes("der")); }
    catch { fail("INVALID_DEVICE_PROOF", "Browser P-256 signature is invalid"); }
  }
  return deviceSignature(value);
}
export function signDevice(message, secretInput, publicKey) {
  const secret = decodeBase64url(secretInput, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== publicKey) fail("DEVICE_CHANGED", "Device key changed");
  return encodeBase64url(p256.sign(utf8ToBytes(message), secret, { format: "der" }));
}
export function verifyDevice(signature, message, publicKey) {
  let valid = false;
  try { valid = p256.verify(decodeBase64url(signature, "deviceSignature"), utf8ToBytes(message), decodeBase64url(publicKey, "deviceKey"), { format: "der", lowS: false }); }
  catch { valid = false; }
  if (!valid) fail("INVALID_DEVICE_PROOF", "P-256 device proof differs from the bound key");
}
export function walletSignature(value, accountType) {
  const text = pattern(value, "walletSignature", /^0x(?:[0-9a-fA-F]{2}){1,2048}$/);
  if (accountType === "eoa" && !/^0x[0-9a-fA-F]{130}$/.test(text)) fail("INVALID_SIGNATURE", "EOA signature must be 65 bytes");
  return text;
}
export async function verifyWalletSignature(message, signature, account, accountType, verifyContractSignature) {
  const digestBytes = ethereumPersonalMessageDigest(message);
  if (accountType === "eoa") {
    if (recoverEthereumAddress(signature, digestBytes) !== account) fail("INVALID_SIGNATURE", "EVM signature does not match account");
  } else {
    if (typeof verifyContractSignature !== "function") fail("CONTRACT_ACCOUNT_UNSUPPORTED", "EIP-1271 verifier is unavailable");
    const valid = await verifyContractSignature(Object.freeze({ account, chainId: FINANCE_EVM_CHAIN_ID, message, digest: "0x" + bytesToHex(digestBytes), signature }));
    if (valid !== true) fail("INVALID_SIGNATURE", "Contract account rejected the signature");
  }
}
export function rawTarget(value) {
  const text = pattern(value, "target", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/%?-]{1,512}$/);
  const [pathname, query, ...extra] = text.split("?");
  if (extra.length || pathname.includes("//") || pathname.endsWith("/") || query === "" || /%(?![0-9A-F]{2})/.test(text)) fail("INVALID_TARGET", "Request target is non-canonical");
  return text;
}
