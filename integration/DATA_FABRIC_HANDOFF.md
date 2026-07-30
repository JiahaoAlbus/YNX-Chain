# YNX Data Fabric Integration Handoff

This handoff is merge input for the owning product tasks. It does not authorize edits to Wallet, Gateway, Website, Chain Core, or product worktrees, and it does not claim central integration.

## Canonical Wallet and App Gateway

Accept only the strict request/response contracts in `schemas/data-fabric/canonical-introspection-request-v1.schema.json` and `canonical-introspection-response-v1.schema.json`. The Gateway must verify that the device signature covers this canonical tuple in order:

`version=1`, session ID, device ID, product, bundle ID, request ID, nonce, RFC3339Nano timestamp, uppercase method, path plus canonical query, lowercase SHA-256 of the exact body bytes, and required scope.

It must consume the nonce durably for the session/device domain, check product registration and bundle ownership, reject expired/revoked/inactive sessions and scope widening, and return `active=true` plus `requestBound=true` only after every binding succeeds. Never return a wildcard scope. Data Fabric independently enforces body digest, freshness, a bounded local replay cache, exact response equality and expiry.

Acceptance vectors are the local tests `TestHTTPAuthorizerFailsClosedAcrossCanonicalAuthorityBoundaries`, `TestServerRejectsStaleAndReplayedCanonicalBindings`, and `TestServerRejectsContentDigestTamperingBeforeIntrospection`. Central completion requires the same vectors using real Wallet-created sessions and signatures.

## Product producers and consumers

Each owner listed in `integration/product-event-contracts.json` must:

1. Register one product-bound integrity key ID without sharing key material with Data Fabric source or chat.
2. Emit the strict envelope from the supported SDK only after its own authoritative transaction commits its product state and Outbox fact.
3. Preserve `product/service/aggregateId` sequence, correlation/causation, source commit/release, privacy and retention truth.
4. Treat HTTP `202 committed-to-outbox` as transport acceptance, never Saga or business completion.
5. Consume through a durable Inbox and commit the business effect plus Inbox marker together.
6. Supply authoritative success and compensation events for its canonical Saga. Failure, timeout and manual recovery must remain user-visible.
7. Supply balanced journal entries only at the documented revenue-recognition boundary and preserve explicit fee consent where a user account is debited.
8. Run duplicate, reused-ID tamper, gap, redelivery, crash-before-ack, broker-outage, compensation and correction vectors.

No product may send raw credentials, keys, PAN/CVV, private Mail/Social/Cloud content, or raw AI prompt/output into the general event payload or analytics sink.

## Chain, Pay, Exchange, DEX and Quant reconciliation

The owning services must provide real Testnet observation adapters with source, as-of time, version, authority status, failure, confidence/coverage where applicable, stable reference ID and a SHA-256 evidence hash. A run is `matched` only when every required source is present and every amount agrees per asset/currency. Unavailable is not zero and HTTP success is not settlement finality.

## Website handoff

Use `public-product-metadata.json` and `product-release.json`. Publish no route until canonical/support/privacy/security/status URLs and public evidence exist. The Website owner retains SSR/SSG, JSON-LD, sitemap and search-engine responsibilities. The local unavailable-state console captures are evidence, not public marketing screenshots.

## Analytics and privacy

The current `ynx_analytics.event_facts` sink is derived, payload-free and HMAC-pseudonymous. A deployed warehouse owner must preserve its source/as-of/version/status/confidence/coverage fields, implement retention partitions and propagate erasure to every downstream table. Analytics cannot write back to events, Ledger, Sagas, reconciliation or product authority.

## Acceptance evidence returned by each owner

- exact source commit and release;
- schema/SDK version;
- product registration and accepted bundle IDs;
- producer event IDs and consumer Inbox effect receipts;
- Saga success plus compensation/manual-recovery Audit IDs;
- journal entry IDs and balance verification;
- reconciliation run IDs, authority references and evidence hashes;
- failure/replay/outage logs;
- privacy export/erasure receipt where the flow is account-bound;
- deployed environment and public URL states using the nine distinct release booleans.

All keys, credentials, signing assets, provider secrets and production approvals remain operator inputs through secure systems, never values pasted into this handoff.
