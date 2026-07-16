# YNX Pay handoff

## Delivery

- Branch: `codex/ecosystem-pay`
- Baseline: `51bed843`
- Owned paths only: `apps/pay/**`, `apps/merchant-console/**`, `internal/payproduct/**`, `docs/handoffs/pay.md`
- Central Pay API and Gateway policy were not modified.
- Acceptance date: 2026-07-17 (Asia/Shanghai).

## Completed product boundary

`internal/payproduct` is a persistent product service layered on the central Pay
API. It owns merchant onboarding, catalog and signed invoices, Wallet/Gateway
sessions, refund/dispute requests, webhook delivery, reconciliation, analytics,
audit and bounded AI runs. The product merchant ID remains local and audited;
`YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID` identifies the merchant bound to the
central credential used for authoritative intent, invoice and settlement calls.

An invoice becomes `committed` only after the central Pay API returns `paid`
evidence whose invoice, intent, central merchant, payout address, amount, asset,
transaction hash, block number and audit hash match the signed local record. A
UI action, timer, submitted hash or proof harness cannot create paid state.

The independent native Pay app provides QR/manual/deep-link lookup, strict
Wallet authorization, Gateway completion, payment review, pending/committed/
failed/expired states, evidence-backed receipts, refunds and disputes. The Web
Merchant Console has separate operations for onboarding, catalog/invoices,
transactions, webhooks/retries, reconciliation/CSV, cases, AI review, security
and audit. Both fail closed if the product URL is not configured; neither falls
back to the central API.

Cross-chain settlement remains explicitly `unavailable` because no approved
live bridge route was supplied.

## Security and resilience

- JSON state uses atomic replacement plus HMAC integrity verification; restart
  and tamper behavior are tested.
- Merchant requests sign method, path, body hash, timestamp and nonce; expiry,
  idempotency, nonce replay and cross-merchant access are tested.
- Wallet sign-in binds a low-S secp256k1 YNX signature and an Ed25519 device
  signature to a one-time challenge. Gateway completion is P-256 and exact
  product, bundle, scope, session and expiry bound.
- Go and TypeScript now share sorted-key canonical JSON. The fixed cross-runtime
  request digest is
  `b984b0360a06b93e6c269ff79c86022d47aaea7cdee434a1ed6b72eb20e18ebd`.
- Merchant invoices are Ed25519-signed. Settlement accepts only an exact
  quote-bound Wallet payment result and rechecks the authoritative transaction.
- Webhook HMAC material is `YNX_PAY_WEBHOOK_V1`, delivery ID, exact timestamp
  and payload hash. Timestamp, payload and signature are generated from the same
  persisted envelope. Attempts, retry backoff, secret version and terminal
  delivery state survive restart; receiver replay rejection uses delivery ID.
- Stored merchant credentials and webhook secrets are AES-GCM encrypted and are
  absent from snapshots, exports and audit payloads.
- AI can explain or draft only. It cannot sign, pay, refund, change payout or
  webhook secrets, or approve a dispute. A provider-backed unit acceptance test
  proves human review is audited while the invoice remains pending with no
  settlement.

## Real YNX Testnet payment proof

The operator acceptance harness used cryptographic Wallet/Gateway requests and a
real native YNXT transfer through an SSH tunnel to the public-testnet backend.
It did not inject or simulate `paid`. The public RPC independently returned the
same transaction and committed block.

- Network: `ynx_6423-1` / chain ID 6423 / asset YNXT
- Product merchant: `mrc_83e49711c8235a75bd2a`
- Payer: `ynx13mn60llmjqdrj90f7kmud80pcs7ds59qf9cl7m`
- Payout: `ynx132d04zndz4znc6643yccg8y5xzjvnrxs7mtklu`
- Product invoice: `inv_21cf3d36775cce48deb4`
- Central invoice: `a015f6dea5c652d791dc68db`
- Intent: `00a0a7f9beaeb3784c4039c3`
- Amount and fee: 7 YNXT + 1 YNXT
- Transaction: `0x046e2db6d3fa0211e104abef9c8ef419873c4944561063b48d3bc05baa553c12`
- Committed block: 226048
- Settlement: `80e81ec0dfd045199e619eba`
- Authoritative audit hash:
  `c136d70eb465b284f43d2cb64e1d143ba4a1448acb7c2c588e518210a4065f78`
- Refund request: `rfr_acf2a991d770563f1b90`, 2 YNXT, `requested`
- Dispute: `dsp_8c79282b358b30f92522`, `open`, bound to the transaction
- Webhook: `whd_dd31ab83a047599f9154`, delivered attempt 1, signed payload
- Reconciliation: one committed payment, gross 7 YNXT; CSV contains invoice and
  transaction; merchant nonce replay was rejected.

The sanitized machine-readable record is
`internal/payproduct/proof/live-testnet-payment.json`.

## Native and Web acceptance

- Twelve locales are audited in both products: English, Simplified Chinese,
  Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese,
  Russian, Arabic and Indonesian. Payment/refund/dispute/authorization/AI
  authority strings are complete and semantically tested; Arabic uses RTL.
- Merchant Web: browser-verified at 1280x720 in Simplified Chinese and 390x844
  in Arabic RTL. Body and scroll widths matched at both sizes, the mobile rail
  collapsed, and there were no console warnings/errors. Screenshots are in
  `apps/merchant-console/proof/`.
- Android release variant: built under JDK 17, installed on `emulator-5562`,
  cold-launched as `com.ynxweb4.pay/.MainActivity`, and rendered the YNX Testnet
  payment UI with no fatal/React errors. APK SHA-256:
  `a0c4c6919042754eb898ab78b06307bcf458965f1e766ac75f0ad9a8e4613934`.
- The local acceptance APK uses debug signing. It is not represented as
  store-signed or production-distributable. iOS native sources and production
  JS export pass, but App Store signing/install was not available on this host.

## Verification gates

Completed on 2026-07-17:

- `go test -race ./internal/payproduct/... -count=1`
- `bash internal/payproduct/smoke.sh`
  - Pay product Go tests
  - Merchant Console record/i18n tests and production build
  - Pay app TypeScript/i18n/Wallet tests and Android/iOS Expo exports
- `go test ./... -count=1`
- Android `:app:assembleDebug` and `:app:assembleRelease`
- Merchant Web desktop/mobile/RTL browser acceptance
- Real YNX Testnet proof plus independent public RPC transaction lookup
- `make pay-api-check`, `make no-placeholder-check`, `make secret-scan`,
  `make env-check`, and `git diff --check`

## Live AI status and truthful external boundaries

The live YNX AI Gateway is configured with `gpt-4.1-mini`, but its provider
returned HTTP 429 during acceptance. The recorded run
`air_7DH-Znlamqu0uiso` is honestly `provider_failed`; no explanation, approval or
financial action was fabricated. Local provider-backed tests cover explanation,
human review/audit and the no-financial-execution boundary.

The product service and frontends are not claimed as publicly deployed by this
branch. Remaining release-owner work is limited to:

1. Deploy `ynx-pay-productd` with persistent state, reverse proxy, central
   credential, `YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID`, integrity/encryption keys,
   least-privilege Gateway bindings and CORS.
2. Configure `EXPO_PUBLIC_YNX_PAY_URL` and `globalThis.YNX_PAY_API_URL`, then
   publish the merchant static build and consumer deep-link domain.
3. Restore AI provider quota/access and rerun live provider-backed approval.
4. Supply production Android/iOS signing, store ownership and physical-device
   acceptance.
5. Keep cross-chain settlement unavailable until an approved live route exists.
