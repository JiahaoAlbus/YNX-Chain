# YNX Data Fabric Integration Handoff

Source Commit: `ed06ce8053d165122a0fa550f59af7c88d3b3c6b`
Release Candidate: `ynx-data-fabric-ed06ce8053d1`
Owner: YNX Data Fabric
Phase: `INTEGRATE`
Status: `ACTIVE`

## Frozen contract package

- Machine contract: `release/integration/ynx-data-fabric-contract.json`
- Canonical Envelope v2: `schemas/data-fabric/event-envelope-v2.schema.json`
- Compatibility Envelope v1: `schemas/data-fabric/event-envelope-v1.schema.json`
- Schema Registry v2: `schemas/data-fabric/schema-registry-v2.json`
- Go SDK: `sdk/datafabric`
- TypeScript SDK: `sdk/datafabric-typescript`
- Product event ownership: `integration/product-event-contracts.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- Full goal coverage: `.ai-bridge/full-goal-coverage.json`

## Release state

| State | Value | Direct basis |
|---|---:|---|
| implementedLocal | true | Runtime, API, Go and TypeScript SDKs, CLI, Ledger, Saga, migrations, backup and release tooling are present |
| testedLocal | true | Targeted tests, Data Fabric Race and full Go test with standard umask passed |
| installedLocal | true | Current-source local package, install and host cold-start gates pass |
| integratedCentral | false | No complete owner-acceptance receipt set exists |
| deployedStaging | false | No staging deployment receipt exists |
| deployedPublic | false | No public runtime or health receipt exists |
| downloadHosted | false | No immutable public artifact receipt exists |
| productionSigned | false | Only test-fixture signing is exercised |
| storeReleased | false | Native app-store delivery is not applicable to this headless service |

Engineering-evidence Run `31797308684` checked out exact source `4bb2ddfb6337e44060f57adafc7ee1cc08faedbe`; its PostgreSQL job passed and produced the checked-in source-bound restart/replay, consumer-crash, capacity-backpressure, 1000 signed Producer E2E and three-replica stream-leader-loss evidence. Its verify job rejected the intentionally stale pre-binding release truth. Final evidence-head Run `31799837096` then passed both jobs at v24-bound head `54c8bc0e16a5a5b3bf6321d041f8b35fea871fbb`; its nine-file artifact was downloaded and all SHA-256 values verified. PR `#92` remains blocked by one independent approval; no protection bypass is authorized. The 30-day CI artifact is not a product download and does not change `downloadHosted`.

## Current executable integration

The YNX Pay BFT bridge reads authoritative Pay state, emits canonical Pay events, drives the Pay Saga and posts receipt and refund effects to the immutable Billing Ledger. This path is locally tested but is not yet current-source CI verified, centrally accepted or shared-Testnet verified.

Envelope v2 may carry optional `chainCommitmentId` as an external Chain Core Bulk Data Commitment reference. Data Fabric consumes frozen Chain Core contract v1.28.0, implementation `abae5384dc856434470860ab0060998ac216addc`, contract commit `6cd71d6c53908fbfb2b2810ace922fd8b19bff17`, from the verified 124,884,797-byte v28 bundle with SHA-256 `1d66fc0b2c7c2a0fc28f3339de2fd9c5b45af70120c8605fc1a24c730d009704`. It accepts only an exact successful `GET /data/commitments/{id}` read from `ynx-consensus-abci` at `abci-state-v14`. Missing, unavailable or contradictory verification rejects before storage. Data Fabric neither computes the commitment ID nor accepts a write owner; Chain Core derives owner from the transaction signer. Raw content, plaintext metadata, recipient lists, access tokens and key material remain off-chain. v28 leaves Bulk Data Commitment, Wallet/Product Session and strategy-action public semantics unchanged. It adds a mode-0600, no-symlink, nonblocking exclusive OS-process lease to the existing durable validator safety-state path; helper-process evidence proves second-owner rejection before state load and reacquisition only after close or process exit. macOS/Linux are supported, while Windows validator runtime fails closed as unsupported. The integration contract advances to 103 vectors. This is not Chain Core real-network partition, packet-loss, DDoS, State Sync, CometBFT/public differential replay, TLC/Apalache, WAN soak, central integration or public promotion evidence; all remain false.

Wallet/Auth introspection must return a non-empty canonical `accountId`. Ordinary event, Ledger, billing settlement, Saga and reconciliation APIs are product-and-account scoped; Saga authority is derived from an existing event matching product, account, aggregate and correlation. `fabric.audit.export`, redelivery management and Saga recovery remain explicitly privileged product-wide scopes, while rate plans remain product metadata. One hundred simultaneous local account sessions passed exact event isolation under the Go race detector; this does not establish shared-Testnet or 1000-producer capacity.

