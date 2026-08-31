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

## Privacy-safe derived analytics erasure receipt — 2026-08-31

- Implementation commit: `025fd6a17a2686ad458ffed4c7936623bcb37eec`.
- Migration `0008_erasure_deletion_receipts` appends a pseudonymous, audit-bound SHA-256 receipt after deleting derived analytics facts in the same serializable transaction.
- Local test scope: `go test ./internal/datafabric ./internal/datafabricpostgres`; GitHub Actions run `33371153886` passed all six Data Fabric jobs for binding head `413ced26ab65fe84c61d3a19a26c308ba9c454df`.
- The receipt retains no raw account, event ID, payload, diagnostic message, key, or signature. An old PostgreSQL erasure request without a receipt fails closed during idempotent retry or integrity audit.
- No public endpoint, database migration, service mutation, deployment, or 9102/6423 probe occurred. `P0-147` remains `WAITING_EXTERNAL_PUBLIC_ENDPOINT_UNBOUND`.

## Privacy-safe derived Analytics retention sweep — 2026-08-31

- Implementation commit: `459d112f6ea9592b9a4c9a49f83e8c1ce77c8282`.
- Migration `0009_analytics_retention_sweeps` adds an append-only audit record for serializable deletion of only expired `transient` and `operational` payload-free Analytics facts. Canonical events, Outbox, Inbox, Ledger, audit and legal-hold classes are not in its deletion predicate.
- Replays use the same audit ID and exact microsecond-canonicalized UTC tuple; a changed cutoff fails closed and cannot create a second deletion effect.
- Local validation passed: `go test ./internal/datafabric ./internal/datafabricpostgres`, `go test -race ./internal/datafabric ./internal/datafabricpostgres`, and `go vet ./internal/datafabric ./internal/datafabricpostgres`.
- No retention policy duration, scheduler, production database migration, service mutation, deployment, or public endpoint is claimed. `P0-147` remains `WAITING_EXTERNAL_PUBLIC_ENDPOINT_UNBOUND`.

## Retention replay test correction — 2026-08-31

- Test-only precision correction: `c134290a4800a30c2f1f5a57523adf1daea34ad3` makes the recording PostgreSQL driver return the same microsecond `timestamptz` precision as the real database.
- It fixes the negative CI result from run `33373383241`: runtime behavior was already microsecond-canonical; the prior fixture incorrectly returned nanosecond values and therefore simulated a parameter drift on a same-audit-ID replay.
- Focused PostgreSQL tests, race tests, vet, TypeScript SDK tests and release-truth validation pass locally. GitHub Actions run `33374309851` passed all six jobs for the pushed binding head `f818ee876dbd7e20016f9363c09ef8e0a6fedeb3`; no central, runtime, or public state changes are claimed.

### PostgreSQL verified-TLS startup boundary — 2026-08-31

- Source commit `60d92d33db3c69080bb72a2cd1ccf6149f43de2b` adds fail-closed Data Fabric daemon validation: PostgreSQL mode accepts only a `postgres://` or `postgresql://` secret URI with exactly one `sslmode=verify-full` value before dialing.
- Unit, race, vet and full repository Go tests pass locally. Remote CI is intentionally pending for this exact source; prior CI is not relabeled.
- This validates in-transit configuration only. Database-at-rest encryption, backup encryption, KMS and certificate authority are external runtime controls. No endpoint, deployment, public health check, or P0-147 state changed.

### PostgreSQL erasure authority precision repair — 2026-08-31

- GitHub Actions run `33375432866` failed its live PostgreSQL test at source `60d92d33db3c69080bb72a2cd1ccf6149f43de2b`: `erasure_deletion_receipt_authority` correctly rejected an authority timestamp with nanoseconds when its deferred receipt used PostgreSQL microseconds.
- Source commit `cc62be999b619ca4dfab635a3bd640792204decd` canonicalizes the PostgreSQL `RecordErasure` timestamp before inserting the immutable authority, and extends the adapter test to assert equality with the receipt timestamp. An isolated local PostgreSQL 17.10 container passed the exact live test; remote CI is pending for this source.
- This is a local persistence correctness repair only. No public endpoint, deployment, user identity, raw private data, or P0-147 state changed.

### CI release-evidence redaction correction — 2026-08-31

- GitHub Actions run `33376148624` passed PostgreSQL live, PostgreSQL failover and reproducible-build jobs for the erasure precision repair, but `data-fabric-verify` correctly rejected an abbreviated local-test evidence string.
- Commit `5dee482b702132284cb7f32138f516d9d078f4a5` replaces that string with a concrete, non-sensitive description that contains neither endpoint nor credential. GitHub Actions run `33376722565` passed all six Data Fabric jobs for the same engineering source; later documentation CI is separate and does not change the source evidence.
- This is release-evidence hygiene only. No deployment, hosted download, public URL, or P0-147 state changed.

### 6423-only Wallet connectivity aggregation — 2026-08-31

- Source commit `6e2ddc50a6db83a526c81312d63d73d9fe3d6d60` accepts only transient `6423` or `0x1917` at the Data Fabric aggregation boundary, emits canonical `0x1917`, and requires that exact value for persisted accepted connection events.
- Legacy `9102`/`0x238e`, unknown chains and raw canonical errors fail closed before event construction; rejection evidence is empty and aggregates contain only canonical chain ID, bounded error class and retryability. The adapter remains asynchronous and cannot block or relabel standard Wallet connection, approval, signing or transaction behavior.
- Focused unit and race tests pass locally. Remote CI is pending for this source. No Gateway, Wallet, Card, Finance, Explorer, endpoint, deployment or public state changed.
