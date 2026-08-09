export type DeveloperWalletBridge = {
  getProductDevicePublicKey: (productClientId: "ynx-developer-v1") => Promise<string>;
  openAuthorization: (deepLink: string) => Promise<void>;
};

declare global {
  interface Window {
    ynxDesktopWallet?: DeveloperWalletBridge;
  }
}

const binding = Object.freeze({
  version: "1",
  chainId: "ynx_6423-1",
  requestingProduct: "developer",
  productClientId: "ynx-developer-v1",
  bundleId: "com.ynxweb4.developer.testnetpreview",
  productDeviceAlgorithm: "p256-sha256",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"]),
});

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Wallet protocol numbers must be safe integers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Wallet request is not canonical JSON.");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`).join(",")}}`;
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function desktopWalletBridge(): DeveloperWalletBridge | undefined {
  const candidate = window.ynxDesktopWallet;
  return candidate && typeof candidate.getProductDevicePublicKey === "function" && typeof candidate.openAuthorization === "function" ? candidate : undefined;
}

export async function openDeveloperWalletReview(bridge: DeveloperWalletBridge, now = new Date()) {
  const productDeviceKey = await bridge.getProductDevicePublicKey("ynx-developer-v1");
  if (!/^[A-Za-z0-9_-]{44}$/.test(productDeviceKey)) throw new Error("Developer product-device key is not canonical compressed P-256.");
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const request = Object.freeze({
    ...binding,
    productDeviceKey,
    nonce: base64url(crypto.getRandomValues(new Uint8Array(32))),
    purpose: "Sign in to YNX Developer and review one exact Testnet deployment.",
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const deepLink = `ynxwallet://authorize?request=${base64url(new TextEncoder().encode(canonicalJSON(request)))}`;
  await bridge.openAuthorization(deepLink);
  return Object.freeze({ status: "wallet-review-opened" as const, expiresAt: request.expiresAt });
}
