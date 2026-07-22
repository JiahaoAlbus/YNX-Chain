# YNX Data Fabric Threat Model

## Protected assets

Canonical event integrity and order, Wallet/Auth session bindings, product authority boundaries, Billing Ledger history and balance, Saga recovery state, reconciliation evidence, signing/verification keys, privacy classifications, audit exports, backups and release provenance.

## Trust boundaries

Product producers are untrusted until canonical introspection binds product, bundle, account, session, device, exact method/path/body digest/scope, expiry, nonce, timestamp and device signature. The service independently verifies body digest and freshness, consumes successful nonce bindings, and rejects Bearer/cookie credentials. Event signing keys are bound to one product. The event bus provides at-least-once delivery and is not authoritative state. Consumers are untrusted until their Inbox commit makes the local effect idempotent. Analytics and AI are derived consumers and cannot mutate product or financial authority.

## Principal threats and controls

| Threat | Implemented control | Remaining work |
| --- | --- | --- |
| Forged or altered event | Strict envelope, product-bound HMAC key, digest/signature verification, source provenance | Move signing to hardware/managed asymmetric keys and rotation ceremony |
| Replay or duplicate delivery | Fresh request-bound introspection, bounded local nonce consumption, Event ID deduplication and consumer Inbox | Accepted central and durable multi-instance nonce evidence |
| Sequence manipulation | Strict product/service/aggregate sequence row, transaction advisory lock, unique immutable event index and integrity cross-check | Hot-partition and replica-failure stress |
| Cross-product data access | Product-bound key and principal; product-filtered reads/exports | Operator roles, product registration and central integration tests |
| Ledger fraud or history rewrite | Balanced per-asset journal, event/correlation link, database append-only triggers and immutable correction entries | Four-eyes correction approval and external audit |
| Saga partial completion | Deadline, reverse compensation, manual recovery and user-visible status | Real product adapters and emergency-exit drills |
| Broker crash or duplicate publish | Durable Outbox, retry/DLQ, duplicate-tolerant event log, Inbox effect | Supported multi-node broker and chaos evidence |
| Secret/private-content ingestion | Recursive prohibited-field scan, payload size limit, no bodies in logs, payload-free pseudonymous analytics and tested erasure suppression | DLP scanning, encrypted PII references and every downstream erasure workflow |
| Key theft | Absolute key files, restrictive modes, no key logging | Secure signer/HSM, rotation, revocation and compromise drill |
| Backup tampering | SHA-256/bytes/count Manifest plus full restore integrity audit | Encryption, immutable remote storage and scheduled restore drill |
| Resource exhaustion | Body/header/time limits, bounded error text, capped cursor pages, per-session instance limit and bounded PostgreSQL sample | Distributed Gateway quotas, disk limits, sustained/hot-partition capacity and abuse evidence |

## Fail-closed invariants

Unknown fields/version, missing introspection, wrong product/bundle/account/session/device, stale/replayed/tampered request binding, scope widening, expiry/revoke, unknown key, key/product mismatch, event tamper, sequence gap, unbalanced journal, missing event link, invalid correction, unsupported Saga kind, missing reconciliation authority and failed restore integrity all reject the operation.
