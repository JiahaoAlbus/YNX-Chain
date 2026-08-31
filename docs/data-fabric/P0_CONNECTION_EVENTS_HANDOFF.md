# P0 Connection Events Runtime Handoff

## Authority and scope

- Integration acceptance: `connectionEvents@1.0.0-p0.0`
- Acceptance commit: `e13fca35d890427a25bff9d6122e7c7581247cdb`
- Accepted source evidence: `766e1a66352eecaf88f024088e6a9dfcdc2d01d8` / PR #92
- Activated schema: `schemas/data-fabric/wallet-connectivity-events-v1.accepted.schema.json`
- Permitted runtime paths only: Data Fabric core, PostgreSQL adapter, schemas, and Data Fabric documentation.

## Delivered runtime slice

- `internal/datafabric.ConnectionEvent` strictly decodes and validates all accepted event types, required provenance, per-product pseudonym, ordering sequence, privacy class, retention, and bounded diagnostics.
- `Store.EmitConnectionEvent` signs a canonical Envelope v1 and writes the existing Event + Outbox atomically.
- `datafabricpostgres.Store.EmitConnectionEvent` preserves the existing PostgreSQL Event + Outbox transaction.
- `Store.ConsumeConnectionDiagnostics` and `datafabricpostgres.Store.ConsumeConnectionDiagnostics` use the existing Inbox to apply an exactly-once aggregate effect across duplicate delivery, restart, and replay.
- PostgreSQL migration `0007_connection_event_diagnostics` contains aggregate counters only; rollback rejects removal while aggregate evidence exists.
- `AggregateWalletCanonicalError` consumes accepted Wallet/Auth source `24cc3218c2cdc00c50dc3caa563652083afbd861` and returns only the already accepted `errorClass` and `retryable` aggregate fields. It fails closed for unknown codes and never retains the canonical code, messages, provider payload, or identity in a connection event.

## Verified behavior

- Data Fabric/Broker failure retains the Outbox record and does not become a Wallet state; recovery retries and publishes it.
- Duplicate delivery does not duplicate the Inbox-protected diagnostic effect; restart preserves the committed effect.
- Sequence gaps, unknown fields, malformed pseudonyms, invalid enums, privacy drift, and non-final or deep-link-only `faucet.completed` inputs fail closed.
- Wallet canonical-error vectors cover all 26 accepted descriptors and reject an unknown upstream code or a raw canonical code in the event payload.
- Diagnostics are bounded aggregate dimensions only. No account, wallet address, connection pseudonym, raw endpoint, credential, private content, full signature, seed, private key, PAN, CVV, Card balance, or funding amount is projected.
- No Card funding event is emitted. The accepted Card dependency still has `recipient=null` and `PENDING_CHAIN_ACCOUNT_ISSUANCE`.

## Validation record

- `go test ./...` — pass.
- `go test -race ./internal/datafabric ./internal/datafabricpostgres` — pass.
- `go vet ./internal/datafabric ./internal/datafabricpostgres` — pass.
- `git diff --check` — pass.
- Dependency review: no dependency or lockfile change in this slice.

## Canonical Wallet error aggregation slice — 2026-08-21

- Central Light Slice authority: `f0240430d32ca8109b628ba950c7a45de9bb4664`.
- Accepted Wallet/Auth descriptor source: `24cc3218c2cdc00c50dc3caa563652083afbd861`.
- Owner implementation: `2a5233ee9560e8855271d9681c1f7f41142cf117`.
- Mechanical frozen-source/release binding: `4e73419967436c40f04e78bc888ac63659645788`.
- Vectors cover all 26 canonical descriptors, reject unknown source codes without retaining their value, and reject a raw canonical code in an accepted event payload.
- Local validation passed: `go test ./...`, `go test -race ./internal/datafabric ./internal/datafabricpostgres`, `go vet ./internal/datafabric ./internal/datafabricpostgres`, `npm test --prefix sdk/datafabric-typescript`, and `scripts/data-fabric/quality-gates.sh`.

## Truth boundary and requested Integration action

This is a committed local runtime-adapter checkpoint, not central deployment, public deployment, installed-product proof, Wallet integration proof, or Card E2E funding proof. `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned`, and `storeReleased` remain false absent their own direct evidence.

Integration may record this checkpoint and release the `wallet-canonical-error-to-connectivity-aggregation` Light Slice only after remote push verification. The next external integration step is for Wallet/Financial/Card producers to invoke these adapters asynchronously after their own authoritative outcomes; no product may introduce a synchronous dependency.

## P0-147 public runtime lease request — 2026-08-31

`P0_147_PUBLIC_RUNTIME_LEASE_REQUEST.json` freezes a Data-Fabric-only request for the missing public topology, protected-reference presence booleans, service identity, and current/rollback mapping. It is deliberately `REQUESTED_NOT_AUTHORIZED`: every endpoint and secret-manager reference is unset, `productionMutationAllowed` is false, and it cannot be used as a production configuration.

Central must bind one authoritative HTTPS Data Fabric origin and the exact runtime/service/rollback tuple before issuing a single-use writable lease. The subsequent verification is `/health`, `/version`, `/metrics`, and one already-authoritative producer outcome through Event, Outbox, Inbox, and Ledger effect. No Wallet account request, signature, transaction, Provider/Gateway change, or synchronous Wallet dependency is in this scope.
