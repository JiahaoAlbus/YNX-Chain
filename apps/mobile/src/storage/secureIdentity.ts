import * as SecureStore from "expo-secure-store";
import { decodeIdentityRecord, encodeIdentityRecord } from "./identityRecord";

const IDENTITY_KEY = "ynx.mobile.identity.v1";

export type StoredIdentity = Readonly<{
  accountSecret: Uint8Array;
  deviceSecret: Uint8Array;
}>;

export async function secureStorageAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const serialized = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (serialized === null) return null;
  return decodeIdentityRecord(serialized);
}

export async function saveIdentity(accountSecret: Uint8Array, deviceSecret: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(IDENTITY_KEY, encodeIdentityRecord(accountSecret, deviceSecret), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function deleteIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(IDENTITY_KEY);
}
