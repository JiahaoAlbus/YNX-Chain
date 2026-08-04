import { p256 } from "@noble/curves/nist.js";

export const NOW = new Date("2026-07-15T12:00:00.000Z");
export const PRODUCT_DEVICE_SECRET = Buffer.alloc(32, 0x42).toString("base64url");
export const PRODUCT_DEVICE_KEY = Buffer.from(p256.getPublicKey(Buffer.alloc(32, 0x42), true)).toString("base64url");
export const ACCOUNT_SECRET = `${"00".repeat(31)}01`;
export const REGISTRY = Object.freeze({
  "ynx-social-v1": Object.freeze({
    requestingProduct: "social",
    bundleId: "com.ynx.social",
    callbacks: Object.freeze(["ynx-social://com.ynx.social"]),
    scopes: Object.freeze(["account:read", "profile:link"]),
    maxScopes: 2,
  }),
});

export function request(overrides = {}) {
  return {
    version: "1",
    nonce: "nonce_abcdefghijklmnopqrstuvwxyz12",
    chainId: "ynx_6423-1",
    requestingProduct: "social",
    productClientId: "ynx-social-v1",
    bundleId: "com.ynx.social",
    productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: PRODUCT_DEVICE_KEY,
    callback: "ynx-social://com.ynx.social",
    scopes: ["account:read", "profile:link"],
    purpose: "Link this YNX account to the selected Social profile on this device.",
    issuedAt: "2026-07-15T11:59:00.000Z",
    expiresAt: "2026-07-15T12:04:00.000Z",
    ...overrides,
  };
}
