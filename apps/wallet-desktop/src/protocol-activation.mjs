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
