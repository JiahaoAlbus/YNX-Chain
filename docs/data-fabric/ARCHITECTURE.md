# YNX Data Fabric Architecture

## Authority and data flow

`product producer → signed Envelope v2 → transactional Outbox → JetStream → Inbox + projection → Ledger/Saga/Reconciliation/Analytics`.

Products remain authoritative for their own state. Wallet/Auth controls identity
and session authority; Chain Core and verified receipts control chain finality.
The Ledger is authoritative only for its immutable financial postings. Analytics
is a derived, privacy-reduced projection and cannot alter events or journals.

The file store supports local recovery. The selected server repository uses
PostgreSQL transactions for event/Outbox, Inbox/projection, journal, Saga,
reconciliation and erasure records. Dispatchers lease Outbox work; a broker
failure leaves the committed Outbox row retryable. Consumers commit Inbox and
projection together, yielding an idempotent exactly-once *effect*, not a
network exactly-once claim.

## Invariants

- Envelope v2 rejects unknown fields, unsupported versions, tamper, sequence
  gaps, wrong authority and missing privacy classification.
- Ledger postings balance per asset/currency; corrections are new exact
  reversal entries.
- Replay and backfill use an approval-controlled, audited path.
- Source metadata labels authoritative, third-party, estimated, cached,
  AI-inferred, user-input and unavailable states.
- Raw secrets, private content, payment-card data and private signer material
  are excluded from canonical events and analytics.

## P0 Wallet boundary

Wallet Connectivity, Card, and Ecosystem Sharing schemas are candidates only.
They are asynchronous observers and never sit in
`DApp → Wallet → Approval → Standard Connection`. Their activation requires
Integration acceptance and a Data Fabric lease.

## Provenance

Current source, nine release states, direct evidence and external input gaps
are authoritative in `product-release.json`, `release/release-record.json`,
and `release/data-fabric/operator-inputs.request.json`.
