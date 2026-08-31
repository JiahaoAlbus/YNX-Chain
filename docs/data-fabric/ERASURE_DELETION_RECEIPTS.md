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
