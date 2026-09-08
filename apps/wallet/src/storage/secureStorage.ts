import * as SecureStore from "expo-secure-store";
import { createPlatformSecureStorage } from "./secureStoragePolicy";
import { SecureStorageHealth } from "./secureStorageHealth";

export const platformStorageHealth = new SecureStorageHealth();
export const platformSecureStorage = createPlatformSecureStorage(SecureStore, platformStorageHealth);

export async function assertSecureStorageAvailable(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) throw new Error("iOS Keychain or Android Keystore-backed secure storage is unavailable");
}
