# YNX Data Fabric Dependency Acceptance

Source Commit: `ed06ce8053d165122a0fa550f59af7c88d3b3c6b`
Release Candidate: `ynx-data-fabric-ed06ce8053d1`
Phase: `INTEGRATE`
Overall Status: `ACTIVE`

## Acceptance rule

A dependency is accepted only when its owner supplies a versioned contract, direct positive and negative test receipts, and a source-bound acceptance record. Local fixtures, copied schemas, loopback services and successful HTTP responses are not central acceptance.

| Dependency owner | Required contract | Current evidence | Acceptance | Recovery condition |
|---|---|---|---|---|
| YNX Wallet/Auth | Product Session, Device Challenge, introspection, expiry, revoke and nonce consumption | Data Fabric fail-closed adapter and local vectors | Pending | Execute accepted signed vectors against the canonical owner endpoint and record owner approval |
| YNX App Gateway | Product registration, bundle and device binding, signed request forwarding | Required headers and local authorization tests | Pending | Verify wrong product, bundle, device, scope, replay and tamper against the central gateway |
| YNX Pay | BFT invoice, authorization, receipt and refund authority | Local BFT bridge and Pay Ledger tests pass | Local only | Run the same flow on shared Testnet and retain source receipts and reconciliation evidence |
| YNX Chain Core | Frozen Bulk Data Commitment v1 reference reads plus finalized chain observations | Contract v1.30.0, implementation `aab0b6b9fc28b40ef8715214cd95360734db4c48`, contract commit `3bcae14f9d42fd2fbcce2211a7c51a737f8ed464`; 141,977,791-byte v30 bundle SHA-256 `496032529043ea2f589dff6ad36ab8fb813399562291baca32ccca8358ce8162` verified; Envelope v2 fail-closed adapter and positive/negative local tests | Contract consumed locally; shared Testnet pending | Run exact committed/unavailable/mismatch vectors against the accepted Gateway and retain owner-issued receipts |
| Shop, Merchant, Exchange, DEX, Quant, Trust, Resource, Cloud, AI, Mail and Creator owners | Registered Envelope v2 events, fee semantics, Saga steps and compensation | Canonical contract entries exist; `integratedCentral=false` | Pending | Each owner signs one authoritative contract and passes its positive and fail-closed vector set |
| YNX Oracle | Source-labeled market facts with as-of, version, coverage and unavailable state | Data Fabric source model can represent it | Pending | Reconciliation adapter accepts the Oracle contract without making Oracle an asset authority |
| YNX Explorer, Monitor and Trust | Event, Ledger, Saga, alert and correction evidence surfaces | Local APIs and metrics exist | Pending | Shared Testnet receipts are visible and correlated by event, request and audit identifiers |
| YNX Integration | Unique protocol freeze, merge order and shared Testnet | Envelope v2 and Schema Registry v2 are source-bound | Pending | Freeze the v2 contract and publish dependency acceptance receipts |
| YNX Security/SRE | PostgreSQL, JetStream, backup, deployment, alert, signer and artifact policy | Exact-source 1000 signed Producer HTTP requests committed through single-primary PostgreSQL and embedded file-backed JetStream; three-replica leader loss and TCP route partition/healing passed; exact-source Linux CI Run `31838660585` passed PostgreSQL 17 streaming-standby catch-up, primary stop, manual promotion, RPO-zero integrity and replay invariants on one Docker host, while artifact download/hash verification remains pending | Pending | Download and hash-verify the failover artifact, then run sustained replicated ingress, automatic endpoint failover/fencing, repeated consumer/process crashes and deployed multi-host failure drills; approve deployment and signing classes |
| YNX Website | Canonical page, truthful status, downloads, status and support links | Public metadata handoff exists with all public states false | Pending | Consume the handoff only after runtime and immutable hosting receipts exist |

## Current accepted boundary

The YNX Pay BFT source-to-Ledger path and the Chain Core Bulk Data Commitment reference boundary have executable local evidence. Chain Core v1.30.0 preserves the Bulk Data Commitment, Wallet/Product Session, strategy-action and prior validator lease/vote-signer semantics. It adds authenticated SafetyStore v2 with separate checksum/seal domains and an Ed25519 seal over Chain ID, exact state, checksum and configured validator key. Different keys, legacy unsealed state, a recomputed checksum without a valid seal, invalid signer output and seal failure fail closed; ValidatorVoteSigner requires this authenticated store. Replay of an older validly signed snapshot is not independently rejected without a trusted external monotonic rollback anchor. That anchor and external production signer custody are unprovided. The contract has 105 vectors. Data Fabric records that additive owner evidence but does not redefine it. Chain Core real partitions, packet loss, DDoS, State Sync, CometBFT/public differential replay, independent TLC/Apalache, WAN soak, central integration and promotion remain false. The Data Fabric boundary remains read-only and keeps raw content, recipient lists, access tokens and key material off-chain. Neither path is **centrally accepted** or **shared-Testnet verified**.

## Fail-closed behavior

Two consecutive dependency failures must preserve raw evidence, identify the owner and recovery condition, and leave the integration state false. Data Fabric must continue independent adapter, migration, recovery, security, SDK and test-vector work rather than inventing a replacement authority.
