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

The current consumed checkpoints are Core `0c747c6030b5a475a1f12dc7e57345555c23055d`, Web `46d030c85c2b1a3d12a10c6b5dd0e521ca303f1c`, Android `66d321e423baedb0e030650729f1000d25a351cf`, iOS/macOS `369578f20b0802bcfef5cfc8bcdd7f53fec0f801`, and Desktop/CLI/SDK `2802876f8470264c4a8819f1426e28f957a09289`. Android current-source device QA is bounded to a disposable certificate/AVD; its unreviewed successor remains pending. iOS simulated-biometric source has no terminal success.

Android `66d321e4…` binds a 30,741,119-byte APK (`fba1c8e1…92365f`) and disposable certificate `bd03ab0e…e29c24` to direct API 36 arm64 evidence. Fresh install, cold PIDs 2840/3641, wrong-fingerprint lock, registered-fingerprint unlock, background relock, Social authorization review, duplicate pending rejection and missing exact callback-package fail-close are accepted. Terminal replay/process restart, authoritative balance/nonce, callback delivery, sign/broadcast/receipt, official hosting and every production/store claim remain false.

Web `60614bf5…` directly verifies the official Firefox 153.0.4 DMG and temporary add-on first/second launch. Website main `92a8b90e4eb652fd308436c6caf3c30ee9730c62` merged evidence `c70bf01…` through PR #34; Web `46d030c…` and an independent unchanged `deca6f4f` verifier run prove three official pages, nine exact content-addressed downloads, registry binding, and three visible buttons. Therefore PWA, Chrome/Edge and Firefox `downloadHosted`/`deployedPublic` are true. The artifacts remain unsigned; installedLocal, popup DOM/background, provider/account/sign/tx, production signing and store remain false.

The same release record binds external Chain Core contract version `1.21.0`: implementation `9468a771b46f50e0e12b7567d7aa51a2f95b4e36`, contract `cefb37144517e8f44fd9d0b41119bb5754bdb55d`, tree `cb64ea796b9ffa2db5acb7639efff623d587f332`, and contract blob `2ab1e66e72cb17c7d0b234d77a0ed020f77da102`. This accepts the contract identity only. Wallet/Auth remains Product Session authority; Chain Core remains fail-closed with its Auth dependency not accepted and no parallel Auth protocol. Because the commit is not exposed by the shared origin and no matching public runtime evidence exists, `integratedCentral`, staging/public deployment and all release-distribution promotions remain false.

Product Session Router v2 evidence `cd90b96271b3881bfe6db134aa54c7bb90a29a62` supersedes the earlier negative route checkpoint and freezes deployed source `cc6c393608a11022f8617eede753af4c578d0ecd`. The protected transaction mounts isolated persistent service 6441 ahead of legacy/Chain fallback, passes rollback, public mount, direct challenge/completion/introspection/replay/revoke/post-revoke lifecycle and restart state-digest checks. Central also reran the unchanged state-free mount probe successfully. This is an accepted interim route, not central absorption: 6437/6439 remain unchanged, zero product runtimes are migrated, visible Wallet approval is absent, and dual-side atomic integration is unproved. Route-level public facts are true; `integratedCentral` and aggregate Product Session deployment remain false.

Every platform separately tracks build, install, cold launch, second launch, Testnet, signing, transaction, callback, reconnect, hosted download, production signing and store release. A true value requires an explicit direct evidence binding. Simulator, disposable, unpacked, temporary, unsigned and ad-hoc artifacts remain non-production by construction.

Mutation gates are frozen in `docs/integration/WALLET_AUTH_RELEASE_TEST_VECTORS.json` and executed by `node --test scripts/verify/wallet-auth-release-evidence-matrix.test.mjs`. They prove that unsupported true claims, disposable-production promotion, pending-platform promotion, unknown evidence and hosted-download claims without public download evidence fail closed.

The public evidence audit is frozen in `release/integration/wallet-auth-public-evidence-audit.json` and checked by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. Public RPC, gateway health and website reachability never imply that the latest frozen Core source is deployed, that exact downloads are hosted, or that unpacked/ad-hoc/unsigned artifacts are production releases.

The central machine-readable Release Record is `release/integration/wallet-auth-release-record.json`. Website-facing download candidates are separately held in `release/integration/wallet-auth-public-download-metadata.json`; `scripts/verify/wallet-auth-public-download-metadata-check.mjs` prevents local, temporary, unpacked, disposable, simulator, ad-hoc or unsigned candidates from becoming public download metadata.
