# YNX Resource Market integration handoff

## Identity

- Product owner: `16-resource-market`
- Contract: `release/integration/resource-market-contract.json`
- Contract version: `resource-market-integration-v1`
- Implementation source: `a940d2efa824bd9f43522ed792c9a563b55e1e11`
- Current phase: `FREEZE → INTEGRATE`
- Current product status: local candidate; not centrally integrated, staged, public, production-signed or store-released.

## Authority split

Resource Market owns provider registration, verified capacity, offers, matching, auctions, reservation, service lifecycle, signed usage metering and local dispute evidence. It does not own Wallet identity, asset finality, billing-ledger authority, public Explorer proof, central monitoring, public Website entry or protocol freeze.

A quote, accepted intent, reservation, service start, meter, service completion, HTTP success or provider statement is never asset settlement. Reservations are bound to the exact Offer referenced by the accepted Quote; capacity from a sibling Offer cannot satisfy or release that reservation. Settlement is accepted only when an authorized settlement identity supplies a non-empty asset, transaction hash, evidence and source; amounts exactly reconcile to signed meters; the order is `settlement_pending`; and the normalized transaction hash has not already been consumed by another receipt.

## Canonical integration inputs

- Wallet registry: `apps/resource-market/integration/canonical-wallet-registry.json`
- Wallet vectors: `apps/resource-market/integration/canonical-wallet-v1-test-vector.json`
- Existing central manifest: `apps/resource-market/integration/central-integration-manifest.json`
- Frozen product contract: `release/integration/resource-market-contract.json`
- Cross-product vectors: `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- Dependency acceptance: `docs/integration/DEPENDENCY_ACCEPTANCE.md`

## Required central behavior

1. Product 02 registers the exact client, bundle, callback, ordered scopes and P-256 product-device algorithm.
2. Product 29 freezes the exact method/path/body product-session proof semantics and one-to-one proxy route mapping.
3. Product 01 provides authoritative transaction finality and settlement evidence; product 16 does not infer finality.
4. Product 26 accepts only signed-meter and confirmed-settlement events, preserving idempotency and lineage.
5. Product 12 exposes public receipt evidence only after authoritative settlement.
6. Product 13 alerts on stale providers, metering failures, settlement reconciliation failure and receipt replay rejection.
7. Product 15 links provider failure and dispute/appeal evidence without gaining asset authority.
8. Product 28 publishes only release states that have direct evidence.

## Stable errors

The product returns a stable `code` with `errorId`, `requestId` and `traceId`. Settlement integrations must preserve at least:

- `RESOURCE_SELF_DEALING_REJECTED`
- `RESOURCE_AMOUNT_OUT_OF_RANGE`
- `RESOURCE_CAPACITY_UNAVAILABLE`
- `RESOURCE_METER_WINDOW_INVALID`
- `RESOURCE_METER_LIMIT`
- `RESOURCE_SETTLEMENT_STATE_INVALID`
- `RESOURCE_SETTLEMENT_EVIDENCE_REQUIRED`
- `RESOURCE_SETTLEMENT_RECONCILIATION`
- `RESOURCE_SETTLEMENT_REPLAY`

No consumer may translate these failures into success, paid, settled or refunded.

## Acceptance gate

Central integration remains false until every applicable dependency row in `DEPENDENCY_ACCEPTANCE.md` has direct evidence and the vectors in `CROSS_PRODUCT_TEST_VECTORS.json` pass against deployed Testnet services. Local tests are not public or central proof.

## Wallet/Auth owner addendum — multi-user Gateway recovery

Wallet/Auth source commit `7678c5764010e9d6ff31445687555ae848070e5c` adds a real loopback HTTP acceptance slice for 32 distinct Wallet accounts and 32 distinct P-256 product devices. It concurrently completes and introspects canonical Product Sessions, then proves exact-proof replay rejection, session revocation, mode-0600 state persistence and the same `REPLAY`/`REVOKED` failures after reconstructing the Gateway host.

Consumers must use `WA-MULTIUSER-ISOLATION-001`, `WA-REPLAY-RESTART-001` and `WA-REVOKE-RESTART-001` from `CROSS_PRODUCT_TEST_VECTORS.json`. This is local HTTP, filesystem and process-reconstruction evidence only. It does not prove public concurrency, staging capacity, a production load balancer, multi-region recovery, Monitor acceptance or a Testnet asset transaction; all corresponding publication booleans remain false absent direct evidence.

The opt-in public lifecycle probe introduced at `652b9da67a47e13f1826db07d423d464100939c1` was attempted with two bounded connections on 2026-08-13 and failed before an HTTP response with `UND_ERR_CONNECT_TIMEOUT`. HEAD requests independently returned 405 for completion, introspection and revoke, proving route resolution but not a working POST lifecycle. Fresh public completion/replay/revoke evidence therefore remains false; rerun only after public connectivity recovers.
