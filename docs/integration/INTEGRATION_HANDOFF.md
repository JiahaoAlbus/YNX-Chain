# YNX Pay integration handoff

## Ownership and source

- Product owner: `04-pay`
- Branch: `codex/final-pay`
- Source commit: `WORKTREE_PENDING_COMMIT`
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

## Endpoints added by this checkpoint

| Method | Path | Boundary |
|---|---|---|
| POST | `/v1/merchant/split-payments` | Merchant `invoice` permission |
| GET | `/v1/split-payments/{id}` | Public read, payer account redacted |
| POST | `/v1/split-payments/{id}/shares/{shareId}/claim` | Canonical Wallet/Gateway session; `pay:settlement:submit` |

## Migration and compatibility

Snapshots that predate Split Payments omit `splitPayments`; normalization creates an empty map without modifying existing merchants, invoices, receipts or audit entries. Invoice v1–v3 signing material is unchanged. New Split child Invoices are v4. The snapshot envelope remains HMAC-SHA-256 protected and atomically replaced.

## Verification

Passing locally on 2026-07-27:

- `go test ./internal/payproduct/... -count=1`
- `go test -race ./internal/payproduct/... -count=1`
- Split signature and tamper rejection
- Split claim scope enforcement and idempotency
- child Invoice v4 binding
- wrong-payer settlement rejection
- public payer redaction and merchant audit retention
- aggregate `partially_paid` state

Repository-wide `go test ./... -count=1` is not green because unchanged Consensus/Faucet/Trust key-permission tests fail in the current host environment and unchanged IDE tests require a missing generated contract artifact. The Pay package passes in that run. These are not being silently fixed in the Pay worktree as Pay-owned requirements.

## Integration acceptance required

`integratedCentral` stays false until `29-integration` verifies all of the following against the exact source commit:

1. Central Wallet registry contains the accepted Pay product tuple and ordered scopes.
2. App Gateway exposes the Pay product routes and emits the exact server assertion.
3. Replay, wrong product, wrong bundle, wrong device, scope widening, expiry and revoke vectors fail closed.
4. Split claim reaches the Pay service through the product-scoped route without exposing server keys.
5. A fresh YNX Testnet payment produces a matching authoritative receipt and Explorer evidence.
6. Public deployment, artifact, install and signing states are updated only from direct evidence.
