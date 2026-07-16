import { parseCentralRegistryEntry, registryParserBinding } from "@ynx-chain/wallet-auth";

// Product-local review copy. The main integration task must reconcile this with
// the central Gateway registry; Wallet never accepts a callback outside it.
export const SOCIAL_REGISTRY_ENTRY = parseCentralRegistryEntry({
  schemaVersion: 2,
  productClientId: "ynx-social-v1",
  requestingProduct: "social",
  bundleId: "com.ynxweb4.social",
  callbacks: ["ynxsocial://wallet-auth/callback"],
  scopes: ["account:read", "profile:link"],
  maxScopes: 2,
  productDeviceAlgorithms: ["p256-sha256"],
});

export const PRODUCT_REGISTRY = registryParserBinding(SOCIAL_REGISTRY_ENTRY);

export const SCOPE_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  "account:read": "Share this account's public ynx1 address. No secret or recovery material leaves Wallet.",
  "profile:link": "Allow this exact Social device to link the public account to its profile.",
});
