const MAX_PROTOCOL_URL_BYTES = 64 * 1024;

export function extractYNXWalletProtocolUrl(argv) {
  if (!Array.isArray(argv)) return null;
  for (const value of argv) {
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PROTOCOL_URL_BYTES) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "ynxwallet:" && !parsed.username && !parsed.password) return value;
    } catch {}
  }
  return null;
}

export function canonicalizeWindowsYNXWalletProtocolUrl(value, platform = process.platform) {
  if (platform !== "win32" || typeof value !== "string") return value;
  try {
    const url = new URL(value);
    const keys = [...url.searchParams.keys()];
    if (url.protocol !== "ynxwallet:" || url.hostname !== "authorize" || url.pathname !== "/" || url.hash || url.username || url.password || keys.length !== 1 || keys[0] !== "request") return value;
    return `ynxwallet://authorize?request=${url.searchParams.get("request") ?? ""}`;
  } catch {
    return value;
  }
}

export function canonicalizeWindowsProductCallbackUrl(value, expectedCallback, platform = process.platform) {
  if (platform !== "win32" || typeof value !== "string" || typeof expectedCallback !== "string") return value;
  try {
    const actual = new URL(value);
    const expected = new URL(expectedCallback);
    const keys = [...actual.searchParams.keys()];
    if (expected.pathname || expected.search || expected.hash || expected.username || expected.password ||
        actual.protocol !== expected.protocol || actual.hostname !== expected.hostname || actual.port !== expected.port ||
        actual.pathname !== "/" || actual.hash || actual.username || actual.password || keys.length !== 1 || keys[0] !== "response") return value;
    return `${expectedCallback}?response=${encodeURIComponent(actual.searchParams.get("response") ?? "")}`;
  } catch {
    return value;
  }
}
