# YNX Shop 0.2.0 Testnet Preview release notes

## 2026-07-27 current-source checkpoint

Current source: `ef97eadea90e2b6f4f24225c52e6093b5d5de567`

- Added buyer data export and deletion to Commerce API, Web/PWA, Android source and iOS source.
- Deletion requires the exact phrase `DELETE_MY_SHOP_DATA` and refuses to run while any order is active.
- Terminal orders retain only pseudonymized commerce records plus unchanged authoritative public-chain settlement and integrity evidence.
- Added bounded Node fallbacks for Placeholder and Secret scanning so missing ripgrep cannot produce a false success.
- Commerce race tests, buyer Web tests/build, native static verification, scanner tests and both scans pass locally.
- Current Android build is blocked by missing Android SDK configuration; current iOS build is blocked by the absence of full Xcode and Simulator.
- Current source is not centrally integrated, staged, hosted, production signed or store released. Existing Staging and downloads remain evidence for the prior source below.

Integration contract: `release/integration/ynx-shop-contract.json`

Coverage matrix: `.ai-bridge/full-goal-coverage.json`

## Preserved 2026-07-18 preview

Release source: `38e2f68deb91d5f26e5aeec2318e260cd0742115`

Release date: 2026-07-18

## Buyer

- Image-first search/category/product/bag/checkout/orders flow across Web/PWA and native Android/iOS source.
- Persistent profile/address/cart, inventory reservation, exact Pay handoff and settlement checking, order cancellation, fulfillment/delivery, reviews, returns, refund requests, disputes, and restart recovery.
- Timeline exposes payment, shipment, delivery, return, refund, and dispute events without fake carrier or payment claims.
- PWA manifest/service worker and generated raster app icons; portable root/staging scope.

## Seller

- Onboarding, store profile/policy, media-backed catalog drafts, explicit publish/unpublish, immutable product revisions, inventory, orders, manual fulfillment, returns/refunds, settlements, staff roles, and audit.
- Owner, manager, fulfillment, support, and viewer policies; support cannot approve money, viewer is read-only.
- Sidebar/table/timeline operations UI replaces the KPI-card wall.

## Trust boundaries

- Web bearer persistence was removed. Wallet uses separate Shop/Seller v2 clients, bundles, callbacks, scopes, non-exportable P-256 product-device proof, and central introspection.
- Authenticated state HMAC envelope, fail-closed tamper/wrong-key behavior, atomic write, verified backup, and recovery flag.
- Paid/refunded require exact committed Pay evidence. Trust receives only a bounded digest/summary and cannot move YNXT. AI is permissioned, reviewed, draft-only, cancellable, retryable, and deletable.
- Tax and carrier integrations remain explicitly unavailable/manual-unverified.

## Availability

- Buyer staging: `https://web4.ynxweb4.com/shop-staging/`
- Seller staging: `https://web4.ynxweb4.com/seller-staging/`
- API health/version: `https://web4.ynxweb4.com/shop-api-staging/{health,version}`
- Android APK: `https://web4.ynxweb4.com/shop-staging/ynx-shop-0.2.0-testnet-preview.apk`

Central Wallet product registrations and a Shop-specific Pay merchant/payout are not deployed. Authenticated order/refund acceptance therefore remains blocked and fails closed; this release does not claim public/store/production readiness.
