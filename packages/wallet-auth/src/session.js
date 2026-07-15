import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJSON, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";

export function createGatewayChallenge(approval, input) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(input.challenge)) throw new WalletAuthError("INVALID_CHALLENGE", "Gateway challenge is invalid");
  return Object.freeze({
    version: "1", challenge: input.challenge, requestDigest: approval.requestDigest, productClientId: approval.productClientId,
    bundleId: approval.bundleId, productDeviceKey: approval.productDeviceKey, account: approval.account,
    scopes: approval.grantedScopes, expiresAt: input.expiresAt,
  });
}

export function signGatewayChallenge(challenge, productDeviceSecret) {
  const secret = decodeKey(productDeviceSecret, 32, "product device secret");
  const publicKey = encodeBase64url(ed25519.getPublicKey(secret));
  if (publicKey !== challenge.productDeviceKey) throw new WalletAuthError("DEVICE_MISMATCH", "Gateway challenge is bound to another product device");
  return Object.freeze({ challenge, deviceSignature: encodeBase64url(ed25519.sign(utf8ToBytes(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`), secret)) });
}

export function verifyGatewayCompletion(completion, expected, at = new Date()) {
  const challenge = completion.challenge;
  if (challenge.expiresAt <= at.toISOString()) throw new WalletAuthError("EXPIRED", "Gateway challenge has expired");
  for (const key of ["requestDigest", "productClientId", "bundleId", "productDeviceKey", "account"]) if (challenge[key] !== expected[key]) throw new WalletAuthError("SESSION_BINDING_MISMATCH", `Gateway challenge ${key} does not match the Wallet approval`);
  const publicKey = decodeKey(challenge.productDeviceKey, 32, "product device key");
  const signature = decodeKey(completion.deviceSignature, 64, "device signature");
  if (!ed25519.verify(signature, utf8ToBytes(`YNX_PRODUCT_SESSION_CHALLENGE_V1\n${canonicalJSON(challenge)}`), publicKey)) throw new WalletAuthError("INVALID_DEVICE_PROOF", "Gateway challenge device signature is invalid");
  return Object.freeze({
    sessionBinding: bytesToHex(sha256(utf8ToBytes(canonicalJSON(challenge)))),
    productClientId: challenge.productClientId, bundleId: challenge.bundleId, account: challenge.account,
    scopes: Object.freeze([...challenge.scopes]), expiresAt: challenge.expiresAt,
  });
}

function decodeKey(value, length, label) {
  const bytes = decodeBase64url(value,label);
  if (bytes.length !== length) throw new WalletAuthError("INVALID_KEY", `${label} has the wrong length`);
  return bytes;
}
