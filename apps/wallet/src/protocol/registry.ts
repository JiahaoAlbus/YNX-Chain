import { parseCentralRegistryEntry, registryParserBinding, type ProductBinding } from "@ynx-chain/wallet-auth";

// Wallet-side reviewed tuples. Central registry deployment remains a separate
// gate: this exact local allow-list only decides which requests Wallet may show.
const REVIEWED_ENTRIES = [
  {
    schemaVersion: 2, productClientId: "ynx-card-v1", requestingProduct: "ynx-card",
    bundleId: "com.ynxweb4.card", callbacks: ["ynxcard://wallet-auth/callback"],
    scopes: ["account:read", "card:application:write", "card:controls:write", "card:dispute:write"], maxScopes: 4,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-pay-v1", requestingProduct: "pay",
    bundleId: "com.ynxweb4.pay", callbacks: ["ynxpay://wallet-auth/callback"],
    scopes: ["account:read", "pay:case:create", "pay:settlement:submit"], maxScopes: 3,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-social-v1", requestingProduct: "social",
    bundleId: "com.ynx.social", callbacks: ["ynx-social://com.ynx.social"],
    scopes: ["account:read", "profile:link"], maxScopes: 2,
    productDeviceAlgorithms: ["p256-sha256"],
  },
] as const;

export const PRODUCT_REGISTRY:Readonly<Record<string,ProductBinding>>=Object.freeze(Object.assign({},...REVIEWED_ENTRIES.map((entry)=>registryParserBinding(parseCentralRegistryEntry(entry)))));

export const SCOPE_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  "account:read": "Share this account's public ynx1 address. No secret or recovery material leaves Wallet.",
  "card:application:write": "Create or update only this account's sandbox Card application.",
  "card:controls:write": "Manage only this account's Card controls after a separate review.",
  "card:dispute:write": "Create and update this account's Card disputes; it cannot move funds.",
  "pay:case:create": "Create a Pay support case for this account without authorizing a transfer.",
  "pay:settlement:submit": "Submit a settlement request for separate Pay review; Wallet approval is not a payment signature.",
  "profile:link": "Allow this exact Social device to link the public account to its profile.",
});
