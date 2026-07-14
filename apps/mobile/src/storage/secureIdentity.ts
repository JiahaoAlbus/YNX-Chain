import * as SecureStore from "expo-secure-store";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { accountIdentity, isValidAccountSecret } from "../crypto/ynxSigner";

const IDENTITY_KEY = "ynx.mobile.identity.v1";

export type StoredIdentity = Readonly<{
  accountSecret: Uint8Array;
  deviceSecret: Uint8Array;
}>;

type IdentityRecord = {
  schemaVersion: 1;
  account: string;
  accountSecret: string;
  deviceSecret: string;
};

export async function secureStorageAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const serialized = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (serialized === null) return null;
  const record = parseRecord(serialized);
  return Object.freeze({ accountSecret: hexToBytes(record.accountSecret), deviceSecret: hexToBytes(record.deviceSecret) });
}

export async function saveIdentity(accountSecret: Uint8Array, deviceSecret: Uint8Array): Promise<void> {
  if (!isValidAccountSecret(accountSecret) || deviceSecret.length !== 32) throw new Error("YNX identity key material is invalid");
  const record: IdentityRecord = {
    schemaVersion: 1,
    account: accountIdentity(accountSecret).account,
    accountSecret: bytesToHex(accountSecret),
    deviceSecret: bytesToHex(deviceSecret),
  };
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(IDENTITY_KEY);
}

function parseRecord(serialized: string): IdentityRecord {
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
  const secret = hexToBytes(value.accountSecret);
  if (!isValidAccountSecret(secret) || accountIdentity(secret).account !== value.account) throw new Error("Secure YNX identity record does not match its account");
  return value as IdentityRecord;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
