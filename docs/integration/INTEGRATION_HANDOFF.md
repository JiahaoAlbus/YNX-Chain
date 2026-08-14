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

## Wallet/Auth central release-evidence slice

The Wallet/Auth Integration thread freezes platform release truth in `release/integration/wallet-auth-release-evidence-matrix.json` and documents it in `docs/integration/WALLET_AUTH_RELEASE_EVIDENCE.md`. This slice consumes the five product Owner branches at their recorded remote SHAs; it does not redefine Chain Core network authority or the Wallet/Auth protocol.

The current consumed checkpoints are Core `0c747c6030b5a475a1f12dc7e57345555c23055d`, Web `deca6f4fe29dafdccb3736f237e6e8829e094eec`, Android `f1edbec46ad4300beec406873b03db2da7c72e4b`, iOS/macOS `7a3a110fb7cd9a33512ce4db87ddd8387cb730d5`, and Desktop/CLI/SDK `2802876f8470264c4a8819f1426e28f957a09289`. iOS run 31786857637 directly preserves steps 14–17: signed entitlement verification, install/cold/second launch, Keychain add/read/delete 0/0/0, malformed callback fail-close and Universal Link policy fail-close. Step18 recovery is the sole failure. The semantic recovery fix `ee1457e8…` remains in-progress and adds no truth. Web artifacts remain unpublished; macOS arm64 CLI remains the sole official YNX download.

Every platform separately tracks build, install, cold launch, second launch, Testnet, signing, transaction, callback, reconnect, hosted download, production signing and store release. A true value requires an explicit direct evidence binding. Simulator, disposable, unpacked, temporary, unsigned and ad-hoc artifacts remain non-production by construction.

Mutation gates are frozen in `docs/integration/WALLET_AUTH_RELEASE_TEST_VECTORS.json` and executed by `node --test scripts/verify/wallet-auth-release-evidence-matrix.test.mjs`. They prove that unsupported true claims, disposable-production promotion, pending-platform promotion, unknown evidence and hosted-download claims without public download evidence fail closed.

The public evidence audit is frozen in `release/integration/wallet-auth-public-evidence-audit.json` and checked by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. Public RPC, gateway health and website reachability never imply that the latest frozen Core source is deployed, that exact downloads are hosted, or that unpacked/ad-hoc/unsigned artifacts are production releases.

The central machine-readable Release Record is `release/integration/wallet-auth-release-record.json`. Website-facing download candidates are separately held in `release/integration/wallet-auth-public-download-metadata.json`; `scripts/verify/wallet-auth-public-download-metadata-check.mjs` prevents local, temporary, unpacked, disposable, simulator, ad-hoc or unsigned candidates from becoming public download metadata.
