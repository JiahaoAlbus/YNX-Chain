# YNX Card Integration Handoff

## Authority

- Product owner: `06-card`
- Source commit: `01415dc4413dd8d4e33756a52682ca0f2a6675ec`
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

1. Account-scoped export/delete, retention enforcement, encrypted off-host backup policy and timed RPO/RTO evidence.
2. Structured logs, request/error/audit IDs, metrics and traces.
3. Android native unsigned build/install/cold-start/deep-link evidence.
4. iOS Simulator native build/install/callback evidence.
5. Threat model, SBOM, dependency/license review and DAST.
6. SLO/capacity measurements and unit-economics disclosure.
7. Central integration, staging, hosted artifacts and public evidence.
8. Official issuer sandbox selection and provider-specific signature mapping;
   credentials are requested only after autonomous adapter work is complete.

## Release truth

`implementedLocal=true` and `testedLocal=true` apply only to the source and tests
listed above. `installedLocal`, `integratedCentral`, `deployedStaging`,
`deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain
false.