Producer ingress admits a configurable bounded number of already signature-verified requests. Saturation returns `429 producer_backpressure` with `Retry-After: 1` before consuming the producer nonce, so bounded retries remain safe. Exact-source Linux CI released 1000 independently signed Producers together through real loopback HTTP into PostgreSQL, held observed server concurrency at 64, committed all 1000 with zero business errors after 4686 safe backpressure retries, then published all 1000 Outbox rows to file-backed JetStream. It ended with Outbox=0 and Stream=1000 at 98.933 committed events/s. The same CI wrote 10,000 PostgreSQL events with 90% assigned in order to one aggregate, rejected 1,000 simultaneous duplicates, restarted PostgreSQL with zero lost events, completed integrity validation in 1120.679 ms, applied 10,000 Analytics effects and skipped all 10,000 on idempotent replay. Its post-commit/pre-ack consumer crash and 256-event capacity-pressure recovery also retained exactly-once effects. Separately, a three-process file-backed JetStream cluster with stream replicas=3 acknowledged 64 events, lost its stream leader, elected another leader in 530.046 ms, acknowledged the remaining 64, then restored the stopped replica and all three became current in 2570.446 ms. Final Outbox was zero and the stream held exactly 128 messages with no duplicates. This remains one bounded one-host loopback drill, not sustained replicated ingress, a network partition, shared Testnet or public capacity proof.

A further drill places an advertised TCP fault proxy in front of each NATS route listener so explicit and gossiped routes cannot bypass fault injection. It keeps all three server processes alive, publishes 64 events, bidirectionally isolates the current stream leader until its route count is zero, verifies an isolated-side publication fails while the Outbox retains the row, then publishes 64 rows through the surviving two-replica quorum. After healing, all three replicas become current and the final 64 rows publish; the stream ends at exactly 192 messages, Outbox zero and no duplicates. Exact-source Linux CI Run `31811137802` passed both jobs at head `58eff9dad4a0a3dc27105716928f2a9b7c4f6460`; its eleven-file artifact was downloaded and all hashes verified. This remains one bounded loopback partition, not packet-loss, multi-zone, sustained, shared-Testnet or public availability evidence.

A local dirty-worktree PostgreSQL 17 drill now establishes the manual replica-promotion boundary. One asynchronous streaming standby first reported recovery/read-only and replayed beyond the primary flush LSN. The primary was then stopped and remained stopped; `pg_promote` made the standby writable. All 1,000 canonical events and pending Outbox rows survived with measured canonical-event RPO zero; integrity validation completed, 1,000 Analytics effects applied once and all 1,000 skipped on idempotent replay. Connection and integrity-ready RTO were 66,327.058 ms and 72,722.068 ms on this macOS/Docker run. Exact-source Linux CI remains pending. This does not establish automatic endpoint failover, fencing automation, synchronous quorum, multi-host or regional disaster recovery, sustained load, shared Testnet or public availability.

## Required merge and acceptance order

1. YNX Integration freezes Envelope v2, Registry v2, error codes, scope names and ownership.
2. Wallet/Auth and App Gateway run signed request, replay, wrong tuple, expiry and revoke vectors.
3. Pay and Chain Core run the shared-Testnet invoice, settlement, receipt, refund and reconciliation vector.
4. Exchange, DEX and Quant owners add registered events, fee boundaries, compensation and reconciliation vectors.
5. Remaining product owners add their registered producer and Saga vectors.
6. Explorer, Monitor and Trust consume correlated evidence.
7. Security/SRE runs production-shaped broker, database, backup, restore, alert, artifact and signer gates.
8. Website consumes only the truthful public metadata after runtime and immutable hosting receipts exist.

## Non-negotiable boundaries

- HTTP success is not Saga completion.
- Analytics cannot modify the operational Event Store or Billing Ledger.
- Network exactly-once delivery is not claimed; controlled effects are idempotent and Inbox-bound.
- Corrections append new entries; history is never silently overwritten.
- Data Fabric does not own Wallet identity, assets, prices, chain finality or product business authority.
- A Chain Core commitment reference is read-only evidence; Data Fabric does not redefine consensus, finality, owner normalization, version ancestry or commitment-ID derivation.
- No private key, seed, PEM, PAN, CVV, provider secret or raw private Mail, Social or Cloud content belongs in events, analytics, handoff files or logs.

## Next exact action

Submit the source-bound contract to YNX Integration, then execute `DF-XP-006` and `DF-XP-014` in dependency order. Until those receipts exist, phase remains `INTEGRATE` and every central, staging and public state remains false.
