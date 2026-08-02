# YNX Pay integration handoff

## Ownership and source

- Product owner: `04-pay`
- Branch: `codex/final-pay`
- Source commit: `6cbac9f4654b5715d32f1e561819e593c868a6f1`
- Owner validation PR: `#29` (draft; exact-source CI and unsigned Simulator evidence)
- Canonical machine contract: `release/integration/pay-contract.json`
- Central freeze owner: `29-integration`

This handoff describes implemented and locally tested Pay contracts. It does not claim that central Wallet/Gateway routes, Testnet deployment, public artifacts, production signing, or stores are complete.

## Canonical dependencies

Pay consumes, but does not redefine:

- Wallet identity, approval, product session, expiry and revoke from `02-wallet-auth`.
- authoritative chain settlement and finality from `01-chain-core`.
- FX, stablecoin reference and market-data freshness from `19-oracle-market-data`.
- cross-chain lifecycle from `21-bridge-interoperability`.
- canonical business events and billing ledger from `26-data-fabric-billing-ledger`.
- release, secret and artifact policy from `30-security-sre-release`.

The required Wallet registry entry remains `ynx-pay-v1`, bundle `com.ynxweb4.pay`, callback `ynxpay://wallet-auth/callback`, and the ordered scope set recorded in `pay-card-wallet-registry.json`.

## Payment truth

An Invoice becomes `committed` only after the authoritative central Pay API returns matching evidence for invoice, intent, merchant, payout address, payer constraints, asset, amount, transaction hash, block, idempotency and audit hash. UI state, a submitted transaction hash, a webhook, a route quote or a Split claim cannot produce Paid.

Invoice signatures preserve v1, v2 and v3 verification. Invoice v4 adds signed Split bindings:

- `splitPaymentId`
- `splitShareId`
- `expectedPayerHash`

A Split Payment is merchant-signed and contains 2–20 immutable positive shares. Claiming a share requires a valid Pay product session with `pay:settlement:submit`. The claim creates one authoritative child Invoice for that share and binds settlement to the claiming Wallet account. The signed public Invoice carries an irreversible payer-binding hash so its signature remains independently verifiable; public responses redact the raw account, while the authenticated merchant audit view retains it. A wrong payer, altered share, replay, missing scope, expired Split, or conflicting claim fails closed.

Invoice v5 adds externally verified service-billing bindings:

- `serviceBillId`
- `serviceEvidenceDigest`
- `expectedPayerHash`

Quant/service billing consumes an Ed25519-signed evidence envelope from an explicitly configured `08-quant-lab` / `26-data-fabric-billing-ledger` verifier. Pay removes net external capital flows, independently recomputes the high-water-mark base, eligible profit, performance fee and new high-water mark using bounded integer arithmetic, and rejects stale, tampered, unapproved or overflowing evidence. Frontend- or manager-declared PnL is never accepted. Public bills redact the raw payer while preserving signed Quant and Invoice payer hashes, the evidence signature/digest and the complete fee breakdown. Without an accepted verifier key, the capability is unavailable rather than downgraded.

## Endpoints added by this checkpoint

| Method | Path | Boundary |
|---|---|---|
| POST | `/v1/merchant/split-payments` | Merchant `invoice` permission |
| GET | `/v1/split-payments/{id}` | Public read, payer account redacted |
| POST | `/v1/split-payments/{id}/shares/{shareId}/claim` | Canonical Wallet/Gateway session; `pay:settlement:submit` |
| POST | `/v1/merchant/quant-bills` | Merchant owner/finance; accepted external evidence required |
| GET | `/v1/quant-bills/{id}` | Public read; raw payer redacted, signed evidence retained |

## Migration and compatibility

Snapshots that predate recurring drafts, Split Payments or Quant billing omit their corresponding maps; normalization creates empty maps without modifying existing merchants, invoices, receipts or audit entries. Removed product-local Wallet challenges/sessions are dropped and must be re-established through the canonical Gateway. Legacy failed webhooks become dead letters. Invoice v1–v3 signing material is unchanged; Split child Invoices are v4 and externally verified service invoices are v5. Snapshot envelope/version/HMAC checks fail closed, future snapshot versions are rejected, and persistence uses same-directory file fsync, atomic rename and non-Windows directory fsync. The source-bound offline backup/restore contract is `docs/integration/pay-store-recovery.json`.

## Verification

Passing locally, with exact-source CI evidence updated on 2026-07-30:

- `go test ./internal/payproduct/... -count=1`
- `go test -race ./internal/payproduct/... -count=1`
- Split signature and tamper rejection
- Split claim scope enforcement and idempotency
- child Invoice v4 binding
- wrong-payer settlement rejection
- public payer redaction and merchant audit retention
- aggregate `partially_paid` state
- external Ed25519 Quant evidence verification and verifier-registry fail-closed behavior
- net-flow-adjusted high-water-mark calculation and deposit exclusion
- Invoice v5 service-bill/evidence/payer binding and wrong-payer rejection
- owner/finance Quant RBAC and public raw-payer redaction
- client evidence digest/signature/math verification, 13/13 tests and 12-language fee review
- fixture-based forward migration, legacy Wallet-session removal and failed-webhook dead-letter normalization
- immutable `0600` backup, SHA/bytes/record receipt and no-overwrite behavior
- single-read source verification, offline restore, verified rollback and corrupt-destination quarantine
- corrupt source, wrong key, future snapshot version and ambiguous short-Hex key rejection
- `go vet ./internal/payproduct/...`, `make pay-api-check` and full Pay smoke
- exact-source GitHub Actions run `30575350364`, including the complete Linux test job
- Xcode 26.2 unsigned Simulator builds for YNX Pay and YNX Card
- YNX Pay bundle-ID verification, Simulator install, cold launch, app-container lookup and `ynxpay://` URL-scheme resolution

The current GitHub Actions test job is green. An earlier local repository-wide run had host-permission and missing-generated-artifact failures outside Pay; it is retained as historical evidence and is superseded for the frozen candidate by the successful exact-source run.

The mobile evidence is deliberately bounded: the iOS package is unsigned, Simulator-only, authenticated/expiring GitHub Actions evidence. The URL-scheme screenshot proves iOS resolves the scheme to YNX Pay and presents its confirmation dialog; it does not prove the user selected Open or that a post-confirmation invoice view rendered. Android installation, production device signing, public immutable hosting and stores remain unverified.

## Integration acceptance required

`integratedCentral` stays false until `29-integration` verifies all of the following against the exact source commit:

1. Central Wallet registry contains the accepted Pay product tuple and ordered scopes.
2. App Gateway exposes the Pay product routes and emits the exact server assertion.
3. Replay, wrong product, wrong bundle, wrong device, scope widening, expiry and revoke vectors fail closed.
4. Split claim reaches the Pay service through the product-scoped route without exposing server keys.
5. `08-quant-lab` and `26-data-fabric-billing-ledger` sign the exact Quant evidence schema with a frozen, rotatable Ed25519 verifier key; stale, tampered, deposit-only and wrong-payer vectors behave as specified.
6. `30-security-sre-release` accepts the immutable backup/restore receipt schema, offline-writer stop condition, verified rollback/quarantine semantics, remote retention target and production-volume RTO/RPO drill.
7. A fresh YNX Testnet payment produces a matching authoritative receipt and Explorer evidence, including one source-bound Quant Invoice v5 payment.
8. Public deployment, artifact, install and signing states are updated only from direct evidence.
