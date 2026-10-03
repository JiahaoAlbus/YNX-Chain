# Cancellation replay ownership and durable reservation recovery

Base: dc44c07dcda0862abaed06fab557a40dfebfb610. This is an Exchange-owned engine correction and direct regression evidence, not a shared Wallet, authorization, schema, deployment or installation change.

## Reproduced defect and correction

`TestCancelledOrderReplayRemainsBoundToOwner` first failed with a foreign order ID and nil error (0.445s package run). A second controlled fixture account signed its own cancellation payload for the cancelled order's same ID/idempotency key. The old engine returned the cached order before checking its account. No public probing or real account request was performed.

The correction checks order existence and exact account ownership before the existing idempotency branch. Existing owner payload/signature validation, cancellation digest, persisted record shape and exact owner replay semantics remain unchanged. A foreign replay now returns `ErrForbidden` with a zero Order; neither balance nor audit state changes. This fixes the product-owned engine boundary; it does not widen the frontend's read-only Product Session permissions or deliver the shared write producer.

## Executed controlled tests

- Local unit red-to-green: foreign replay rejected, three exact owner replays return the same cancelled order, full state digest and both ledger balances unchanged.
- Real isolated PostgreSQL, two independent HTTP-serving OS processes and two fixture accounts. A maker of two test units is partially filled by one unit before cancellation. Twelve same-key cancellation requests run across both processes; successful replies or optimistic-concurrency conflict are the only permitted outcomes. The explicit same-body retry confirms cancellation.
- Both processes stop; a third process starts using persisted PostgreSQL state. There is still exactly one trade and two orders, no remaining reservations, and native balances plus quote balances/fees conserve the initial fixture funding.
- Three subsequent owner HTTP replays return byte-exact original cancellation receipts. The other account's signed replays return HTTP 403 without the order ID. Full persisted state digest remains unchanged.
- Final focused race regression, including conservation assertions: three consecutive repetitions PASS, 12.491s.
- Initial complete Exchange race regression with real PostgreSQL enabled: PASS, 40.378s. Final complete regression including conservation assertions: PASS, 39.016s. `git diff --check` PASS; retained isolated test schema count after completion is zero.

PostgreSQL is a retained loopback-only QA cluster with per-test isolated schemas. Fixture keys/funding and the two-account test Gateway are not canonical public Wallet approval, real custody or public trading evidence. No schema migration or production data was involved. Source/public/runtime/native/Wallet/Product Session and real transaction acceptance remain separate and unverified. This source delta must be consumed through the existing release owner with compatible backend/frontend identity and rollback; no Host, formal artifact pin, endpoint or production mutation is authorized here.
