# YNX Data Fabric Dependency Acceptance

Source Commit: `8ee6d8f37ce945111ba76ddc2466c06164a6c4e8`
Release Candidate: `ynx-data-fabric-8ee6d8f37ce9`
Phase: `INTEGRATE`
Overall Status: `ACTIVE`

## Acceptance rule

A dependency is accepted only when its owner supplies a versioned contract, direct positive and negative test receipts, and a source-bound acceptance record. Local fixtures, copied schemas, loopback services and successful HTTP responses are not central acceptance.

| Dependency owner | Required contract | Current evidence | Acceptance | Recovery condition |
|---|---|---|---|---|
| YNX Wallet/Auth | Product Session, Device Challenge, introspection, expiry, revoke and nonce consumption | Data Fabric fail-closed adapter and local vectors | Pending | Execute accepted signed vectors against the canonical owner endpoint and record owner approval |
| YNX App Gateway | Product registration, bundle and device binding, signed request forwarding | Required headers and local authorization tests | Pending | Verify wrong product, bundle, device, scope, replay and tamper against the central gateway |
| YNX Pay | BFT invoice, authorization, receipt and refund authority | Local BFT bridge and Pay Ledger tests pass | Local only | Run the same flow on shared Testnet and retain source receipts and reconciliation evidence |
| YNX Chain Core | Frozen Bulk Data Commitment v1 reference reads plus finalized chain observations | Contract v1.21.0, implementation `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`, contract commit `cefb37144517e8f44fd9d0b41119bb5754bdb55d`; v21 bundle SHA-256 `d3f2d34d6b7671e673330b12c11fb26f685cd7f2eb9b958675de7ab2c67b3481` verified; Envelope v2 fail-closed adapter and positive/negative local tests | Contract consumed locally; shared Testnet pending | Run exact committed/unavailable/mismatch vectors against the accepted Gateway and retain owner-issued receipts |
| Shop, Merchant, Exchange, DEX, Quant, Trust, Resource, Cloud, AI, Mail and Creator owners | Registered Envelope v2 events, fee semantics, Saga steps and compensation | Canonical contract entries exist; `integratedCentral=false` | Pending | Each owner signs one authoritative contract and passes its positive and fail-closed vector set |
| YNX Oracle | Source-labeled market facts with as-of, version, coverage and unavailable state | Data Fabric source model can represent it | Pending | Reconciliation adapter accepts the Oracle contract without making Oracle an asset authority |
| YNX Explorer, Monitor and Trust | Event, Ledger, Saga, alert and correction evidence surfaces | Local APIs and metrics exist | Pending | Shared Testnet receipts are visible and correlated by event, request and audit identifiers |
| YNX Integration | Unique protocol freeze, merge order and shared Testnet | Envelope v2 and Schema Registry v2 are source-bound | Pending | Freeze the v2 contract and publish dependency acceptance receipts |
| YNX Security/SRE | PostgreSQL, JetStream, backup, deployment, alert, signer and artifact policy | Exact-source 1000 signed Producer HTTP requests committed through single-primary PostgreSQL and embedded file-backed JetStream with peak 64, zero business errors, Outbox 0 and Stream 1000; hotspot, duplicate-storm, restart, integrity, replay, process-crash and bounded capacity-pressure drills also pass | Pending | Run sustained ingress on replicated JetStream, automatic scaling, repeated consumer/process crashes, broker partition/leader-loss and PostgreSQL replica-failover drills; approve deployment and signing classes |
| YNX Website | Canonical page, truthful status, downloads, status and support links | Public metadata handoff exists with all public states false | Pending | Consume the handoff only after runtime and immutable hosting receipts exist |

## Current accepted boundary

The YNX Pay BFT source-to-Ledger path and the Chain Core Bulk Data Commitment reference boundary have executable local evidence. Chain Core v1.21.0 additionally carries local evidence for 13 service runtime identities, fail-closed public smoke logic and the candidate Gateway's exact build identity; those are candidate controls, not deployed-public proof. The Data Fabric boundary is deliberately read-only: `chainCommitmentId` is an external reference, owner is not accepted from an event, and raw content, recipient lists, access tokens and key material remain off-chain. Neither path is **centrally accepted** or **shared-Testnet verified**.

## Fail-closed behavior

Two consecutive dependency failures must preserve raw evidence, identify the owner and recovery condition, and leave the integration state false. Data Fabric must continue independent adapter, migration, recovery, security, SDK and test-vector work rather than inventing a replacement authority.
