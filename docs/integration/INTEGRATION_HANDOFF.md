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

The current consumed checkpoints are Core `774a1f756890043e88626d13b6c9679a2ad6d288`, Web `ae55e8272018979abb6cb393307755c063f71f38`, Android `4739a60e1fa0e3d0b6862e129330f9e9ca202887`, iOS/macOS `04450cff296511018447e5d4886803081149f596`, and Desktop/CLI/SDK `905ac1e5479b08e6b2d9e50a91bef01cbe7d58ef`. Each consumed increment was checked through its remote commit parent, tree and exact evidence blob. Source-only or Owner-unauthorized descendants remain pending.

Every platform separately tracks build, install, cold launch, second launch, Testnet, signing, transaction, callback, reconnect, hosted download, production signing and store release. A true value requires an explicit direct evidence binding. Simulator, disposable, unpacked, temporary, unsigned and ad-hoc artifacts remain non-production by construction.

Mutation gates are frozen in `docs/integration/WALLET_AUTH_RELEASE_TEST_VECTORS.json` and executed by `node --test scripts/verify/wallet-auth-release-evidence-matrix.test.mjs`. They prove that unsupported true claims, disposable-production promotion, pending-platform promotion, unknown evidence and hosted-download claims without public download evidence fail closed.

The public evidence audit is frozen in `release/integration/wallet-auth-public-evidence-audit.json` and checked by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. Public RPC, gateway health and website reachability never imply that the latest frozen Core source is deployed, that exact downloads are hosted, or that unpacked/ad-hoc/unsigned artifacts are production releases.

The central machine-readable Release Record is `release/integration/wallet-auth-release-record.json`. Website-facing download candidates are separately held in `release/integration/wallet-auth-public-download-metadata.json`; `scripts/verify/wallet-auth-public-download-metadata-check.mjs` prevents local, temporary, unpacked, disposable, simulator, ad-hoc or unsigned candidates from becoming public download metadata.
