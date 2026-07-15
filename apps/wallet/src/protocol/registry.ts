import type { ProductBinding } from "@ynx-chain/wallet-auth";

// Product-local review copy. The main integration task must reconcile this with
// the central Gateway registry; Wallet never accepts a callback outside it.
export const PRODUCT_REGISTRY: Readonly<Record<string, ProductBinding>> = Object.freeze({
  "ynx-social-v1": Object.freeze({
    requestingProduct: "social",
    bundleId: "com.ynxweb4.social",
    callbacks: Object.freeze(["ynxsocial://wallet-auth/callback"]),
    scopes: Object.freeze(["account:read", "profile:link"]),
    maxScopes: 2,
  }),
});

export const SCOPE_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  "account:read": "Share this account's public ynx1 address. No secret or recovery material leaves Wallet.",
  "profile:link": "Allow this exact Social device to link the public account to its profile.",
});
