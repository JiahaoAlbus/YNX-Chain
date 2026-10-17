// Non-native test/web resolver; this does not enable a platform by itself.
export function resolveNativeModule(name) {
  return globalThis.expo?.modules?.[name] ?? null;
}
