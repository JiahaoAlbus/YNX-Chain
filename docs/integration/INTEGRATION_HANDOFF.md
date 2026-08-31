# YNX Data Fabric Integration Handoff

Source Commit: `36beab9f670de4738205ffcb42d5a17630c37dfb`
Release Candidate: `ynx-data-fabric-36beab9f670d`
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
- Wallet Connectivity candidate: `schemas/data-fabric/wallet-connectivity-events-v1.candidate.schema.json`
- Durable Ledger and Card candidates: `schemas/data-fabric/durable-ledger-v1.candidate.schema.json`, `schemas/data-fabric/card-ledger-events-v1.candidate.schema.json`
- Ecosystem Sharing candidate: `schemas/data-fabric/ecosystem-sharing-events-v1.candidate.schema.json`

The Wallet Connectivity candidate is intentionally outside the active Schema
Registry and runtime. It records asynchronous, privacy-safe observations only;
it cannot block or downgrade a DApp standard wallet connection. Integration
must accept it and grant the Data Fabric light lease before activation.

Exact-source CI Run `32354003678` passed all six Data Fabric jobs at evidence
head `3d00377e593dfa0ea9554706bd05f988c5edb213`. This validates source and
release-truth binding only; it is not Integration acceptance, runtime
activation, or public deployment evidence.

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

Envelope v2 may carry optional `chainCommitmentId` as an external Chain Core Bulk Data Commitment reference. Data Fabric consumes frozen Chain Core contract v1.35.0, implementation `6f380265c7d3cc055984e33082f877b4e75303d5`, contract commit `144bc1a354ba390c0ae4e17a93597f799e57c3d6`, from the verified 2,913,495,533-byte v35 bundle with SHA-256 `340d7572eee0a36b2cb9b0402abd36ad9ff7d206a56ad92d0db22728e7af607f`. It accepts only an exact successful `GET /data/commitments/{id}` read from `ynx-consensus-abci` at `abci-state-v14`; contradiction or unavailability rejects before storage. Data Fabric neither computes the ID nor accepts a write owner, and raw content, recipient lists, tokens, keys and private signer material remain off-chain. v35 leaves Bulk Data Commitment, owner/finality and state/application semantics unchanged. It adds only Strategy Vault custody invariants requiring persisted vault owner equals referenced StrategyMandate owner and closed vault balance equals zero YNXT; StreamBFT evidence remains source-bound to unchanged `c3ddcec34234d1ac575a417a03f937c2bff22a4f` code. Repository evidence remains local only: no real Exchange/DEX routing, production deployment, central merge, public endpoint, Computer Control verification, public validator deployment, WAN/soak, central integration or public cutover is proven. The contract has 110 vectors.

Wallet/Auth introspection must return a non-empty canonical `accountId`. Ordinary event, Ledger, billing settlement, Saga and reconciliation APIs are product-and-account scoped; Saga authority is derived from an existing event matching product, account, aggregate and correlation. `fabric.audit.export`, redelivery management and Saga recovery remain explicitly privileged product-wide scopes, while rate plans remain product metadata. One hundred simultaneous local account sessions passed exact event isolation under the Go race detector; this does not establish shared-Testnet or 1000-producer capacity.

Producer ingress admits a configurable bounded number of already signature-verified requests. Saturation returns `429 producer_backpressure` with `Retry-After: 1` before consuming the producer nonce, so bounded retries remain safe. Exact-source Linux CI released 1000 independently signed Producers together through real loopback HTTP into PostgreSQL, held observed server concurrency at 64, committed all 1000 with zero business errors after 4686 safe backpressure retries, then published all 1000 Outbox rows to file-backed JetStream. It ended with Outbox=0 and Stream=1000 at 98.933 committed events/s. The same CI wrote 10,000 PostgreSQL events with 90% assigned in order to one aggregate, rejected 1,000 simultaneous duplicates, restarted PostgreSQL with zero lost events, completed integrity validation in 1120.679 ms, applied 10,000 Analytics effects and skipped all 10,000 on idempotent replay. Its post-commit/pre-ack consumer crash and 256-event capacity-pressure recovery also retained exactly-once effects. Separately, a three-process file-backed JetStream cluster with stream replicas=3 acknowledged 64 events, lost its stream leader, elected another leader in 530.046 ms, acknowledged the remaining 64, then restored the stopped replica and all three became current in 2570.446 ms. Final Outbox was zero and the stream held exactly 128 messages with no duplicates. This remains one bounded one-host loopback drill, not sustained replicated ingress, a network partition, shared Testnet or public capacity proof.

A further drill places an advertised TCP fault proxy in front of each NATS route listener so explicit and gossiped routes cannot bypass fault injection. It keeps all three server processes alive, publishes 64 events, bidirectionally isolates the current stream leader until its route count is zero, verifies an isolated-side publication fails while the Outbox retains the row, then publishes 64 rows through the surviving two-replica quorum. After healing, all three replicas become current and the final 64 rows publish; the stream ends at exactly 192 messages, Outbox zero and no duplicates. Exact-source Linux CI Run `31811137802` passed both jobs at head `58eff9dad4a0a3dc27105716928f2a9b7c4f6460`; its eleven-file artifact was downloaded and all hashes verified. This remains one bounded loopback partition, not packet-loss, multi-zone, sustained, shared-Testnet or public availability evidence.

A local dirty-worktree PostgreSQL 17 drill established the manual replica-promotion boundary and measured connection/integrity-ready RTO at 66,327.058/72,722.068 ms. Exact-source Linux CI Run `31838660585` then passed all three jobs at head `1216adcfd889af371f52c96dbb2d1d3112b291ea`, including the same one-primary/one-asynchronous-standby catch-up, primary stop, manual promotion, 1,000-event RPO-zero, Outbox, integrity and replay invariants. Both artifacts were downloaded and all 14 files SHA-256 verified; CI connection/integrity-ready RTO was 1,141.703/1,418.547 ms. This does not establish automatic endpoint failover, fencing automation, synchronous quorum, multi-host or regional disaster recovery, sustained load, shared Testnet or public availability.

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
