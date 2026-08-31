# Privacy-safe erasure deletion receipts

Data Fabric keeps authoritative financial, audit, and legal-hold records under
their declared retention classes. A subject-erasure request instead suppresses
future analytics processing and deletes only derived rows from
`ynx_analytics.event_facts`.

Migration 0008 records one immutable receipt for each newly committed erasure:

- a pseudonymous subject reference;
- the existing audit request identifier and UTC request time;
- the number of derived analytics facts deleted; and
- a SHA-256 receipt over only those bounded fields.

The receipt excludes raw account identifiers, event identifiers, payloads,
messages, keys, signatures, and developer diagnostics. The deletion, receipt,
and erasure request use one serializable PostgreSQL transaction; failure rolls
back all three. The receipt is append-only and its audit/request fields must
match the immutable erasure request.

An older request without a receipt fails closed on an idempotent retry or
integrity audit. It must be resolved through an audited migration procedure;
the runtime will not claim that its historic projection deletion completed.

This is source-level candidate evidence only. It neither provisions a database
nor establishes a public Data Fabric endpoint, deployment, or runtime proof.

## Explicit derived-analytics retention sweeps

Migration 0009 adds an append-only `ynx_analytics.retention_sweeps` audit
record. `SweepExpiredAnalytics` accepts an audited execution identifier plus
explicit UTC cutoffs and deletes only payload-free `transient` and
`operational` rows from `ynx_analytics.event_facts`. It never selects canonical
events, Outbox, Inbox, Ledger, erasure receipts, `financial-7y`, `audit-7y`, or
`legal-hold` records. The deletion counts and cutoffs commit atomically in one
serializable transaction; reusing an audit ID with the same canonical tuple
returns the prior result, while changed parameters fail closed.

The repository deliberately contains no timer or implicit retention duration.
An approved policy and scheduler/runtime binding are still required before any
recurring execution. No production policy, database migration, scheduled job,
or public endpoint is claimed by this source-level slice.
