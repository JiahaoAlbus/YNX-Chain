# YNX Data Fabric

YNX Data Fabric is the shared event, Saga, billing-ledger, and reconciliation plane for independent YNX products. It does not replace product authority, Wallet identity, chain state, or custody boundaries. An HTTP success only confirms request handling; a Saga reaches `completed` only after every authoritative state transition has committed.

## Authority boundaries

- Product services remain authoritative for their domain state.
- Canonical Wallet/Auth remains authoritative for identity, device binding, session expiry, and revocation.
- Chain RPC and verified receipts remain authoritative for on-chain finality.
- The immutable Billing Ledger is authoritative for charges, costs, fees, revenue recognition, reserves, refunds, and settlement accounting.
- The operational event store records facts and transport state. An analytics warehouse is a derived consumer and cannot modify authoritative records.
- Third-party, estimated, cached, AI-inferred, and user-provided data remains labeled through `source`, `asOf`, `version`, status, confidence, coverage, and explicit failure state.

## Reliability model

Producer state and Outbox records share one durable commit. Dispatch retries with bounded exponential backoff and moves exhausted delivery to a dead-letter record. Consumers commit their Inbox marker and local projection effect together. This provides an idempotent exactly-once *effect* for that local state transition; the platform does not claim exactly-once network delivery.

The production-selected transport adapter uses NATS JetStream publication acknowledgements, event-ID de-duplication, durable pull consumers and double acknowledgements. Capacity exhaustion rejects publication so the authoritative Outbox retains the event; it does not silently evict unseen history. Real embedded-server tests cover network outage, reconnect and redelivery. Those tests do not prove a replicated production cluster.

The PostgreSQL repository commits canonical event+Outbox, transactional projection+Inbox, Journal+Postings, Saga transitions, reconciliation and erasure records in controlled transactions. Concurrent dispatchers lease records with `FOR UPDATE SKIP LOCKED`; the worker and API verify migration checksums before starting. Production configuration selects this Repository, while local smoke explicitly selects the file Store. An isolated PostgreSQL 17.10 run directly verifies the initial migration, transaction/constraint behavior, distinct worker leases and repository integrity. Database deployment, replica failure and commit-boundary process-kill behavior remain unverified.

The initial schema also contains a derived `ynx_analytics.event_facts` sink. Its rows omit payloads and raw actor, account, session, aggregate, correlation, signature, and audit identifiers; subject identity is HMAC-pseudonymous. Projection and Inbox commit together. Recording an erasure deletes existing derived facts in the same transaction, and subsequent delivery records a suppressed Inbox effect without recreating analytics. This bounded sink is not a deployed warehouse or a complete KPI model.

The daemon embeds a read-only operator console at `/operator/`. Public health/version/metrics are fetched directly. Product records require the canonical Wallet browser bridge to produce exact request-bound headers for each paginated API call; the console omits browser credentials and never accepts Bearer tokens. The shell has local source/smoke evidence only—there is no real Wallet-session, screenshot, assistive-technology, or public deployment evidence.

Aggregate ordering is strict and starts at sequence 1. A gap is rejected until backfill supplies the missing event. A repeated event ID with the same digest is a duplicate. Reuse of an event ID with different content is treated as tampering. Unknown envelope fields and unsupported schema versions fail closed.

## Financial model

Journal entries are append-only and contain at least two postings. Debit and credit totals must balance independently for every asset and currency pair. Historical entries are never edited; corrections reference a prior entry and add new postings. Every journal record names its revenue-recognition boundary and source commit/release.

## Current verified scope

The Go core and SDK facade currently verify envelope validation and integrity, transactional file persistence, JetStream delivery behavior, PostgreSQL transaction boundaries with both a deterministic recording driver and isolated PostgreSQL 17.10, Outbox/Inbox idempotency, retry and dead-letter state, aggregate ordering, immutable balanced journals, correction history, all 13 required Saga contracts, reverse compensation, timeouts, manual recovery, reconciliation mismatch/coverage truth, and cold-restore integrity audit.

Central product integration, a public deployment, hosted downloads, production signing, and store release are not yet evidenced and remain false in the release record.
