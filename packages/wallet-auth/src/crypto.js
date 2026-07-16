import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { approvalSignBytes, createApprovalPayload, parseAuthorizationResponse, unsignedApproval } from "./protocol.js";
import { WalletAuthError } from "./canonical.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export function walletIdentity(secretHex) {
  const secret = validSecret(secretHex);
  const publicKey = secp256k1.getPublicKey(secret, true);
  const digest = keccak_256(secp256k1.getPublicKey(secret, false).slice(1));
  return Object.freeze({ account: encodeYNX(digest.slice(-20)), accountPublicKey: bytesToHex(publicKey) });
}

export function signAuthorization(request, input) {
  const secret = validSecret(input.accountSecret);
  const identity = walletIdentity(bytesToHex(secret));
  if (input.account && input.account !== identity.account) throw new WalletAuthError("ACCOUNT_MISMATCH", "Selected account does not match the signing key");
  const payload = createApprovalPayload(request, { ...identity, issuedAt: input.issuedAt });
  const signature = secp256k1.sign(sha256(utf8ToBytes(approvalSignBytes(payload))), secret, { prehash: false, format: "compact", lowS: true });
  return Object.freeze({ ...payload, walletSignature: bytesToHex(signature) });
}

export function verifyAuthorization(response, expected) {
  const parsed = parseAuthorizationResponse(response);
  const exactKeys = ["nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "callback", "purpose"];
  if (parsed.requestDigest !== expected.requestDigest || exactKeys.some((key) => parsed[key] !== expected[key]) || parsed.grantedScopes.join("\n") !== expected.scopes.join("\n") || parsed.expiresAt > expected.expiresAt) {
    throw new WalletAuthError("BINDING_MISMATCH", "Wallet approval does not match the exact product request");
  }
  if (parsed.expiresAt <= expected.now.toISOString()) throw new WalletAuthError("EXPIRED", "Wallet approval has expired");
  const valid = secp256k1.verify(hexToBytes(parsed.walletSignature), sha256(utf8ToBytes(approvalSignBytes(unsignedApproval(parsed)))), hexToBytes(parsed.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  if (!valid || walletIdentityFromPublicKey(parsed.accountPublicKey) !== parsed.account) throw new WalletAuthError("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return parsed;
}

export function walletIdentityFromPublicKey(publicKeyHex) {
  const point = secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));
  const digest = keccak_256(point.toBytes(false).slice(1));
  return encodeYNX(digest.slice(-20));
}

function validSecret(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const bytes = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(bytes)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  return bytes;
}

function encodeYNX(payload) {
  const data = convertBits(payload, 8, 5, true);
  const values = [...hrpExpand("ynx"), ...data, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(values) ^ 1;
  const tail = Array.from({ length: 6 }, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `ynx1${[...data, ...tail].map((item) => CHARSET[item]).join("")}`;
}

function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0, bits = 0;
  const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; result.push((accumulator >> bits) & maxValue); }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  return result;
}

function hrpExpand(hrp) { return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31)); }
function polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => { if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0; });
  }
  return checksum >>> 0;
}
