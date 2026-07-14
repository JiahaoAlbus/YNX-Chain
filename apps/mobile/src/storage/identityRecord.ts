import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { accountIdentity, isValidAccountSecret, zeroize } from "../crypto/ynxSigner";

export type DecodedIdentity = Readonly<{
  accountSecret: Uint8Array;
  deviceSecret: Uint8Array;
}>;

type IdentityRecord = {
  schemaVersion: 1;
  account: string;
  accountSecret: string;
  deviceSecret: string;
};

export function encodeIdentityRecord(accountSecret: Uint8Array, deviceSecret: Uint8Array): string {
  if (!isValidAccountSecret(accountSecret) || deviceSecret.length !== 32) throw new Error("YNX identity key material is invalid");
  const record: IdentityRecord = {
    schemaVersion: 1,
    account: accountIdentity(accountSecret).account,
    accountSecret: bytesToHex(accountSecret),
    deviceSecret: bytesToHex(deviceSecret),
  };
  return JSON.stringify(record);
}

export function decodeIdentityRecord(serialized: string): DecodedIdentity {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Secure YNX identity record is unreadable");
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1 || typeof value.account !== "string" || typeof value.accountSecret !== "string" || typeof value.deviceSecret !== "string") {
    throw new Error("Secure YNX identity record has an unsupported schema");
  }
  if (Object.keys(value).sort().join(",") !== "account,accountSecret,deviceSecret,schemaVersion" || !/^[0-9a-f]{64}$/.test(value.accountSecret) || !/^[0-9a-f]{64}$/.test(value.deviceSecret)) {
    throw new Error("Secure YNX identity record is invalid");
  }

  const accountSecret = hexToBytes(value.accountSecret);
  const deviceSecret = hexToBytes(value.deviceSecret);
  try {
    if (!isValidAccountSecret(accountSecret) || accountIdentity(accountSecret).account !== value.account) {
      throw new Error("Secure YNX identity record does not match its account");
    }
    return Object.freeze({ accountSecret, deviceSecret });
  } catch (error) {
    zeroize(accountSecret, deviceSecret);
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
