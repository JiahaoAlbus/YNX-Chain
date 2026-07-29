# YNX Card Integration Handoff

## Authority

- Product owner: `06-card`
- Source commit: `d79872f5df4da0566e11ef40e5314ea68d9846f4`
- Recovery provenance: `bdd5ca02ad42b712db66a5173ecfad09340aa42c`
- Canonical contract: `release/integration/ynx-card-contract.json`
- Product identity: `ynx-card` / `ynx-card-v1` / `com.ynxweb4.card`
- Callback: `ynxcard://wallet-auth/callback`
- Network: YNX Testnet (`ynx_6423-1`, EVM `6423`)

This handoff covers an independent Card Testnet Preview. It does not assert a BIN,
real issuer relationship, fiat balance, real-world spendability, Apple Pay,
Google Pay, production signing, store release or public deployment.

## Implemented and locally verified

- Provider-neutral issuer interface with honest `unavailable` and deterministic
  `sandbox` implementations.
- Versioned issuer capability contract `ynx.card.provider.capabilities.v1`; unsafe
  secure-display, sensitive-data or incomplete lifecycle/event capabilities stop
  service initialization.
- Application, issued-sandbox, activate, freeze, unfreeze, replace and close
  lifecycle.
- Spend, online, international, ATM, MCC and country controls.
- Signed and replay-protected authorization, clearing, reversal, decline and
  refund provider events.
- Provider event Key ID verification with a bounded four-key rotation overlap;
  unknown, retired or malformed keys, body tamper and expired timestamps fail
  closed.
- Clearing and reversal require an existing same-card authorization; refund
  requires an existing same-card clearing. Out-of-order events return conflict
  without consuming the provider event ID, so a valid retry can recover.
- Dispute creation, notifications and review-only AI drafts.
- Canonical Wallet/Gateway request binding with exact product, client, bundle,
  callback, account, device, ordered scopes, digest, method, path, body hash,
  nonce and expiry.
- Atomic integrity-protected persistence, restart recovery, concurrent
  idempotency and tamper rejection.
- Versioned `ynx.card.backup.v1` backup verification, verified rollback,
  bounded migration compatibility, corrupt-primary quarantine and missing-primary
  cold restore through `ynx-card-product-admin`.
- Account-scoped `ynx.card.account-export.v1` export with provider-reference and
  correlation-ID redaction; the redacted audit projection is rehashed into a
  self-consistent export chain.
- Bounded retention for notifications, AI runs, idempotency, expired Gateway
  nonces, orphan provider replay records and pseudonymized deletion receipts.
  Durable Card and financial event records are not removed by routine retention.
- Fail-closed account deletion: every open provider card is closed before local
  erasure; raw account/provider identifiers are removed, audit subjects are
  pseudonymized and rehashed, and an idempotent deletion receipt is retained.
  The HTTP route requires the dedicated `card:data:delete` scope.
- Truthful `/health`, fail-closed `/ready` and `/version` endpoints.
- Android/iOS Expo source, 12 locales and Arabic RTL.
- Product-local security gate rejecting signing material, private-key/token
  patterns, hard-coded Gradle passwords and PAN-like literals.

## Verification at the source commit

- `go test ./internal/cardproduct/...` — passed.
- `go test -race ./internal/cardproduct/...` — passed.
- `go vet ./internal/cardproduct/...` — passed.
- `go build ./internal/cardproduct/cmd/ynx-card-product-admin` — passed.
- Backup/restore drills cover tamper rejection, verified rollback, bounded migration,
  corrupt-primary quarantine and missing-primary cold restore.
- Data lifecycle tests cover export redaction, retention boundaries, fail-closed
  provider closure, deletion idempotency, persisted identifier removal, audit-chain
  reconstruction and rejection without `card:data:delete`.
- `origin/main` was merged at `d79872f5df4da0566e11ef40e5314ea68d9846f4`;
  Card tests and race tests remained green after the merge.
- `npm test` in `apps/card` — 8/8 passed at the recovery checkpoint.
- `npm run typecheck` in `apps/card` — passed at the recovery checkpoint.
- `npm run bundle-check` in `apps/card` — Android and iOS Hermes exports passed
  at the recovery checkpoint.
- `npm run security-check` in `apps/card` — passed at the recovery checkpoint.
- Repository-wide `go test ./...` — not green because unrelated central packages
  require missing Solidity artifacts or reject current host key-permission
  semantics. Card-owned packages passed; no cross-owner source was modified.
- Android native Gradle release build — not verified because three earlier MCP
  calls returned upstream `502` without a Gradle result.

## Required owner actions

### 02 Wallet/Auth

Accept or reject the exact Card registry tuple and assertion fields in the
canonical contract. Any mismatch in product, client, bundle, callback, scopes,
device, digest, nonce or expiry must fail closed. Do not create a Card-local
compatibility login.

### 14 AI

Provide a provider-neutral POST-body workflow for decline, fee and support
explanations. The only accepted output is a draft for explicit review. Card
mutation, freeze/unfreeze, dispute resolution or financial action is forbidden.

### 15 Trust Center

Define a minimal dispute/appeal evidence envelope that references opaque Card
and event IDs. PAN, CVV, PIN, raw KYC and provider credentials must never enter
Trust evidence.

### 26 Data Fabric

Freeze canonical Card event envelopes and audit IDs. Billing Ledger remains the
authority for provider costs, service fees, rewards and reversals. Card must not
invent settlement or revenue facts.

### 29 Integration

Freeze the unique Card contract version, run the cross-product vectors and keep
`integratedCentral=false` until exact accepted implementations are deployed on
the shared Testnet.

### 30 Security/SRE

Review threat model, SBOM, dependency findings, artifact provenance, deployment
policy and secure signing path. Signing keys and provider secrets must remain in
approved secret infrastructure, never Git or chat.

## Open engineering gates

1. Scheduled encrypted off-host backup retention, central privacy-workflow acceptance and timed RPO/RTO evidence.
2. Android native unsigned build/install/cold-start/deep-link evidence.
3. iOS Simulator native build/install/callback evidence.
4. Threat model, SBOM, dependency/license review and DAST.
5. SLO/capacity measurements and unit-economics disclosure.
6. Central integration, staging, hosted artifacts and public evidence.
7. Official issuer sandbox selection and provider-specific signature mapping;
   credentials are requested only after autonomous adapter work is complete.

## Release truth

`implementedLocal=true` and `testedLocal=true` apply only to the source and tests
listed above. `installedLocal`, `integratedCentral`, `deployedStaging`,
`deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain
false.
