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
    schemaVersion: 2, productClientId: "ynx-developer-v1", requestingProduct: "developer",
    bundleId: "com.ynxweb4.developer.testnetpreview", callbacks: ["ynxdeveloper://wallet-auth/callback"],
    scopes: ["account:read", "developer:deploy"], maxScopes: 2,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-dex-web-v1", requestingProduct: "dex",
    bundleId: "com.ynxweb4.dex.web", callbacks: ["https://dex.ynxweb4.com/wallet-auth/callback"],
    scopes: ["account:read", "dex:positions:read", "dex:transaction:request"], maxScopes: 3,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-exchange-v1", requestingProduct: "exchange",
    bundleId: "com.ynxweb4.exchange", callbacks: ["https://exchange.ynxweb4.com/wallet-auth/callback", "ynxexchange://wallet-auth/callback"],
    scopes: ["exchange:ai", "exchange:deposit", "exchange:read", "exchange:trade", "exchange:withdrawal-review"], maxScopes: 5,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-finance-v1", requestingProduct: "finance",
    bundleId: "com.ynxweb4.finance", callbacks: ["ynxfinance://wallet-auth/callback"],
    scopes: ["finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"], maxScopes: 4,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-merchant-console-v1", requestingProduct: "pay-merchant",
    bundleId: "com.ynxweb4.merchant-console", callbacks: ["https://pay.ynxweb4.com/merchant/wallet-auth/callback"],
    scopes: ["account:read", "merchant:session:create"], maxScopes: 2,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-pay-v1", requestingProduct: "pay",
    bundleId: "com.ynxweb4.pay", callbacks: ["ynxpay://wallet-auth/callback"],
    scopes: ["account:read", "pay:case:create", "pay:settlement:submit"], maxScopes: 3,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-quant-v1", requestingProduct: "quant",
    bundleId: "com.ynxweb4.quant", callbacks: ["https://quant.ynxweb4.com/wallet-auth/callback", "ynxquant://wallet-auth/callback"],
    scopes: ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"], maxScopes: 4,
    productDeviceAlgorithms: ["p256-sha256"],
  },
  {
    schemaVersion: 2, productClientId: "ynx-shop-v1", requestingProduct: "shop",
    bundleId: "com.ynxweb4.shop", callbacks: ["ynxshop://wallet-auth/callback"],
    scopes: ["account:read", "shop:orders:write", "shop:profile:write"], maxScopes: 3,
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
  "developer:deploy": "Allow Developer to prepare an exact Testnet deployment for a separate Wallet review. This session cannot sign, broadcast or bypass the final transaction approval.",
  "dex:positions:read": "Read only this account's indexed DEX liquidity positions after a live central session check.",
  "dex:transaction:request": "Prepare an exact swap or liquidity action for a separate Wallet review. DEX cannot sign or broaden the action.",
  "exchange:ai": "Allow Exchange to create reviewable AI drafts; AI cannot sign, trade, deposit or withdraw.",
  "exchange:deposit": "Read and reconcile this account's Testnet deposit evidence; this approval is not a transfer signature.",
  "exchange:read": "Read this account's Exchange balances, orders, trades and audit evidence.",
  "exchange:trade": "Submit bounded Testnet order requests for separate Exchange checks; Wallet approval is not order execution.",
  "exchange:withdrawal-review": "Create a withdrawal review request; a separate native transfer signature is still required to move YNXT.",
  "finance.ai.draft": "Create reviewable Finance drafts from only the records selected by this account; drafts cannot execute actions.",
  "finance.pay.read": "Read this account's verified Pay receipt evidence without creating or signing a payment.",
  "finance.portfolio.read": "Read this account's public YNXT balance and indexed activity from approved sources.",
  "finance.profile.write": "Manage only this account's private Finance categories, budgets, notes and reminders.",
  "merchant:session:create": "Create a short-lived, device-bound session for one authorized merchant role. This cannot sign payments, refunds or settlements.",
  "pay:case:create": "Create a Pay support case for this account without authorizing a transfer.",
  "pay:settlement:submit": "Submit a settlement request for separate Pay review; Wallet approval is not a payment signature.",
  "profile:link": "Allow this exact Social device to link the public account to its profile.",
  "quant:account": "Share this account's public address with Quant for account-bound research controls.",
  "quant:mandate:create": "Create a bounded Testnet Quant mandate for later review; it does not execute an order.",
  "quant:mandate:execute": "Request execution of an already bounded mandate; execution remains unavailable until its owner transport is accepted.",
  "quant:mandate:revoke": "Revoke this account's Quant mandate and prevent later use.",
  "shop:orders:write": "Create and update this account's Testnet Shop orders; payment still requires a separate Wallet signature.",
  "shop:profile:write": "Manage only this account's Shop profile, addresses and privacy choices.",
});
