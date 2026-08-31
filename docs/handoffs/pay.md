# YNX Pay and Merchant Console handoff

## Source and status

- Branch: `codex/final-pay`
- Recovery base HEAD: `27b811cabcf16b663a085652412be01561195629`
- Current checkpoint commit: `2303ceeed6ff8e7a8606b87a2e7155702e4e27b1`
- Earlier preserved baseline: `ffb528b4971b5849ffb151a018263daf5c0e2cb0`
- Canonical Wallet dependency: `@ynx-chain/wallet-auth@1.0.0`, vendored from
  `efe827f467107e23482289a5b1f69ac9ff83e694`; tarball SHA-256
  `3feb86824135d5143e4e72e506d4efef9f530d3d931081c15500f16b1347bf2f`.
- Local implementation and production builds pass. Central integration,
  product staging, a fresh payment proof and current visual acceptance remain
  open; this handoff does not claim release completion.

## Authority and authentication boundaries

Pay and Merchant Console no longer implement a product-local Wallet verifier.
Both use the immutable canonical package for request parsing, Wallet approval,
callback verification, request digests and P-256 product-device challenges.
The product service accepts settlement, refund and dispute calls only with a
short-lived server-to-server Gateway assertion bound to method, escaped path,
body hash, account, session, device, Pay registry identity, scopes, request
digest, session binding, lifetime and persistent one-time nonce.

Merchant Console creates a 15-minute opaque product session only after the
central Gateway verifies the exact `pay-merchant` registry entry. Browser code
stores no bootstrap key, merchant HMAC credential, webhook secret or Gateway
assertion key. Roles are owner, finance, developer, support and viewer; every
route has an explicit permission and role changes invalidate old sessions. The
last active owner cannot be demoted.

The controller-ready registry and proxy contract is
`docs/integration/pay-card-wallet-registry.json`. It is intentionally marked
`integratedCentral=false`: central main does not yet contain these entries or
routes.

## Payment truth, receipts and operations

Invoices remain merchant Ed25519 signed. `committed` can be persisted only
after the central Pay API returns a matching paid record whose invoice, intent,
merchant, payout, payer, amount, asset, transaction hash, block and audit hash
match the Wallet-signed quote and result. UI state, submitted hashes and timers
cannot produce Paid.

The consumer app covers QR/manual/payment-link lookup, merchant/amount/fee/
network/expiry review, Wallet signing, pending/committed/failed/expired states,
authoritative receipts, history, refund, dispute and offline recovery. The
Merchant Console covers catalog, invoice/link/QR records, status and receipts,
refund/dispute cases, webhook rotation/retry, reconciliation CSV, analytics,
audit and review-only AI explanations.

Webhook delivery signs the persistent payload envelope, includes delivery ID,
timestamp, payload hash and secret version, persists retry/backoff state and
rejects replays. Secrets are encrypted at rest and never included in browser
snapshots or audit details. AI output cannot sign, pay, refund, approve a case,
change payout or rotate secrets; owner/finance approval is separately audited.

## Split Payment checkpoint on 2026-07-27

Split is no longer a documentation-only or unavailable capability. The Pay
service now persists a merchant-signed plan containing 2–20 immutable positive
shares. A canonical Wallet/Gateway session with `pay:settlement:submit` claims a
share and creates one authoritative child Invoice v4. The signed v4 material
binds `splitPaymentId`, `splitShareId` and an irreversible
`expectedPayerHash`; central settlement still compares the private raw account
and fails closed for a different payer. Public reads redact the payer account
while retaining the signed hash for independent verification; the authenticated
merchant state retains the raw account for audit and reconciliation.
The aggregate Split state is derived from the authoritative child Invoice
states and cannot become committed from a claim, UI event or webhook. The Pay
app at `a405604714645df1084ed9e06cc7d7b6f9a4d4b0` now exposes the complete local
consumer flow: strict Invoice/Split lookup, QR and deep links, signed plan review,
12-language and Arabic RTL share selection, secure pending-claim recovery,
automatic continuation after Wallet authentication, and child Invoice v4 review.

## Quant and service billing checkpoint on 2026-07-27

Quant billing no longer accepts a frontend-calculated or manager-declared PnL. An owner or finance merchant session can create a service bill only from an Ed25519-signed external ledger envelope whose key ID is present in the configured verifier registry. Pay validates source/version/as-of/expiry, subtracts net external capital flows, recomputes the high-water-mark base, eligible profit, performance fee, fixed compute/data/subscription/management fees and the new high-water mark with bounded integer arithmetic, and rejects stale, tampered, unapproved or overflowing evidence.

