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

Source `6b1f1f21a79861178ee7fc168ad21c2869296fd5` moves concurrency/rate admission into the canonical Node Host. Monitor and Integration consumers must accept `WA-ADMISSION-OBSERVABILITY-001`: 429 `RATE_LIMIT` and 503 `CONCURRENCY_LIMIT` are fail-closed canonical errors carrying request/trace/error IDs and state digest, with bounded metrics and redacted events. This candidate passed local HTTP and real CLI loopback verification but is not merged into the central/public Gateway; its integrated and deployed booleans remain false.

Wallet/Auth source `80291d53893aa6735d401c692a786fbcdbca8424` freezes the Sponsored UserOperation evidence boundary. Chain, Explorer, Monitor and Integration consumers must use `WA-UO-EVIDENCE-SUBSTITUTION-001`: a Bundler response is not final merely because one provider says success. The exact submitted PackedUserOperation, userOpHash, EntryPoint, sender/nonce, transaction hash/block, transaction recipient, Paymaster prefix and success status must agree across lookup, UserOperation receipt and inclusion transaction. Substitution, missing finality and failed execution return stable fail-closed errors. This passed an isolated local Hardhat EntryPoint/Paymaster flow, 115/115 Wallet-owned tests and the 117/117 full package audit. The additional 2/2 SampleEVMWriteCounter assertions are Developer-owned and passed without Wallet modifying or claiming ownership of their artifact. Fresh public chain reads reached chain 6423/block 997284, but `eth_getCode` remained unavailable with `-32601`; public EntryPoint, Bundler, Paymaster, receipt and Explorer states remain false.

Wallet/Auth source `2a19cb153952c7e3e1e253fea39186e2ebff194b` provides `WA-ERC4337-PUBLIC-READINESS-001`. The explicit public run verified EVM RPC chain 6423, while the only repository-discovered Bundler candidate returned Vercel HTTP 404 `DEPLOYMENT_NOT_FOUND`; no authoritative public EntryPoint address/runtime hash exists, so the probe refused to guess a fixture address and exited 2. Integration must treat exit 2 as not ready, never success. Acceptance requires chain 6423 on both endpoints, the exact frozen EntryPoint runtime hash and Bundler support for that same address before any public boolean can change. The current suite is 120/120 Wallet-owned and 122/122 full-package; the two additional Developer-owned assertions passed without Wallet modifying their artifact.
