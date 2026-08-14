# YNX Data Fabric Integration Handoff

Source Commit: `2bac01e4b09f7fc83654a2400a722100ecd91368`
Release Candidate: `ynx-data-fabric-2bac01e4b09f`
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

Engineering-evidence Run `31779789224` checked out exact source `2bac01e4b09f7fc83654a2400a722100ecd91368`. Its PostgreSQL job passed and published a 30-day artifact containing source-bound seed, restart/replay and consumer-process-crash records. The overall run failed because the verify job correctly rejected the then-stale frozen `sourceCommit`; a final evidence-head CI success is pending. PR `#92` remains blocked by one independent approval; no protection bypass is authorized. The CI artifact is not a product download and does not change `downloadHosted`.

## Current executable integration

The YNX Pay BFT bridge reads authoritative Pay state, emits canonical Pay events, drives the Pay Saga and posts receipt and refund effects to the immutable Billing Ledger. This path is locally tested but is not yet current-source CI verified, centrally accepted or shared-Testnet verified.

Envelope v2 may carry optional `chainCommitmentId` as an external Chain Core Bulk Data Commitment reference. Data Fabric consumes frozen Chain Core implementation `0da66c319629a79613739df351b5000b85a1371a` bound by release commit `b481a46f6d77644d0dff13e3917a51f8503e88f4`: it accepts only an exact successful `GET /data/commitments/{id}` read from `ynx-consensus-abci` at `abci-state-v14`. Missing, unavailable or contradictory verification rejects before storage. Data Fabric neither computes the commitment ID nor accepts a write owner; Chain Core derives owner from the transaction signer. Raw content, plaintext metadata, recipient lists, access tokens and key material remain off-chain.

Wallet/Auth introspection must return a non-empty canonical `accountId`. Ordinary event, Ledger, billing settlement, Saga and reconciliation APIs are product-and-account scoped; Saga authority is derived from an existing event matching product, account, aggregate and correlation. `fabric.audit.export`, redelivery management and Saga recovery remain explicitly privileged product-wide scopes, while rate plans remain product metadata. One hundred simultaneous local account sessions passed exact event isolation under the Go race detector; this does not establish shared-Testnet or 1000-producer capacity.

Producer ingress admits a configurable bounded number of already signature-verified requests. Saturation returns `429 producer_backpressure` with `Retry-After: 1` before consuming the producer nonce, so bounded retries remain safe. A clean-source local run started 1000 independently signed producers together, reached the configured peak of 64, committed all 1000 with zero business errors and left exactly 1000 transactional Outbox records. Its p95 was 39.94 seconds and throughput 23.37 events/s, so it remains local file-Store correctness evidence. Separately, exact-source Linux CI wrote 10,000 PostgreSQL events with 90% assigned in order to one aggregate, rejected 1,000 simultaneous duplicates, restarted PostgreSQL, recovered with zero lost events, completed integrity validation in 2,950.171 ms, applied a 10,000-event Analytics replay at 141.530 events/s and idempotently skipped all 10,000 on the second replay. The same job terminated a real consumer subprocess with exit code 86 after its PostgreSQL Analytics fact and Inbox commit but before JetStream acknowledgement; the message was delivered again, the duplicate effect was suppressed, and the durable ended with one fact, one Inbox row and zero pending acknowledgements. This is bounded single-primary and embedded single-node JetStream evidence; replicated JetStream, PostgreSQL-plus-JetStream Producer E2E, replica failover, sustained duration, shared Testnet and public capacity remain open.

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
