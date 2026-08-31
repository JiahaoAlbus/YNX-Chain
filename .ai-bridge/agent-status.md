# Agent Status — YNX Data Fabric

- Status: `ACTIVE`
- Phase: `INTEGRATE`
- Workspace: exact configured YNX 26 Worktree verified
- Branch: `codex/final-data-fabric`
- Engineering Source Commit: `025fd6a17a2686ad458ffed4c7936623bcb37eec`
- Remote Source Commit: CI for the release metadata refresh is pending. The prior exact-source CI run remains historical evidence only and is not bound to this engineering source.
- Source evidence CI: Run `31811137802` passed both jobs at v26-bound head `58eff9dad4a0a3dc27105716928f2a9b7c4f6460`, including the three-replica JetStream TCP route-partition/heal gate. Its eleven-file artifact was downloaded and every SHA-256 value verified. Earlier leader-loss evidence remains preserved in Runs `31797308684` and `31799837096`.
- Concurrent writer: no Git writer detected; an existing CodexPro server process was left untouched
- Dirty state: candidate source, delivery documents and exact-source CI receipt are committed on the review branch; legacy recovery files remain preserved under `recovery/2026-07-23/`

## Verified capabilities

Canonical Envelope v2 and v1 migration compatibility, fail-closed external Chain Core Bulk Data Commitment references, Schema Registry v2, transactional Outbox and Inbox, idempotent consumers, retry, DLQ, replay, Saga recovery, immutable double-entry corrections, atomic usage billing, same-product account isolation, 100 simultaneous local canonical account sessions, bounded producer ingress and 1000 simultaneous local producer completion, PostgreSQL 10,000-event hotspot/duplicate/restart/long-replay drill, exact-source Linux CI one-host PostgreSQL streaming-standby catch-up/manual-promotion/RPO-zero/integrity-replay drill, one real post-commit/pre-ack consumer subprocess crash with zero duplicate effect, bounded JetStream capacity rejection with PostgreSQL Outbox retention and explicit-expansion recovery, one bounded three-node replicas=3 JetStream stream-leader stop/re-election/restart/catch-up drill, one bounded three-live-process TCP route-partition/fail-closed-Outbox/quorum-progress/heal drill, Pay BFT ingestion and refund reconciliation, API, Go and TypeScript SDKs, CLI, PostgreSQL migrations through 0006, backup and restore, operator console, package installation and cold-start gates.

The Wallet Connectivity Event Contract is a CANDIDATE-only schema plus vectors and static privacy/activation test. It is not in Schema Registry v2, has no runtime consumer, and must not block standard wallet connection.

## Unverified or incomplete states

Central owner acceptance, complete product adapter set, shared Testnet E2E, staging deployment, public deployment, immutable public download, production signing, sustained PostgreSQL-plus-replicated-JetStream signed HTTP Producer traffic, sustained hotspot duration, repeated consumer/process crash on replicated infrastructure, deployed partition/packet-loss and repeated leader loss, automated PostgreSQL endpoint/fencing and multi-host/regional failure, production-shaped capacity, live support and status endpoints.

## Exact next action

Obtain Integration review and a Data Fabric light lease before activating the Wallet Connectivity candidate. Keep public URLs and downloads false until runtime, signer, immutable-hosting and Website receipts exist. Require independent approval before merging PR `#92`.
