# YNX Card Threat Model

Source commit: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Data-lifecycle implementation commit: `719337289bfa9c28bee3acd86279b1bac61e9815`

## Scope and release boundary

This model covers the local YNX Card Testnet Preview service, its React Native source, deterministic sandbox/unavailable issuer adapters, Gateway assertions, provider event ingestion, integrity-protected local state, backup/restore, observability and account data lifecycle. It does not claim a production issuer, BIN, fiat custody, real-world spendability, hosted runtime, signed mobile artifact or store release.

## Protected assets

- Account-to-Card ownership and Card lifecycle state.
- Spending controls and dispute records.
- Provider event ordering, replay history and opaque provider identifiers.
- Gateway assertion integrity, nonce freshness and route binding.
- Audit-chain continuity and correlation identifiers.
- Integrity and confidentiality boundaries around backups and local state.
- Mobile signing credentials, issuer credentials and wallet private keys, which are forbidden from repository and application state.
- User privacy rights represented by export, retention and deletion operations.

## Trust boundaries

1. Wallet/Auth and the Product Gateway issue signed assertions. Card verifies exact product, client, bundle, callback, account, device, route, body digest, ordered scopes, nonce and expiry.
2. The issuer adapter is external authority for issuance and Card status. The default unavailable adapter fails readiness; the deterministic sandbox is test-only.
3. Provider webhooks cross an untrusted network boundary and require a known key ID, bounded timestamp, exact signature and replay rejection.
4. Card state crosses a local filesystem boundary and is protected by atomic writes, HMAC integrity verification and fail-closed loading.
5. Backup media crosses an operator boundary. Local integrity is verified, but encrypted off-host storage and scheduled retention are not yet evidenced.
6. Account export/delete requests cross a privileged privacy-operation boundary. Deletion requires a dedicated `card:data:delete` scope in addition to explicit confirmation and idempotency.

## Threats, controls and residual risk

| Threat | Implemented control | Residual risk / required next control |
|---|---|---|
| Forged or replayed Gateway request | HMAC assertion, exact method/path/body digest, ordered scopes, short expiry and nonce replay store | Central Wallet/Gateway acceptance and shared Testnet vectors remain pending |
| Accidental account erasure under ordinary Card authority | Delete route requires `card:data:delete`; default Card scopes are rejected | Central issuer of assertions must freeze and independently review the new scope |
| Local erasure while provider Card remains active | Every non-closed provider Card is closed before local mutation; any provider error aborts deletion | Official provider-specific closure semantics are not yet selected |
| Export leaks provider or correlation secrets | Eligibility/provider application/card/event references and request/trace IDs are removed; redacted audit entries are rehashed | Policy/legal review must confirm whether additional jurisdiction-specific fields require redaction |
| Deletion leaves raw account or provider identifiers | Account-owned records and provider replay IDs are removed; audit subject/object/correlation fields are pseudonymized and rehashed | Filesystem snapshots, off-host backups and external processors need a coordinated deletion policy |
| Deletion retry causes duplicate destructive work | Bounded pseudonymized deletion receipt and idempotency digest return the original receipt; a different key conflicts | Receipt expiry permits a later new lifecycle; operators must not bypass service APIs |
| Retention deletes durable financial history | Routine retention is restricted to bounded operational records; Card and financial events are preserved | A regulator/provider retention schedule must be approved before production |
| Retention fails to bound operational data | Explicit default ages and an authenticated retention route remove expired records | Scheduled invocation and monitoring are not yet deployed |
| Provider webhook tamper, replay or reordering | Key-ID signature verification, bounded rotation, timestamp window, replay map and event relationship validation | Official provider signature mapping remains external |
| State-file tamper or partial write | HMAC envelope, atomic replacement, strict map-index and audit-chain validation | Encryption at rest depends on deployment platform and secret infrastructure |
| Malicious or corrupted backup | Versioned HMAC envelope, digest/size/version checks, rollback backup, quarantine and post-write verification | Encrypted off-host replication and timed restore drills remain open |
| AI output mutates financial state | AI workflows are draft/review-only and cannot execute Card controls or provider actions | Central AI contract acceptance and retention alignment remain pending |
| Sensitive values enter logs/metrics | Structured logs use bounded route templates and correlation IDs; metrics omit account, merchant and provider IDs; security scan rejects credential/PAN-like patterns | DAST and centralized log-pipeline validation remain open |
| Mobile artifact leaks signing material | Signing values are environment-only; product security script rejects embedded credentials and Gradle passwords | Native release build, provenance and store signing have not been performed |
| Dependency compromise | Deterministic CycloneDX npm SBOM and provenance are generated from package-lock v3 | Dependency alert triage, Go package-specific SBOM and independent supply-chain review remain open |

## Data minimization and deletion semantics

- PAN, CVV/CVC, PIN, track data, raw KYC, identity documents, issuer secrets, wallet private keys and mobile signing keys are forbidden from Card state, logs, analytics, AI context and public evidence.
- Account export is a redacted projection, not a raw database dump.
- Account deletion is fail-closed against the issuer and preserves only a bounded pseudonymized receipt plus pseudonymized audit evidence.
- Routine retention never silently removes durable Card or financial event history.
- Reapplication clears the prior deletion receipt and creates a new lifecycle only through normal eligibility/application flows.

## Security verification at this checkpoint

- `go test ./internal/cardproduct/...` — passed.
- `go test -race ./internal/cardproduct/...` — passed.
- `go vet ./internal/cardproduct/...` — passed.
- `npm run security-check` in `apps/card` — passed.
- Account lifecycle tests cover export redaction, delete-scope rejection, provider closure, persisted identifier removal, idempotency, audit-chain reconstruction and retention boundaries.
- Repository-wide `go test ./...` is not green because unrelated BFT/consensus tests require a missing generated Solidity artifact. Card-owned packages pass.

## Production gates

A production claim requires, at minimum: central scope acceptance, official issuer contract/signature mapping, encrypted off-host backup policy, scheduled retention, DAST, independent security review, dependency alert triage, signed artifacts with provenance, native install evidence, staging observability, incident integration and legal/privacy approval.
