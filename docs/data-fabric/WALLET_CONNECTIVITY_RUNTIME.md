# Accepted Connection Events Runtime Adapter

`connectionEvents@1.0.0-p0.0` is accepted by Integration at central commit `e13fca35d890427a25bff9d6122e7c7581247cdb`. The activated Data Fabric input is [wallet-connectivity-events-v1.accepted.schema.json](../../schemas/data-fabric/wallet-connectivity-events-v1.accepted.schema.json); the pre-acceptance candidate remains unchanged for provenance.

The adapter is intentionally asynchronous. A Wallet, Product Session, Card, or Financial product records its own authoritative outcome first, then may call `EmitConnectionEvent` / `datafabricpostgres.EmitConnectionEvent`. The adapter builds a signed canonical Envelope v1 and writes the existing transactional Event + Outbox pair. A Data Fabric, database, broker, analytics, ledger, or diagnostics failure is observable to the producer but cannot be interpreted as Wallet Offline and cannot block connect, approval, signing, transaction, or Product Session control flow.

`ConsumeConnectionDiagnostics` applies bounded aggregates with the existing Inbox in the same atomic effect. It counts event type, result, platform, transport, error class, connection attempts, approval/reconnect success, Product Session upgrade, endpoint schema mismatch, retired clients, Faucet status, 400/403, endpoint class, and a bounded major-version bucket. It never projects a connection pseudonym, account, address, raw endpoint, credential, private message, key, signature, PAN, CVV, or funding amount.

The accepted [consumer conformance fixture](../../schemas/data-fabric/wallet-connectivity-events-v1.accepted.conformance.vectors.json) covers the file Store and PostgreSQL implementations of `connection-diagnostics-v1`. Only a transient producer input of `6423` or canonical `0x1917` may produce a persisted `0x1917` event. Legacy `9102`/`0x238e` and raw error, developer-message, account, or session fields are rejected before Event, Outbox, Inbox, or diagnostics persistence.

Retry, dead-letter, audited requeue, ordering, duplicate handling, restart recovery, and replay use the existing Outbox/Inbox/Dispatcher and PostgreSQL equivalents. Transport is at-least-once; exactly-once applies only to the idempotent Inbox-protected aggregate effect.

`faucet.completed` is rejected unless it carries an accepted request ID, transaction hash, authoritative receipt ID, and `finalized` proof. A deep-link return cannot complete it. This runtime does not emit or infer `card.funded`: the Integration Card contract still has `canonicalFunding.recipient=null` and `PENDING_CHAIN_ACCOUNT_ISSUANCE`; no Card balance or funding result is claimed.

This is local runtime code and migration evidence only. It is not central integration, a deployed endpoint, public verification, a Wallet integration, or Card E2E funding proof.
