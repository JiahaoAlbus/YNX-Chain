# Data Fabric Handoff

Propose privacy-safe asynchronous connection events, outbox/inbox retry,
diagnostics, replay protection, and aggregation. Data Fabric must not appear in
the synchronous Wallet connection, signing, or transaction critical path.

## Integration acceptance — 2026-08-20

`connectionEvents@1.0.0-p0.0` is accepted from Data Fabric candidate source
`63a7d633a10bcb8f7f929a2aa67af32074f49ea7`, its release binding
`f393d373e473822d5d3dedb5e617d4c28a86c951`, and the current PR #92 evidence
head `766e1a66352eecaf88f024088e6a9dfcdc2d01d8`. Integration verified the
candidate's privacy boundary, explicit product-session versus standard-wallet
lifecycle separation, per-product pseudonym and ordering fields, idempotency
and replay vectors, finalized Faucet requirements, Card redaction, and passed
current CI/focused tests.

The Light Lease is active only for
`CONNECTION_EVENTS_RUNTIME_ADAPTER_SLICE`: Data Fabric-owned producer/consumer
adapters, Outbox, Inbox, retry/replay and diagnostics. It must not modify or
gate Wallet, Gateway, Card UI, Finance UI or Explorer UI. Runtime deployment
and public verification remain false until separately evidenced.
