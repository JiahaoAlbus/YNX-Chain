# Agent Status — YNX Data Fabric

- Status: `ACTIVE`
- Phase: `INTEGRATE`
- Workspace: exact configured YNX 26 Worktree verified
- Branch: `codex/final-data-fabric`
- Engineering Source Commit: `a0f92680d0df50ed131b5eb422a851f5874c9045`
- Remote Source Commit: current Engineering Source `a0f92680d0df50ed131b5eb422a851f5874c9045` is on review Branch `codex/data-fabric-typescript-sdk-20260814`
- Source CI: final evidence-head Run `31788198895` passed both jobs at `d0d7e4d6ce5bfbeeafcc21d3c9186aa6e52434dc`; engineering source remains `a0f92680d0df50ed131b5eb422a851f5874c9045`, and restart/replay, consumer-process-crash and transport-backpressure artifacts were downloaded and SHA-256 verified.
- Concurrent writer: no Git writer detected; an existing CodexPro server process was left untouched
- Dirty state: reviewed and verified source-bound evidence slice awaiting commit and push; legacy recovery files are preserved under `recovery/2026-07-23/`

## Verified capabilities

Canonical Envelope v2 and v1 migration compatibility, fail-closed external Chain Core Bulk Data Commitment references, Schema Registry v2, transactional Outbox and Inbox, idempotent consumers, retry, DLQ, replay, Saga recovery, immutable double-entry corrections, atomic usage billing, same-product account isolation, 100 simultaneous local canonical account sessions, bounded producer ingress and 1000 simultaneous local producer completion, PostgreSQL 10,000-event hotspot/duplicate/restart/long-replay drill, one real post-commit/pre-ack consumer subprocess crash with embedded JetStream redelivery and zero duplicate effect, bounded JetStream capacity rejection with PostgreSQL Outbox retention and explicit-expansion recovery, Pay BFT ingestion and refund reconciliation, API, Go and TypeScript SDKs, CLI, PostgreSQL migrations through 0006, backup and restore, operator console, package installation and cold-start gates.

## Unverified or incomplete states

Central owner acceptance, complete product adapter set, shared Testnet E2E, staging deployment, public deployment, immutable public download, production signing, PostgreSQL-plus-JetStream signed HTTP Producer repetition, sustained hotspot duration, repeated consumer/process crash on replicated infrastructure, broker partition/leader loss, PostgreSQL replica failover, production-shaped capacity, live support and status endpoints.

## Exact next action

Refresh the verified recovery bundle, then repeat signed Producer traffic across PostgreSQL plus JetStream with sustained and replicated-service failure drills. Prepare the existing Website handoff for publication, but keep public URLs and downloads false until runtime, signer, immutable-hosting and Website receipts exist. Require independent approval before merging PR `#92`.
