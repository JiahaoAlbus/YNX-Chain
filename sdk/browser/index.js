import {ed25519} from "@noble/curves/ed25519.js";
import {secp256k1} from "@noble/curves/secp256k1.js";
import {sha256} from "@noble/hashes/sha2.js";
import {keccak_256} from "@noble/hashes/sha3.js";
import {bytesToHex, hexToBytes, randomBytes} from "@noble/hashes/utils.js";

export {openSignerVault, sealSignerVault} from "./vault.js";
export {YNXSquareAppClient} from "./client.js";

const textEncoder = new TextEncoder();
const YNX_HRP = "ynx";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export class YNXBrowserSignerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "YNXBrowserSignerError";
    this.code = code;
  }
}

export function generateAccountSecret() {
  return secp256k1.utils.randomSecretKey();
}

export function generateDeviceSecret() {
  return ed25519.utils.randomSecretKey();
}

export function accountIdentity(accountSecret) {
  const secret = validAccountSecret(accountSecret);
  const compressedPublicKey = secp256k1.getPublicKey(secret, true);
  const uncompressedPublicKey = secp256k1.getPublicKey(secret, false);
  const digest = keccak_256(uncompressedPublicKey.slice(1));
  const evmAddress = `0x${bytesToHex(digest.slice(-20))}`;
  return Object.freeze({
    account: encodeYNXAddress(digest.slice(-20)),
    accountPublicKey: bytesToHex(compressedPublicKey),
    evmAddress,
  });
}

export function deviceIdentity(deviceSecret) {
  const secret = validDeviceSecret(deviceSecret);
  return Object.freeze({
    deviceSigningPublicKey: bytesToBase64Raw(ed25519.getPublicKey(secret)),
  });
}

export function signOwnershipChallenge({accountSecret, deviceSecret, signBytes}) {
  const account = validAccountSecret(accountSecret);
  const device = validDeviceSecret(deviceSecret);
  const payload = base64RawToBytes(signBytes, "challenge signBytes");
  const digest = sha256(payload);
  return Object.freeze({
    accountPublicKey: bytesToHex(secp256k1.getPublicKey(account, true)),
    accountSignature: bytesToHex(secp256k1.sign(digest, account, {format: "der", lowS: true, prehash: false})),
    deviceSignature: bytesToBase64Raw(ed25519.sign(payload, device)),
  });
}

export function squareDeviceRegistration({account, deviceId, deviceSecret, idempotencyKey}) {
  const secret = validDeviceSecret(deviceSecret);
  const signingPublicKey = bytesToBase64Raw(ed25519.getPublicKey(secret));
  const request = {
    idempotencyKey: validIdentifier(idempotencyKey, "idempotency key"),
    account: validYNXAddress(account),
    deviceId: validIdentifier(deviceId, "device id"),
    signingPublicKey,
  };
  const payload = textEncoder.encode([
    "ynx-square-device-register-v1",
    request.account,
    request.deviceId,
    request.signingPublicKey,
    request.idempotencyKey,
  ].join("\n"));
  return Object.freeze({...request, proofSignature: bytesToBase64Raw(ed25519.sign(payload, secret))});
}

export function signSquareRequest({method, requestUri, timestamp, body, deviceSecret}) {
  const secret = validDeviceSecret(deviceSecret);
  const normalizedMethod = String(method || "").toUpperCase();
  if (!/^(GET|POST)$/.test(normalizedMethod)) throw new YNXBrowserSignerError("Square method must be GET or POST", "INVALID_METHOD");
  if (typeof requestUri !== "string" || !requestUri.startsWith("/square/") || requestUri.includes("#")) {
    throw new YNXBrowserSignerError("Square request URI must be a canonical /square/* path", "INVALID_REQUEST_URI");
  }
  if (typeof timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp)) {
    throw new YNXBrowserSignerError("Square timestamp must be an RFC3339 UTC value", "INVALID_TIMESTAMP");
  }
  const bodyBytes = requestBodyBytes(body);
  const payload = textEncoder.encode([
    "ynx-square-http-v1",
    normalizedMethod,
    requestUri,
    timestamp,
    bytesToHex(sha256(bodyBytes)),
  ].join("\n"));
  return bytesToBase64Raw(ed25519.sign(payload, secret));
}

export function randomIdentifier(prefix) {
  if (typeof prefix !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}$/.test(prefix)) {
    throw new YNXBrowserSignerError("identifier prefix is invalid", "INVALID_IDENTIFIER");
  }
  return `${prefix}-${bytesToHex(randomBytes(12))}`;
}

export function importAccountSecret(hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex.trim())) {
    throw new YNXBrowserSignerError("account secret must be exactly 32 bytes of hex", "INVALID_ACCOUNT_SECRET");
  }
  return validAccountSecret(hexToBytes(hex.trim()));
}

export function exportAccountSecret(secret) {
  return bytesToHex(validAccountSecret(secret));
}

export function zeroize(...values) {
  for (const value of values) {
    if (value instanceof Uint8Array) value.fill(0);
  }
}

function validAccountSecret(value) {
  if (!(value instanceof Uint8Array) || value.length !== 32 || !secp256k1.utils.isValidSecretKey(value)) {
    throw new YNXBrowserSignerError("account secret must be a valid 32-byte secp256k1 key", "INVALID_ACCOUNT_SECRET");
  }
  return value;
}

function validDeviceSecret(value) {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new YNXBrowserSignerError("device secret must be a 32-byte Ed25519 seed", "INVALID_DEVICE_SECRET");
  }
  return value;
}

function validIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) {
    throw new YNXBrowserSignerError(`${label} is invalid`, "INVALID_IDENTIFIER");
  }
  return value;
}

function validYNXAddress(value) {
  if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) {
    throw new YNXBrowserSignerError("account must be a canonical lowercase ynx1 address", "INVALID_ACCOUNT");
  }
  return value;
}

function requestBodyBytes(body) {
  if (body === undefined || body === null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return textEncoder.encode(body);
  throw new YNXBrowserSignerError("request body must be exact UTF-8 text or bytes", "INVALID_BODY");
}

function bytesToBase64Raw(value) {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary).replace(/=+$/u, "");
}

function base64RawToBytes(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new YNXBrowserSignerError(`${label} must be raw base64`, "INVALID_BASE64");
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - value.length % 4) % 4);
  let binary;
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new YNXBrowserSignerError(`${label} must be raw base64`, "INVALID_BASE64");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeYNXAddress(payload) {
  const data = convertBits(payload, 8, 5, true);
  const values = bech32HRPExpand(YNX_HRP).concat(data, [0, 0, 0, 0, 0, 0]);
  const checksum = bech32Polymod(values) ^ 1;
  const checksumValues = Array.from({length: 6}, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `${YNX_HRP}1${data.concat(checksumValues).map((item) => BECH32_CHARSET[item]).join("")}`;
}

function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0;
  let bits = 0;
  const result = [];
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;
  for (const value of data) {
    accumulator = ((accumulator << fromBits) | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  return result;
}

function bech32HRPExpand(hrp) {
  return [...hrp].map((character) => character.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((character) => character.charCodeAt(0) & 31));
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if ((top >>> index) & 1) checksum = (checksum ^ generator) >>> 0;
    });
  }
  return checksum >>> 0;
}
