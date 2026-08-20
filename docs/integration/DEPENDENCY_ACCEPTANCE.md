# YNX Data Fabric Dependency Acceptance

Source Commit: `36beab9f670de4738205ffcb42d5a17630c37dfb`
Release Candidate: `ynx-data-fabric-36beab9f670d`
Phase: `INTEGRATE`
Overall Status: `ACTIVE`

## Acceptance rule

A dependency is accepted only when its owner supplies a versioned contract, direct positive and negative test receipts, and a source-bound acceptance record. Local fixtures, copied schemas, loopback services and successful HTTP responses are not central acceptance.

| Dependency owner | Required contract | Current evidence | Acceptance | Recovery condition |
|---|---|---|---|---|
| YNX Wallet/Auth | Product Session, Device Challenge, introspection, expiry, revoke and nonce consumption | Data Fabric fail-closed adapter and local vectors | Pending | Execute accepted signed vectors against the canonical owner endpoint and record owner approval |
| YNX App Gateway | Product registration, bundle and device binding, signed request forwarding | Required headers and local authorization tests | Pending | Verify wrong product, bundle, device, scope, replay and tamper against the central gateway |
| YNX Pay | BFT invoice, authorization, receipt and refund authority | Local BFT bridge and Pay Ledger tests pass | Local only | Run the same flow on shared Testnet and retain source receipts and reconciliation evidence |
| YNX Chain Core | Frozen Bulk Data Commitment v1 reference reads plus finalized chain observations | Contract v1.35.0, implementation `6f380265c7d3cc055984e33082f877b4e75303d5`, contract commit `144bc1a354ba390c0ae4e17a93597f799e57c3d6`; 2,913,495,533-byte v35 bundle SHA-256 `340d7572eee0a36b2cb9b0402abd36ad9ff7d206a56ad92d0db22728e7af607f` verified; Envelope v2 fail-closed adapter and positive/negative local tests | Contract consumed locally; shared Testnet pending | Run exact committed/unavailable/mismatch vectors against the accepted Gateway and retain owner-issued receipts |
| Shop, Merchant, Exchange, DEX, Quant, Trust, Resource, Cloud, AI, Mail and Creator owners | Registered Envelope v2 events, fee semantics, Saga steps and compensation | Canonical contract entries exist; `integratedCentral=false` | Pending | Each owner signs one authoritative contract and passes its positive and fail-closed vector set |
| YNX Oracle | Source-labeled market facts with as-of, version, coverage and unavailable state | Data Fabric source model can represent it | Pending | Reconciliation adapter accepts the Oracle contract without making Oracle an asset authority |
| YNX Explorer, Monitor and Trust | Event, Ledger, Saga, alert and correction evidence surfaces | Local APIs and metrics exist | Pending | Shared Testnet receipts are visible and correlated by event, request and audit identifiers |
| YNX Integration | Unique protocol freeze, merge order and shared Testnet | Envelope v2 and Schema Registry v2 are source-bound | Pending | Freeze the v2 contract and publish dependency acceptance receipts |
| YNX Security/SRE | PostgreSQL, JetStream, backup, deployment, alert, signer and artifact policy | Exact-source 1000 signed Producer HTTP requests committed through single-primary PostgreSQL and embedded file-backed JetStream; three-replica leader loss and TCP route partition/healing passed; exact-source Linux CI Run `31838660585` passed PostgreSQL 17 streaming-standby catch-up, primary stop, manual promotion, RPO-zero integrity and replay invariants on one Docker host, and both artifacts were downloaded with all 14 files SHA-256 verified | Pending | Run sustained replicated ingress, automatic endpoint failover/fencing, repeated consumer/process crashes and deployed multi-host failure drills; approve deployment and signing classes |
| YNX Website | Canonical page, truthful status, downloads, status and support links | Public metadata handoff exists with all public states false | Pending | Consume the handoff only after runtime and immutable hosting receipts exist |
| YNX Integration | Wallet Connectivity, Durable Ledger, Card and Ecosystem Sharing Event Contracts | Candidate-only schemas and vectors; central `connectionEvents` remains DRAFT and no runtime is active | Pending | Accept or reject the candidates, assign a Data Fabric light lease, then review activation, migration and rollback evidence |

## Current accepted boundary

The YNX Pay BFT source-to-Ledger path and the Chain Core Bulk Data Commitment reference boundary have executable local evidence. Chain Core v1.35.0 preserves Bulk Data Commitment, Wallet/Product Session, strategy-action, owner, finality, committed-state and application semantics. It adds only Strategy Vault custody invariants: a persisted vault owner equals its referenced StrategyMandate owner, and a closed vault retains zero YNXT. Local race, capacity and contract evidence passed; StreamBFT evidence retains its original `c3ddcec34234d1ac575a417a03f937c2bff22a4f` provenance because StreamBFT code did not change. No real Exchange/DEX routing, production deployment, central merge, public endpoint or Computer Control verification is proven. The contract has 110 vectors. Data Fabric records that additive owner evidence but does not redefine it. Chain Core central integration and promotion remain false. The Data Fabric boundary remains read-only and keeps raw content, recipient lists, access tokens and key material off-chain.

## Fail-closed behavior

Two consecutive dependency failures must preserve raw evidence, identify the owner and recovery condition, and leave the integration state false. Data Fabric must continue independent adapter, migration, recovery, security, SDK and test-vector work rather than inventing a replacement authority.
