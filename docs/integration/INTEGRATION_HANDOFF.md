# YNX Data Fabric Integration Handoff

Source Commit: `a0f92680d0df50ed131b5eb422a851f5874c9045`
Release Candidate: `ynx-data-fabric-a0f92680d0df`
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

Engineering-evidence Run `31786668608` checked out exact source `a0f92680d0df50ed131b5eb422a851f5874c9045`; its PostgreSQL job passed and produced the checked-in source-bound restart/replay, consumer-crash and capacity-backpressure evidence. Final evidence-head Run `31788198895` then passed both jobs at `d0d7e4d6ce5bfbeeafcc21d3c9186aa6e52434dc`. PR `#92` remains blocked by one independent approval; no protection bypass is authorized. The 30-day CI artifact is not a product download and does not change `downloadHosted`.

## Current executable integration

The YNX Pay BFT bridge reads authoritative Pay state, emits canonical Pay events, drives the Pay Saga and posts receipt and refund effects to the immutable Billing Ledger. This path is locally tested but is not yet current-source CI verified, centrally accepted or shared-Testnet verified.

Envelope v2 may carry optional `chainCommitmentId` as an external Chain Core Bulk Data Commitment reference. Data Fabric consumes frozen Chain Core implementation `0da66c319629a79613739df351b5000b85a1371a` bound by release commit `b481a46f6d77644d0dff13e3917a51f8503e88f4`: it accepts only an exact successful `GET /data/commitments/{id}` read from `ynx-consensus-abci` at `abci-state-v14`. Missing, unavailable or contradictory verification rejects before storage. Data Fabric neither computes the commitment ID nor accepts a write owner; Chain Core derives owner from the transaction signer. Raw content, plaintext metadata, recipient lists, access tokens and key material remain off-chain.

Wallet/Auth introspection must return a non-empty canonical `accountId`. Ordinary event, Ledger, billing settlement, Saga and reconciliation APIs are product-and-account scoped; Saga authority is derived from an existing event matching product, account, aggregate and correlation. `fabric.audit.export`, redelivery management and Saga recovery remain explicitly privileged product-wide scopes, while rate plans remain product metadata. One hundred simultaneous local account sessions passed exact event isolation under the Go race detector; this does not establish shared-Testnet or 1000-producer capacity.

Producer ingress admits a configurable bounded number of already signature-verified requests. Saturation returns `429 producer_backpressure` with `Retry-After: 1` before consuming the producer nonce, so bounded retries remain safe. A clean-source local run started 1000 independently signed producers together, reached the configured peak of 64, committed all 1000 with zero business errors and left exactly 1000 transactional Outbox records. Its p95 was 39.94 seconds and throughput 23.37 events/s, so it remains local file-Store correctness evidence. Separately, exact-source Linux CI wrote 10,000 PostgreSQL events with 90% assigned in order to one aggregate, rejected 1,000 simultaneous duplicates, restarted PostgreSQL, recovered with zero lost events, completed integrity validation in 1,106.607 ms, applied a 10,000-event Analytics replay at 386.747 events/s and idempotently skipped all 10,000 on the second replay. The same job terminated a real consumer subprocess with exit code 86 after its PostgreSQL Analytics fact and Inbox commit but before JetStream acknowledgement; the message was delivered again, the duplicate effect was suppressed, and the durable ended with one fact, one Inbox row and zero pending acknowledgements. A separate 256-event batch filled a 64 KiB JetStream: 18 events received acknowledgements, all 238 capacity rejections remained in PostgreSQL without entering DLQ, and explicit expansion to 8 MiB drained all 238 with exactly 256 final messages and zero duplicates. This is bounded single-primary and embedded single-node JetStream evidence, not a sustained-duration soak; replicated JetStream, PostgreSQL-plus-JetStream signed Producer E2E, automatic scaling, replica failover, shared Testnet and public capacity remain open.

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
