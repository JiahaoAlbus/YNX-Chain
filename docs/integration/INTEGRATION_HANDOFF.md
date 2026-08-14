# YNX Data Fabric Integration Handoff

Source Commit: `8ee6d8f37ce945111ba76ddc2466c06164a6c4e8`
Release Candidate: `ynx-data-fabric-8ee6d8f37ce9`
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

Engineering-evidence Run `31791152026` checked out exact source `8ee6d8f37ce945111ba76ddc2466c06164a6c4e8`; its PostgreSQL job passed and produced the checked-in source-bound restart/replay, consumer-crash, capacity-backpressure and 1000 signed Producer E2E evidence. Final evidence-head Run `31793195539` passed both jobs at `8b405e4e9dd221b48099a55899a63adf885b9725`; its artifact was downloaded and all seven file hashes were verified. PR `#92` remains blocked by one independent approval; no protection bypass is authorized. The 30-day CI artifact is not a product download and does not change `downloadHosted`.

## Current executable integration

The YNX Pay BFT bridge reads authoritative Pay state, emits canonical Pay events, drives the Pay Saga and posts receipt and refund effects to the immutable Billing Ledger. This path is locally tested but is not yet current-source CI verified, centrally accepted or shared-Testnet verified.

Envelope v2 may carry optional `chainCommitmentId` as an external Chain Core Bulk Data Commitment reference. Data Fabric consumes frozen Chain Core contract v1.22.0, implementation `b23df6e8c36f763898c03d4a8ffbef1b3fd9b044`, contract commit `15f62663c8bbbad360405d1ace4db8b07d2dc54d`, from the verified 42,881,424-byte v22 bundle with SHA-256 `8f3cab6bc119097a7ae57ea26385c544cc50c74a5b83e62674fe0a331d9ca2d4`. It accepts only an exact successful `GET /data/commitments/{id}` read from `ynx-consensus-abci` at `abci-state-v14`. Missing, unavailable or contradictory verification rejects before storage. Data Fabric neither computes the commitment ID nor accepts a write owner; Chain Core derives owner from the transaction signer. Raw content, plaintext metadata, recipient lists, access tokens and key material remain off-chain. v22 does not change the Data Commitment ID, owner, version-chain, finality or consensus semantics; its additive mandate-bound engine-signed strategy action remains Chain Core-owned. The bundle also verifies 13 local service runtime identities, fail-closed public smoke checks, exact candidate build identity and 97 integration vectors, but its own public/deployed/integratedCentral booleans remain false.

Wallet/Auth introspection must return a non-empty canonical `accountId`. Ordinary event, Ledger, billing settlement, Saga and reconciliation APIs are product-and-account scoped; Saga authority is derived from an existing event matching product, account, aggregate and correlation. `fabric.audit.export`, redelivery management and Saga recovery remain explicitly privileged product-wide scopes, while rate plans remain product metadata. One hundred simultaneous local account sessions passed exact event isolation under the Go race detector; this does not establish shared-Testnet or 1000-producer capacity.

Producer ingress admits a configurable bounded number of already signature-verified requests. Saturation returns `429 producer_backpressure` with `Retry-After: 1` before consuming the producer nonce, so bounded retries remain safe. Exact-source Linux CI released 1000 independently signed Producers together through real loopback HTTP into PostgreSQL, held observed server concurrency at 64, committed all 1000 with zero business errors after 3688 safe backpressure retries, then published all 1000 Outbox rows to file-backed JetStream. It ended with Outbox=0 and Stream=1000 in 7.723 seconds at 129.489 committed events/s. Separately, the same CI job wrote 10,000 PostgreSQL events with 90% assigned in order to one aggregate, rejected 1,000 simultaneous duplicates, restarted PostgreSQL, recovered with zero lost events, completed integrity validation in 851.920 ms, applied a 10,000-event Analytics replay at 387.932 events/s and idempotently skipped all 10,000 on the second replay. It terminated a real consumer subprocess with exit code 86 after its PostgreSQL Analytics fact and Inbox commit but before JetStream acknowledgement; redelivery produced one fact, one Inbox row and zero duplicate effects. A separate 256-event batch filled a 64 KiB JetStream: 18 events received acknowledgements, all 238 capacity rejections remained in PostgreSQL without entering DLQ, and explicit expansion to 8 MiB drained all 238 with exactly 256 final messages and zero duplicates. This is bounded single-primary and embedded single-node JetStream evidence, not a sustained-duration soak; replicated JetStream, automatic scaling, replica failover, shared Testnet and public capacity remain open.

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