The resulting merchant-signed Invoice v5 binds `serviceBillId`, `serviceEvidenceDigest` and `expectedPayerHash`. Raw payer accounts remain private; public Quant bills retain the external and Invoice-domain payer hashes, evidence signature/digest and complete fee breakdown. Authoritative settlement from a different payer fails closed. The Pay app independently verifies the accepted public key, evidence SHA-256 digest, Ed25519 signature, every calculation and the Invoice v5 binding before it enables Wallet review, and presents the fee breakdown in all 12 supported locales including Arabic RTL. Without an accepted verifier key, the capability is explicitly unavailable.

## Store recovery checkpoint on 2026-07-27

Source commit `2303ceeed6ff8e7a8606b87a2e7155702e4e27b1` adds strict future snapshot-version rejection, exact-byte store decoding and fsync-backed atomic persistence. The `ynx-pay-store` operator CLI verifies snapshots, creates new immutable `0600` backups, and performs offline restore from one validated source read. A valid current destination is preserved as a verified hash-addressed rollback artifact; a corrupt destination is preserved byte-for-byte as quarantine evidence and is never described as rollback-valid.

Fixture tests migrate missing recurring/Split/Quant maps, discard removed product-local Wallet challenges/sessions, normalize legacy failed webhooks to dead letters, preserve Invoice v1 compatibility, execute rollback, and reject corrupt sources, wrong keys, future versions, live-store backup targets and existing backup paths. The local drill does not claim production-volume RTO/RPO, remote retention/replication or Windows directory-fsync parity.

Canonical integration files are now:

- `release/integration/pay-contract.json`
- `docs/pay/INTEGRATION_HANDOFF.md`
- `docs/pay/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/pay/DEPENDENCY_ACCEPTANCE.md`
- `docs/integration/pay-quant-billing.json`
- `docs/integration/pay-store-recovery.json`
- `.ai-bridge/full-goal-coverage.json`

## Verification completed on 2026-07-27

- `go test ./internal/payproduct/... -count=1`: passed.
- `go test -race ./internal/payproduct/... -count=1`: passed; the macOS linker
  emitted a non-fatal `LC_DYSYMTAB` warning.
- Split signature, tamper, replay, scope, wrong-payer, public-redaction,
  merchant-audit and aggregate-state tests passed.
- `npm run check` in `apps/pay`: TypeScript passed, 13/13 tests passed,
  and Android/iOS Hermes bundles exported with Invoice v4/v5, strict Split/Quant
  reference parsing, secure Split recovery, external Quant signature/digest/math
  verification and 12-language fee review.
- Store migration, immutable backup, verified restore/rollback, corrupt-destination quarantine, corrupt/wrong-key/future-version rejection and operator CLI fail-closed tests passed.
- `go vet ./internal/payproduct/...`: passed.
- `make pay-api-check` and `bash internal/payproduct/smoke.sh`: passed.
- `go test ./... -count=1` is not fully green because unchanged
  Consensus/Faucet/Trust permission tests fail in this host environment and
  unchanged IDE tests require a missing generated contract artifact. The Pay
  package passed in that repository-wide run.

## Historical verification completed on 2026-07-19

- `go test -race ./internal/payproduct/... ./internal/cardproduct/... -count=1`
- `go test ./... -count=1`
- `bash internal/payproduct/smoke.sh`
- Merchant Console: 7 tests, production build, zero npm vulnerabilities.
- Pay: TypeScript check, 6 tests, Android/iOS Hermes exports.
- Android Pay release: lint vital and release assembly passed; SHA-256
  `14698734aef4d1d5b4b33eedae328d3fcfd37c161a949bd2a89ff3419bc15a44`,
  102623957 bytes, debug/test certificate only, minimum SDK 24.
- Full repository environment, placeholder and secret scans plus central
  `pay-api-check` passed.
- Public read-only checks returned HTTP 200 for RPC, Faucet and central Pay;
  they prove the chain is healthy, not that this product branch is deployed.

## Evidence and blockers

The prior proof in `internal/payproduct/proof/live-testnet-payment.json` remains
historical evidence from 2026-07-16 and is not presented as this version's
required fresh payment. The operator harness now uses only central Gateway
session and proxy routes; it no longer calls the removed product-local Wallet
route or uses a browser merchant secret.

Fresh proof is blocked because public central Gateway product routes are not
deployed and the local controller branch has not accepted the registry. The
public `gateway.ynxweb4.com/health` returns deployment-not-found, and available
local SSH keys were rejected by the primary node. Android re-install testing
also hit emulator system death (`DeadSystemException`, package/activity services
disappeared); the observed ANR screenshot is retained as failure evidence, not
as an install pass. iOS Hermes exports pass and a macOS simulator build job is
now in CI, but this host has no Xcode runtime.

Do not set integratedCentral, deployedStaging, installedLocal for the current
artifacts, downloadHosted, productionSigned or storeReleased to true until the
corresponding evidence exists.
