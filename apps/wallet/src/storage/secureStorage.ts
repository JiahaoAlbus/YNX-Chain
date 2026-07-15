import * as SecureStore from "expo-secure-store";
import type { SecureStorageAdapter } from "./walletRepository";

export const platformSecureStorage: SecureStorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

export async function assertSecureStorageAvailable(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) throw new Error("iOS Keychain or Android Keystore-backed secure storage is unavailable");
}
