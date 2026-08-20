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

The current consumed checkpoints are Core `404f818719b920008f88f076949a4387c5130855`, Web `020f513e5d5d12920f75201f637bdd854ccc91aa`, Android `66d321e423baedb0e030650729f1000d25a351cf`, iOS/macOS `3b27b83f18799ff74252469075ec460b6665dd44`, and Desktop/CLI/SDK `2802876f8470264c4a8819f1426e28f957a09289`. Android current-source device QA is bounded to a disposable certificate/AVD; its unreviewed successor remains pending. iOS simulated-biometric source has no terminal success.

iOS/macOS `3b27b83f…` freezes a 3/3 fail-closed AASA contract, not a deployed association. Central directly read `https://ynxweb4.com/.well-known/apple-app-site-association` as HTTP 200 `text/html`, 1,018 bytes / `0206ff01…`; it is the SPA fallback and the verifier remains exit 1. Real Apple Team ID, Core-frozen components, signed-app binding, AASA validity, associated domain, Universal Link delivery and auth/public release remain false.

Android `66d321e4…` binds a 30,741,119-byte APK (`fba1c8e1…92365f`) and disposable certificate `bd03ab0e…e29c24` to direct API 36 arm64 evidence. Fresh install, cold PIDs 2840/3641, wrong-fingerprint lock, registered-fingerprint unlock, background relock, Social authorization review, duplicate pending rejection and missing exact callback-package fail-close are accepted. Terminal replay/process restart, authoritative balance/nonce, callback delivery, sign/broadcast/receipt, official hosting and every production/store claim remain false.

Web `60614bf5…` directly verifies the official Firefox 153.0.4 DMG and temporary add-on first/second launch. Website main `92a8b90e4eb652fd308436c6caf3c30ee9730c62` merged evidence `c70bf01…` through PR #34; Web `46d030c…` and an independent unchanged `deca6f4f` verifier run prove three official pages, nine exact content-addressed downloads, registry binding, and three visible buttons. Therefore PWA, Chrome/Edge and Firefox `downloadHosted`/`deployedPublic` are true. The artifacts remain unsigned; installedLocal, popup DOM/background, provider/account/sign/tx, production signing and store remain false.

Web `020f513e…` freezes mobile discovery as three disjoint modes: real injected EIP-1193/EIP-6963, YNX canonical Authorization Request plus HTTPS/app callback and Product Session, or the exact MetaMask mobile dapp link. The current YNX callback is null and registry binding disabled/pending, so the YNX path returns `CANONICAL_AUTH_UNAVAILABLE`; returning to external Chrome is never counted as provider success. The new 274,329/189,922/189,959-byte artifact set is not the older hosted set, so latest-source hosting, public mobile visibility, account, sign, transaction and Testnet remain false.

The same release record binds external Chain Core contract version `1.32.0`: implementation `1974dba384a2f0ac1124f4de7025f772fe94bd03`, contract `93a95c0005e09ba21f61245f0e001e2acf4a1080`, tree `c8d8e0647e7e8de0d21eda2180b6df1d8fe5ff1f`, contract blob `0f56235839af42606d358937e14a1fa184ed7a02`, and readiness head `0164e7f6fea26bafa63ff7ede9b8d05ab47e8dc1`. The exact 146,122,768-byte bundle hashes to `666118d2…cbd3`. This accepts contract identity and local mTLS anchor-client boundary only. Production endpoint/CA/client certs, independent authority deployment, remote/WAN recovery drill, soak, Chain Core Auth dependency acceptance, `integratedCentral`, staging/public deployment and release promotions remain false.

