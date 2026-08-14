# YNX Data Fabric Dependency Acceptance

Source Commit: `b218b62688ab311513b650db0659390130735cad`
Release Candidate: `ynx-data-fabric-b218b62688ab`
Phase: `INTEGRATE`
Overall Status: `ACTIVE`

## Acceptance rule

A dependency is accepted only when its owner supplies a versioned contract, direct positive and negative test receipts, and a source-bound acceptance record. Local fixtures, copied schemas, loopback services and successful HTTP responses are not central acceptance.

| Dependency owner | Required contract | Current evidence | Acceptance | Recovery condition |
|---|---|---|---|---|
| YNX Wallet/Auth | Product Session, Device Challenge, introspection, expiry, revoke and nonce consumption | Data Fabric fail-closed adapter and local vectors | Pending | Execute accepted signed vectors against the canonical owner endpoint and record owner approval |
| YNX App Gateway | Product registration, bundle and device binding, signed request forwarding | Required headers and local authorization tests | Pending | Verify wrong product, bundle, device, scope, replay and tamper against the central gateway |
| YNX Pay | BFT invoice, authorization, receipt and refund authority | Local BFT bridge and Pay Ledger tests pass | Local only | Run the same flow on shared Testnet and retain source receipts and reconciliation evidence |
| YNX Chain Core | Frozen Bulk Data Commitment v1 reference reads plus finalized chain observations | Contract v1.27.0, implementation `a456daeca2f89af65ac39840efb40ada1cba2e29`, contract commit `f55934b7d5a24abf0e6de471441cceacc47ad5e7`; 111,258,870-byte v27 bundle SHA-256 `39120dabcb30a1c36c19751a3b6bc0e83be65364ca5f40b8592a1bb944503cd6` verified; Envelope v2 fail-closed adapter and positive/negative local tests | Contract consumed locally; shared Testnet pending | Run exact committed/unavailable/mismatch vectors against the accepted Gateway and retain owner-issued receipts |
| Shop, Merchant, Exchange, DEX, Quant, Trust, Resource, Cloud, AI, Mail and Creator owners | Registered Envelope v2 events, fee semantics, Saga steps and compensation | Canonical contract entries exist; `integratedCentral=false` | Pending | Each owner signs one authoritative contract and passes its positive and fail-closed vector set |
| YNX Oracle | Source-labeled market facts with as-of, version, coverage and unavailable state | Data Fabric source model can represent it | Pending | Reconciliation adapter accepts the Oracle contract without making Oracle an asset authority |
| YNX Explorer, Monitor and Trust | Event, Ledger, Saga, alert and correction evidence surfaces | Local APIs and metrics exist | Pending | Shared Testnet receipts are visible and correlated by event, request and audit identifiers |
| YNX Integration | Unique protocol freeze, merge order and shared Testnet | Envelope v2 and Schema Registry v2 are source-bound | Pending | Freeze the v2 contract and publish dependency acceptance receipts |
| YNX Security/SRE | PostgreSQL, JetStream, backup, deployment, alert, signer and artifact policy | Exact-source 1000 signed Producer HTTP requests committed through single-primary PostgreSQL and embedded file-backed JetStream with peak 64, zero business errors, Outbox 0 and Stream 1000; a separate three-node replicated JetStream drill changed stream leader after 64 events, accepted 64 more, preserved all 128 without duplicates and restored three current replicas; exact-source Linux CI Run `31811137802` kept three processes running, isolated the stream leader through TCP route proxies, rejected one isolated-side write into retained Outbox, committed 64 through the surviving quorum, healed and ended at 192 messages with zero duplicates and three current replicas | Pending | Run sustained replicated ingress, automatic scaling, repeated consumer/process crashes, deployed network partitions and PostgreSQL replica-failover drills; approve deployment and signing classes |
| YNX Website | Canonical page, truthful status, downloads, status and support links | Public metadata handoff exists with all public states false | Pending | Consume the handoff only after runtime and immutable hosting receipts exist |

## Current accepted boundary

The YNX Pay BFT source-to-Ledger path and the Chain Core Bulk Data Commitment reference boundary have executable local evidence. Chain Core v1.27.0 preserves the Bulk Data Commitment, Wallet/Product Session, strategy-action and prior build/quorum/execution-replay/fault-matrix semantics while adding checksummed versioned mode-0600 validator safety persistence, persist-before-vote authorization and fail-closed restart/tamper/regression/concurrency checks, plus a 102-vector integration contract. Data Fabric records that additive owner evidence but does not redefine it. Chain Core real partitions, packet loss, DDoS, State Sync, CometBFT/public differential replay, independent TLC/Apalache, WAN soak, central integration and promotion remain false. The separate Data Fabric JetStream route-partition drill does not upgrade any Chain Core claim. The Data Fabric boundary is deliberately read-only: `chainCommitmentId` is an external reference, owner is not accepted from an event, and raw content, recipient lists, access tokens and key material remain off-chain. Neither path is **centrally accepted** or **shared-Testnet verified**.

## Fail-closed behavior

Two consecutive dependency failures must preserve raw evidence, identify the owner and recovery condition, and leave the integration state false. Data Fabric must continue independent adapter, migration, recovery, security, SDK and test-vector work rather than inventing a replacement authority.
