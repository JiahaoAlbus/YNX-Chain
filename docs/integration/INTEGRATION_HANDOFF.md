# YNX Card Integration Handoff

## Authority

- Product owner: `06-card`
- Source commit: `bdd5ca02ad42b712db66a5173ecfad09340aa42c`
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
- Application, issued-sandbox, activate, freeze, unfreeze, replace and close
  lifecycle.
- Spend, online, international, ATM, MCC and country controls.
- Signed and replay-protected authorization, clearing, reversal, decline and
  refund provider events.
- Dispute creation, notifications and review-only AI drafts.
- Canonical Wallet/Gateway request binding with exact product, client, bundle,
  callback, account, device, ordered scopes, digest, method, path, body hash,
  nonce and expiry.
- Atomic integrity-protected persistence, restart recovery, concurrent
  idempotency and tamper rejection.
- Truthful `/health`, fail-closed `/ready` and `/version` endpoints.
- Android/iOS Expo source, 12 locales and Arabic RTL.
- Product-local security gate rejecting signing material, private-key/token
  patterns, hard-coded Gradle passwords and PAN-like literals.

## Verification at the source commit

- `go test ./internal/cardproduct/...` — passed.
- `npm test` in `apps/card` — 8/8 passed.
- `npm run typecheck` in `apps/card` — passed.
- `npm run bundle-check` in `apps/card` — Android and iOS Hermes exports passed.
- `npm run security-check` in `apps/card` — passed.
- Android native Gradle release build — not verified in this checkpoint because
  three MCP calls returned upstream `502` without a Gradle result.

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

1. Versioned provider capability contract and conformance suite.
2. Out-of-order event reconciliation and provider key rotation.
3. Backup/restore and rollback migration drill.
4. Structured logs, request/error IDs, metrics and traces.
5. Android native unsigned build/install/cold-start/deep-link evidence.
6. iOS Simulator native build/install/callback evidence.
7. Threat model, SBOM, dependency/license review and DAST.
8. SLO/capacity measurements and unit-economics disclosure.
9. Central integration, staging, hosted artifacts and public evidence.
10. Official issuer sandbox selection and credentials only after autonomous
    adapter work is complete.

## Release truth

`implementedLocal=true` and `testedLocal=true` apply only to the source and tests
listed above. `installedLocal`, `integratedCentral`, `deployedStaging`,
`deployedPublic`, `downloadHosted`, `productionSigned` and `storeReleased` remain
false.