Product Session Router v2 hardened evidence `2bcdf4f646177fe2419f1af3ac9e66bb3c218194` supersedes the earlier cc6c checkpoint and freezes deployed source `d26ed915516c97d07cb4d58e5fc4646486afc851`. The protected transaction mounts isolated persistent service 6441 ahead of legacy/Chain fallback, passes rollback and the public lifecycle, and directly rejects a runtime chmod 0644 tamper with HTTP 503 `INSECURE_STATE_FILE`, unchanged state bytes, no silent repair and sticky fail-close until explicit 0600+restart. Post-recovery lifecycle passes. This is a hardened interim route, not central absorption: 6437/6439 remain unchanged, zero product runtimes are migrated, visible Wallet approval is absent, and dual-side atomic integration is unproved. Route-level public facts are true; `integratedCentral` and aggregate Product Session deployment remain false.

Core/Auth `19277165…` adds the direct public negative matrix against deployed d26ed915: wrong product/device/bundle return `CROSS_PRODUCT_SESSION`, wrong scope returns `SCOPE_WIDENING`, sibling device revoke returns `SESSION_REVOKED`, and expiry returns `SESSION_EXPIRED`, all HTTP 403. It explicitly does not generalize chmod coverage: device+inode identity is not pinned across requests, and public symlink/hardlink/same-bytes inode replacement/digest-tamper vectors remain false.

Core/Auth `99523546…` independently freezes controlled-restart idempotency for deployed source `37f2485…`: the same completion request returns an identical 1,122-byte response (`a02b0576…`), the pre/post restart state SHA remains `2843220c…`, revoke succeeds, a new post-revoke proof receives HTTP 403 `SESSION_REVOKED`, and the private retry record is deleted. No product runtime migration, visible Wallet approval, central absorption or aggregate release follows from this engineering route proof.

Core/Auth `404f8187…` completes the bounded public state-integrity matrix for the same source: 0644, hardlink, symlink, same-byte inode replacement and digest mismatch all return their exact HTTP 503 fail-closed codes with zero mutation. The final file SHA and state digest match their baselines, explicit repair restores `0600 ynx:ynx nlink=1`, and post-regression lifecycle passes. The dedicated 6441 route remains interim; 6437/6439 absorption, runtime migration, visible Wallet approval, `integratedCentral` and aggregate deployment remain false.

Core/Auth `f1c43b77…` independently records that the public canonical user-rejection route is missing: `/v1/wallet/authorizations/reject` returns 404 `ROUTE_NOT_FOUND` instead of 403 `AUTHORIZATION_REJECTED`. The Wallet/App sources are read back, state digest is unchanged and mutation is zero; deployed rejection and visible installed-Wallet approval/rejection remain false.

Website `24c0589e…` freezes the Product Session runtime status publication after merge `3ac32e03…`: both Vercel production deployments are Ready and all three official aliases return the same 2,059-byte runtime JSON (`35d50f3e…`) bound to source `37f2485…` and evidence `404f8187…`. This establishes website/route publication only. Immutable deployment HTTP backread, runtime migration, visible Wallet approval, `integratedCentral` and aggregate ecosystem deployment remain false.

Every platform separately tracks build, install, cold launch, second launch, Testnet, signing, transaction, callback, reconnect, hosted download, production signing and store release. A true value requires an explicit direct evidence binding. Simulator, disposable, unpacked, temporary, unsigned and ad-hoc artifacts remain non-production by construction.

Mutation gates are frozen in `docs/integration/WALLET_AUTH_RELEASE_TEST_VECTORS.json` and executed by `node --test scripts/verify/wallet-auth-release-evidence-matrix.test.mjs`. They prove that unsupported true claims, disposable-production promotion, pending-platform promotion, unknown evidence and hosted-download claims without public download evidence fail closed.

The public evidence audit is frozen in `release/integration/wallet-auth-public-evidence-audit.json` and checked by `scripts/verify/wallet-auth-public-evidence-audit-check.mjs`. Public RPC, gateway health and website reachability never imply that the latest frozen Core source is deployed, that exact downloads are hosted, or that unpacked/ad-hoc/unsigned artifacts are production releases.

