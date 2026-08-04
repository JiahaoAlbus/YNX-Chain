# YNX Shop Testnet Preview

YNX Shop is the buyer marketplace for YNXT on `ynx_6423-1`. The current preview is available at `https://web4.ynxweb4.com/shop-staging/`; sellers use the separate console at `https://web4.ynxweb4.com/seller-staging/`.

## Buyer flow

1. Sign in through YNX Wallet. Shop never asks for or stores a recovery key.
2. Search or filter published products, inspect seller policy and Trust links, select a variant, and add it to the persistent cart.
3. Review the address and create an order. Inventory is reserved while the order remains payment-pending.
4. Continue to YNX Pay. Shop displays paid only after exact committed settlement evidence matches the invoice, merchant, payout, payer, amount, currency, transaction hash, audit hash, and block height.
5. Follow manual shipment and delivery events in the order timeline. Manual carrier/tracking entries are seller-provided, not carrier proof.
6. Review, return, request a refund, or open a dispute. Refunded requires committed Pay refund evidence; Trust handles evidence/cases only and cannot move YNXT.

Tax and external carrier integrations currently show unavailable. AI comparison/support/return text is a permissioned draft that a person must review; AI cannot buy, publish, change price or inventory, approve a refund, or change policy.

## Android preview

Download the Testnet Preview APK from `https://web4.ynxweb4.com/shop-staging/ynx-shop-0.2.0-testnet-preview.apk`.

- SHA-256: `0df56042b944f74540be437e314f6331afcb4f9674342d63b1922fbdab7c435f`
- Size: 78,639 bytes
- Minimum Android: API 26
- Signing: ephemeral Testnet Preview RSA-3072 key; not a production/store signature

Verify the hash before sideloading. This build is not store released.

## Current limitation

The deployed central Gateway has not yet registered the separate Shop and Seller Wallet clients. Staging therefore presents the catalog and truthful availability states, but authenticated flows fail closed until that central patch is deployed. No local account or fallback bearer is created.
