# Data Fabric Operations

Start only after migration verification, strict configuration validation and
least-privilege TLS/secret-manager references. Do not paste or log seeds,
private keys, PEM material, tokens, database credentials or PAN/CVV.

The PostgreSQL runtime accepts only a `postgres://` or `postgresql://` secret
URI with exactly `sslmode=verify-full`; missing, disabled, or downgradeable
transport fails before a database dial. Database-at-rest encryption, backup
encryption, KMS authority, and certificate issuance remain external
Security/SRE controls and must be bound by the approved runtime mapping.

For delivery incidents: preserve the Outbox, observe broker/database state,
use bounded retry, inspect dead-letter records, obtain approved replay/backfill
authorization, and retain audit identifiers. Do not manually mark an event or
financial effect complete.

For Ledger incidents: keep historical entries immutable; issue only an audited
exact reversal through the correction route. For restoration, validate event
integrity, Inbox idempotency, journal balance and reconciliation state before
resuming dispatch.

Deployment, public routing, artifact signing, capacity windows and support
ownership require the external input records in
`release/data-fabric/operator-inputs.request.json`.