The central machine-readable Release Record is `release/integration/wallet-auth-release-record.json`. Website-facing download candidates are separately held in `release/integration/wallet-auth-public-download-metadata.json`; `scripts/verify/wallet-auth-public-download-metadata-check.mjs` prevents local, temporary, unpacked, disposable, simulator, ad-hoc or unsigned candidates from becoming public download metadata.

The unique public endpoint/mobile discovery contract is `release/integration/wallet-auth-public-endpoint-service-discovery-matrix.json`, documented by `docs/integration/WALLET_AUTH_PUBLIC_ENDPOINT_SERVICE_DISCOVERY.md` and enforced by the public evidence audit checker. It explicitly separates injected-provider, YNX Wallet canonical authorization deep-link/callback, and MetaMask mobile DApp-link flows. Faucet recovery evidence proves production-host SNI health and official-www CORS only; workstation/mobile TLS and funding remain false. Product Session v2 registered-origin OPTIONS/CORS is directly proved. EVM CORS candidate `c2a34c92…` is source-frozen but not deployed: last preflights were 405 and transport failed before validation/reload, so EVM RPC CORS, v1 rejection, mobile approval, callback, account, sign and send remain false.

The canonical caller migration companion is Core/Auth `94c7f3c9…`, contract blob `714c2b36…`. It reports 30 blocking release-runtime findings and keeps the strict gate red; generated bundles alone have zero legacy blockers and four shared-builder-bound literals. No callback is rewritten, no manual runtime URI is grandfathered, and Pixel 9/integration/public gates remain false.

Wallet/Auth `04e5554d…` supersedes `4d4749c6…` and freezes `createProductWalletConnection` as the only product-facing factory. Products cannot inject callback, origin, session, Wallet URL, predictable token factory, clock, Gateway endpoint, fetch implementation or a raw P-256 private key; the factory pins `https://rest.ynxweb4.com`, requires runtime-global HTTPS transport and delegates canonical challenge/HTTP-proof signing to an asynchronous platform secure-device signer. Returned signatures are locally verified against the registered device key, and signer failure or key mismatch fails closed. `beginLegacyYNX` accepts only a same-product/platform registered legacy callback. This remains local SDK truth: 0/12 runtimes are migrated, PR CI is not green, 6439 is still undeployed/404, and visible platform, central and aggregate public gates remain false.

Core/Auth `f5e0ef31…` additionally closes the post-completion outage orphan-session boundary: when completion creates an active Gateway session but introspection transport fails, the exact protected binding remains recoverable and disconnect must sender-constrained revoke it before clearing. Public source `577f8120…` permits Social OPTIONS 204 but rejects the official Web companion Origin `https://www.ynxweb4.com` with HTTP 403 `ORIGIN_NOT_ALLOWED`. The enabled local registry and local 323/323 suite therefore do not prove public registry load, Web auth/account/sign/send, mobile lifecycle, central integration or aggregate public; all remain false.

Core/Auth `a731d67b…` freezes an owner-only isolated-6441 deployment/rollback and post-deploy acceptance contract for exact candidate `f5e0ef31…` and registry digest `f8a25702…`. The verifier requires exact `/version`, www OPTIONS 204, attacker/method fail-close, Origin-bound lifecycle/replay/revoke/post-revoke and the negative identity/scope/device matrix. It has not been executed and Central performed no SSH/deploy; `deployedByCore`, `gatewayLoadedPublic`, visible Web success, central integration and aggregate public remain false.

Core/Auth `778d7e63…` closes the restart restore/retry versus disconnect resurrection race: restore and retry recovery are single-flight, disconnect waits the captured recovery transaction, then exact-revokes and clears the protected session. Final state is disconnected with one revoked session and no automatic reconnect. Local 327/327 remains engineering truth only; current public source `577f8120…` still rejects the www Origin, and public/mobile/integrated/aggregate gates remain false.

