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
| YNX Chain Core | Frozen Bulk Data Commitment v1 reference reads plus finalized chain observations | Contract v1.32.0, implementation `1974dba384a2f0ac1124f4de7025f772fe94bd03`, contract commit `93a95c0005e09ba21f61245f0e001e2acf4a1080`; 146,122,768-byte v32 bundle SHA-256 `666118d2fce9d006341142616f03dcf7641748ad3f430d1f3a5f360bc965cbd3` verified; Envelope v2 fail-closed adapter and positive/negative local tests | Contract consumed locally; shared Testnet pending | Run exact committed/unavailable/mismatch vectors against the accepted Gateway and retain owner-issued receipts |
| Shop, Merchant, Exchange, DEX, Quant, Trust, Resource, Cloud, AI, Mail and Creator owners | Registered Envelope v2 events, fee semantics, Saga steps and compensation | Canonical contract entries exist; `integratedCentral=false` | Pending | Each owner signs one authoritative contract and passes its positive and fail-closed vector set |
| YNX Oracle | Source-labeled market facts with as-of, version, coverage and unavailable state | Data Fabric source model can represent it | Pending | Reconciliation adapter accepts the Oracle contract without making Oracle an asset authority |
| YNX Explorer, Monitor and Trust | Event, Ledger, Saga, alert and correction evidence surfaces | Local APIs and metrics exist | Pending | Shared Testnet receipts are visible and correlated by event, request and audit identifiers |
| YNX Integration | Unique protocol freeze, merge order and shared Testnet | Envelope v2 and Schema Registry v2 are source-bound | Pending | Freeze the v2 contract and publish dependency acceptance receipts |
| YNX Security/SRE | PostgreSQL, JetStream, backup, deployment, alert, signer and artifact policy | Exact-source 1000 signed Producer HTTP requests committed through single-primary PostgreSQL and embedded file-backed JetStream; three-replica leader loss and TCP route partition/healing passed; exact-source Linux CI Run `31838660585` passed PostgreSQL 17 streaming-standby catch-up, primary stop, manual promotion, RPO-zero integrity and replay invariants on one Docker host, and both artifacts were downloaded with all 14 files SHA-256 verified | Pending | Run sustained replicated ingress, automatic endpoint failover/fencing, repeated consumer/process crashes and deployed multi-host failure drills; approve deployment and signing classes |
| YNX Website | Canonical page, truthful status, downloads, status and support links | Public metadata handoff exists with all public states false | Pending | Consume the handoff only after runtime and immutable hosting receipts exist |

## Current accepted boundary

The YNX Pay BFT source-to-Ledger path and the Chain Core Bulk Data Commitment reference boundary have executable local evidence. Chain Core v1.32.0 preserves the Bulk Data Commitment, Wallet/Product Session, strategy-action and authenticated validator store/vote-signer semantics. Its external monotonic SafetyRollbackAnchor protocol remains compare-and-swap of the complete authenticated envelope before local replacement, exact readback, and restart recovery from anchor-ahead crashes or older local snapshot replay. v32 adds only the deployable HTTPS client boundary: TLS 1.3 mutual authentication, explicit CA/client material, proxy and redirect rejection, bounded strict JSON, no-store, ETag/envelope digest binding and exact committed-record verification. Timeout, unavailable/conflict, tamper, unsafe recovery target and unanchored-local bootstrap fail closed. Production endpoint, production CA/client credentials, independent anchor authority deployment, remote recovery drill and external production signer custody remain unprovided. The contract has 107 vectors. Data Fabric records that additive owner evidence but does not redefine it. Chain Core real partitions, packet loss, DDoS, State Sync, CometBFT/public differential replay, WAN soak, central integration and promotion remain false. The Data Fabric boundary remains read-only and keeps raw content, recipient lists, access tokens and key material off-chain.

## Fail-closed behavior

Two consecutive dependency failures must preserve raw evidence, identify the owner and recovery condition, and leave the integration state false. Data Fabric must continue independent adapter, migration, recovery, security, SDK and test-vector work rather than inventing a replacement authority.
