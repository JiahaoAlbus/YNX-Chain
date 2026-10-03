import { requireOptionalNativeModule } from "expo-modules-core";

// Metro resolves this platform implementation. Missing native code stays null.
export function resolveNativeModule(name) {
  return requireOptionalNativeModule(name);
}
