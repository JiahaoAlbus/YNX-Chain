import * as SecureStore from "expo-secure-store";
import { createPlatformSecureStorage } from "./secureStoragePolicy";

export const platformSecureStorage = createPlatformSecureStorage(SecureStore);

export async function assertSecureStorageAvailable(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) throw new Error("iOS Keychain or Android Keystore-backed secure storage is unavailable");
}
