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

## Verified behavior

- Data Fabric/Broker failure retains the Outbox record and does not become a Wallet state; recovery retries and publishes it.
- Duplicate delivery does not duplicate the Inbox-protected diagnostic effect; restart preserves the committed effect.
- Sequence gaps, unknown fields, malformed pseudonyms, invalid enums, privacy drift, and non-final or deep-link-only `faucet.completed` inputs fail closed.
- Diagnostics are bounded aggregate dimensions only. No account, wallet address, connection pseudonym, raw endpoint, credential, private content, full signature, seed, private key, PAN, CVV, Card balance, or funding amount is projected.
- No Card funding event is emitted. The accepted Card dependency still has `recipient=null` and `PENDING_CHAIN_ACCOUNT_ISSUANCE`.

## Validation record

- `go test ./...` — pass.
- `go test -race ./internal/datafabric ./internal/datafabricpostgres` — pass.
- `go vet ./internal/datafabric ./internal/datafabricpostgres` — pass.
- `git diff --check` — pass.
- Dependency review: no dependency or lockfile change in this slice.

## Truth boundary and requested Integration action

This is a committed local runtime-adapter checkpoint, not central deployment, public deployment, installed-product proof, Wallet integration proof, or Card E2E funding proof. `integratedCentral`, `deployedStaging`, `deployedPublic`, `downloadHosted`, `productionSigned`, and `storeReleased` remain false absent their own direct evidence.

Integration may record this checkpoint and release the `CONNECTION_EVENTS_RUNTIME_ADAPTER_SLICE` Light Lease only after remote push verification. The next external integration step is for Wallet/Financial/Card producers to invoke these adapters asynchronously after their own authoritative outcomes; no product may introduce a synchronous dependency.
