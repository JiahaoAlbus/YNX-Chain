import { requireOptionalNativeModule } from "expo-modules-core";

export function resolveNativeModule(name) {
  return requireOptionalNativeModule(name);
}
