export class StandardWalletProviderError extends Error {
  constructor(code, message, data = null) { super(message); this.name = "ProviderRpcError"; this.code = code; this.data = data; }
}

export function providerError(code, message, data = null) { return new StandardWalletProviderError(code, message, data); }

export function canonicalWalletOrigin(value) {
  if (typeof value !== "string" || value.length > 2048) throw new TypeError("DApp origin is invalid");
  if (/^walletconnect:[A-Za-z0-9_-]{16,128}$/.test(value)) return value;
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError("DApp origin is invalid"); }
  if (parsed.origin !== value || parsed.username || parsed.password || parsed.hash || parsed.search) throw new TypeError("DApp origin must be an exact origin");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) throw new TypeError("DApp origin must use HTTPS");
  return parsed.origin;
}
