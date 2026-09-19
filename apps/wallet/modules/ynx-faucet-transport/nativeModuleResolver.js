export function resolveNativeModule(name) {
  return globalThis.expo?.modules?.[name] ?? null;
}
