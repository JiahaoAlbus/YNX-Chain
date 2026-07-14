import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base64RawToBytes, bytesToBase64Raw } from "./encoding";

const YNX_HRP = "ynx";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

export type YNXIdentity = Readonly<{
  account: string;
  accountPublicKey: string;
  evmAddress: string;
}>;

export function accountIdentity(accountSecret: Uint8Array): YNXIdentity {
  const secret = validAccountSecret(accountSecret);
  const compressed = secp256k1.getPublicKey(secret, true);
  const digest = keccak_256(secp256k1.getPublicKey(secret, false).slice(1));
  return Object.freeze({
    account: encodeYNXAddress(digest.slice(-20)),
    accountPublicKey: bytesToHex(compressed),
    evmAddress: `0x${bytesToHex(digest.slice(-20))}`,
  });
}

export function deviceIdentity(deviceSecret: Uint8Array) {
  return Object.freeze({ deviceSigningPublicKey: bytesToBase64Raw(ed25519.getPublicKey(validDeviceSecret(deviceSecret))) });
}

export function deviceIdentifier(deviceSecret: Uint8Array): string {
  return `mobile-${bytesToHex(sha256(ed25519.getPublicKey(validDeviceSecret(deviceSecret)))).slice(0, 24)}`;
}

export function importAccountSecret(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error("Recovery key must be exactly 64 hexadecimal characters");
  return validAccountSecret(hexToBytes(normalized));
}

export function exportAccountSecret(value: Uint8Array): string {
  return bytesToHex(validAccountSecret(value));
}

export function signOwnershipChallenge(input: { accountSecret: Uint8Array; deviceSecret: Uint8Array; signBytes: string }) {
  const account = validAccountSecret(input.accountSecret);
  const device = validDeviceSecret(input.deviceSecret);
  const payload = base64RawToBytes(input.signBytes, "challenge signBytes");
  return Object.freeze({
    accountPublicKey: bytesToHex(secp256k1.getPublicKey(account, true)),
    accountSignature: bytesToHex(secp256k1.sign(sha256(payload), account, { format: "der", lowS: true, prehash: false })),
    deviceSignature: bytesToBase64Raw(ed25519.sign(payload, device)),
  });
}

export function squareDeviceRegistration(input: { account: string; deviceId: string; deviceSecret: Uint8Array; idempotencyKey: string }) {
  const secret = validDeviceSecret(input.deviceSecret);
  const signingPublicKey = bytesToBase64Raw(ed25519.getPublicKey(secret));
  const request = { idempotencyKey: validIdentifier(input.idempotencyKey), account: validYNXAddress(input.account), deviceId: validIdentifier(input.deviceId), signingPublicKey };
  const payload = utf8ToBytes(["ynx-square-device-register-v1", request.account, request.deviceId, request.signingPublicKey, request.idempotencyKey].join("\n"));
  return Object.freeze({ ...request, proofSignature: bytesToBase64Raw(ed25519.sign(payload, secret)) });
}

export function signSquareRequest(input: { method: "GET" | "POST"; requestUri: string; timestamp: string; body?: string; deviceSecret: Uint8Array }): string {
  const secret = validDeviceSecret(input.deviceSecret);
  if (!input.requestUri.startsWith("/square/") || input.requestUri.includes("#")) throw new Error("Square request URI is invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.timestamp)) throw new Error("Square timestamp is invalid");
  const body = utf8ToBytes(input.body ?? "");
  const payload = utf8ToBytes(["ynx-square-http-v1", input.method, input.requestUri, input.timestamp, bytesToHex(sha256(body))].join("\n"));
  return bytesToBase64Raw(ed25519.sign(payload, secret));
}

export function randomIdentifier(prefix: string, random: Uint8Array): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,30}$/.test(prefix) || random.length !== 12) throw new Error("Identifier input is invalid");
  return `${prefix}-${bytesToHex(random)}`;
}

export function zeroize(...values: Uint8Array[]): void {
  for (const value of values) value.fill(0);
}

export function isValidAccountSecret(value: Uint8Array): boolean {
  return value.length === 32 && secp256k1.utils.isValidSecretKey(value);
}

function validAccountSecret(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || !isValidAccountSecret(value)) throw new Error("Account secret must be a valid 32-byte secp256k1 key");
  return value;
}

function validDeviceSecret(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error("Device secret must be a 32-byte Ed25519 seed");
  return value;
}

function validIdentifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value)) throw new Error("Identifier is invalid");
  return value;
}

function validYNXAddress(value: string): string {
  if (!/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) throw new Error("Account must be a canonical ynx1 address");
  return value;
}

function encodeYNXAddress(payload: Uint8Array): string {
  const data = convertBits(payload, 8, 5, true);
  const values = [...bech32HRPExpand(YNX_HRP), ...data, 0, 0, 0, 0, 0, 0];
  const checksum = bech32Polymod(values) ^ 1;
  const checksumValues = Array.from({ length: 6 }, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return `${YNX_HRP}1${[...data, ...checksumValues].map((item) => BECH32_CHARSET[item]).join("")}`;
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
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

function bech32HRPExpand(hrp: string): number[] {
  return [...hrp].map((character) => character.charCodeAt(0) >> 5).concat([0], [...hrp].map((character) => character.charCodeAt(0) & 31));
}

function bech32Polymod(values: number[]): number {
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
