# YNX Pay handoff

## Delivery

- Branch: `codex/ecosystem-pay`
- Baseline: `51bed843`
- Product implementation commit: `248c21f`
- Owned paths only: `apps/pay/**`, `apps/merchant-console/**`, `internal/payproduct/**`, `docs/handoffs/pay.md`
- Central Pay API and Gateway policy were not modified.

## Implemented product boundary

`internal/payproduct` is a persistent product service layered on the central Pay API. It owns merchant onboarding, catalog and signed invoice records, wallet challenges and sessions, refund/dispute requests, webhook delivery, reconciliation, analytics, audit, and bounded AI runs. It calls the central API for chain-backed payment intent, invoice, settlement, and refund operations instead of reimplementing central policy.

An invoice becomes committed only after the central Pay API returns `paid` evidence whose invoice, intent, merchant, payout address, amount, asset, transaction hash, block number, and audit hash all match the locally signed record. A UI action, polling timer, or locally supplied transaction hash cannot create paid state.

The consumer app provides QR/manual/deep-link lookup, signed-in YNX Wallet review, reject/pending/committed/failed/expired states, an evidence-backed receipt, refund and dispute requests, and trust evidence. The merchant console uses a separate operations information architecture for onboarding, catalog/amount invoices, transactions, webhooks, retries, reconciliation/export, cases, settlements, audit, and real-record analytics.

Cross-chain settlement is explicitly `unavailable` in the service health response and both product surfaces because no approved live bridge route was supplied.

## Security and resilience

- JSON persistence uses atomic replacement and HMAC integrity verification; restart and tamper behavior are tested.
- Merchant API requests use timestamped HMAC signing over method, path, nonce, and body hash; expired requests and nonce replay are rejected.
- Wallet sign-in binds a secp256k1 YNX account signature and an Ed25519 device signature to a one-time, expiring challenge.
- Merchant invoices use Ed25519 signatures and expose the verification key to the consumer app.
- Webhooks use a separate rotatable HMAC secret, delivery IDs, timestamped signatures, retry backoff, persistent attempts, and an automatic retry worker.
- Idempotency keys cover onboarding, catalog items, invoices, refund requests, and disputes; invoice concurrency is locked and tested.
- Stored merchant credentials and webhook secrets are AES-GCM encrypted. Secret material is excluded from merchant snapshots, exports, and audit payloads.
- AI workflows accept allow-once permission, explicit context-record IDs, streaming cancellation, review decisions, and persistent audit. AI can explain or draft only; it cannot sign, pay, refund, change payout addresses or webhook secrets, or approve disputes.

## Verification evidence

Completed locally on 2026-07-15:

- `go test -race ./internal/payproduct`
- `bash internal/payproduct/smoke.sh`
  - Pay product Go smoke
  - merchant console tests and production Web build
  - consumer TypeScript tests and Android/iOS Expo production exports
- `go test ./...` after the repository's required contract artifact and selector generation
- `make pay-api-check`
- `make no-placeholder-check`
- `make secret-scan`
- `make env-check`
- `git diff --check`
- Android native debug build under JDK 17: `:app:assembleDebug` succeeded; APK SHA-256 `781a36f49b8b62eb8dde9f78bce64008239cb4dcb31d2941df8d7360794f61ec`
- Merchant Web visual QA at 1440x960 and 390x844: onboarding and authentication layouts were usable, mobile width had no horizontal overflow, and browser console errors/warnings were empty.

Read-only public checks at 2026-07-15 21:12 UTC observed:

- `https://pay.ynxweb4.com/health`: YNX Testnet chain ID 6423, YNXT, authoritative upstream, current public Pay build `0d31850f74b2`.
- `https://rpc.ynxweb4.com/status`: height 189853, persistent public testnet, four ready validators, and `mainnetReady:false`.

These public checks validate the current central testnet dependency only. This new product service and its frontends are not claimed as publicly deployed by this branch.

## Integration requests for the main thread

1. Add the `ynx-pay-productd` deployment unit, persistent state path, reverse-proxy route, and secret intake for the central Pay API credential plus product integrity/encryption keys.
2. Register least-privilege Pay Consumer and Merchant Console Gateway bindings and CORS origins. No policy change was made in this branch.
3. Reconcile the temporary `ynxwallet://` deep-link adapter with Task 1's shared `packages/wallet-auth` strict protocol when that owned package lands.
4. Register the four AI scopes and configure the approved YNX AI Gateway provider/model. Without that external configuration, runs fail honestly as `provider_unavailable`.
5. Deploy the merchant static build and configure the consumer `EXPO_PUBLIC_PAY_PRODUCT_URL`, public invoice/deep-link domain, and trust-evidence links.
6. Supply release signing, store ownership, device acceptance coverage, and production webhook receiver evidence before calling the consumer app store-ready.

## Honest remaining external acceptance

- A real testnet payment through deployed product URLs still requires deployment credentials and a payer wallet; this branch does not fabricate that evidence.
- External webhook receipt/retry evidence requires a real merchant endpoint.
- Successful live AI output requires the approved provider, quota, scopes, and model.
- Store-signed Android/iOS releases and physical-device acceptance remain release-owner work; local Android native debug and both Expo platform builds pass.
- Cross-chain settlement remains unavailable until a real approved bridge route exists.