Core/Auth `d5f252e9…` reconciles the exact Router `48ca6201…` network-epoch semantics while retaining the recovery single-flight, protected-session revoke and restore/disconnect no-resurrection guarantees. After Gateway completion succeeds, the exact issued session is protected before a network transition can return, so Retry can introspect it and disconnect can revoke it instead of orphaning authority. Local 330/330 and App 40/40 remain candidate evidence; secure-signer reconciliation is still pending, and public/staging/integrated/gateway-loaded gates remain false.

Core/Auth `edcfc86b…` completes that secure-signer reconciliation: the platform signer covers challenge, introspection, restart and revoke without exposing a raw secret, while signer throw or wrong-key output fails closed before Gateway completion. The exact Router `48ca6201…` network-epoch semantics and Core recovery/protected-session/no-resurrection guarantees remain intact. Local 332/332 and App 40/40 do not prove deployment; current public `577f8120…`/www OPTIONS 403 and every public/mobile/integrated/gateway-loaded gate remain false.

Core/Auth `ae8e2465…` additionally fences asynchronous platform signing by the current network epoch before complete, introspect and revoke. A network change while signing is pending causes zero late Gateway mutation and retains the protected callback/session for Retry; a later stable attempt completes or revokes exactly once. Local 334/334 and App 40/40 remain engineering evidence only; no deployment occurred and public `577f8120…`/www OPTIONS 403, gateway-loaded, public, mobile and integrated gates remain false.

Core/Auth `92ae5404…` closes the lost revoke-acknowledgement recovery boundary. When revoke persisted but its ACK was lost, Retry treats only exact `SESSION_REVOKED` as terminal and then clears protected local state; `SESSION_NOT_FOUND` and every other error remain fail-closed with state retained. Local 336/336 and App 40/40 remain candidate evidence, with no change to the public `577f8120…`/www OPTIONS 403 mismatch or any public/mobile/integrated gate.

P0 Wallet Protocol Origin Binding is accepted for one owner-scoped runtime transaction by `release/integration/p0-wallet-protocol-runtime-acceptance.json`; lease `P0-WALLET-CONNECTIVITY-2026-08-runtime-lease-20260820T090524Z` expires `2026-08-20T11:05:24Z`. The historically divergent candidate must not be whole-tree merged: only the exact `packages/wallet-auth` subtree at `5231e750…` may be materialized, with CORS provenance `b28609ab…`, contract `66003e76…` and evidence head `460353c6…`. Current public source remains `6ed04310…` and registered-Origin OPTIONS is 405, so integrated/public/CORS/lifecycle/client gates remain false; installed-client ComputerControl is explicitly outside this lease.

Android source `dedfcb67…` passed exact-head CI run `31850349002`. A 25,623,359-byte disposable-QA APK (`2ac74d77…`) installed on a fresh-wiped API36 arm64 Pixel9-equivalent AVD; cold PID 5249 and second PID 5391 completed without Wallet ANR/FATAL/crash, and malformed authorization failed closed. This is not physical-device or production evidence: RPC, Faucet, approve/reject/callback/Product Session, transaction, hosting, production signing and store remain false.

Android ecosystem launch is separately frozen by `release/integration/wallet-auth-android-launcher-contract.json` and `docs/integration/WALLET_AUTH_ANDROID_LAUNCHER_CONTRACT.md`. The current Pixel 9 observation is negative: Social and another ecosystem-to-Wallet flow show a security-check failure and then `No Activity found to handle Intent`. The shared builder/resolver, exact Wallet manifest route, callback and three-app device lifecycle remain required and false until Owner evidence arrives.

The cross-ecosystem caller migration gate is `scripts/verify/wallet-auth-android-launcher-callers-check.mjs`. Its normal mode must pass before release. The current `--expect-blocked` result preserves legacy Monitor, Trust Center and shared mobile bindings plus every additional manual caller as blockers; it never authorizes callback rewriting.
