# YNX Shop and Seller Console handoff

Updated: 2026-07-18

Branch: `codex/ecosystem-shop`

Release source: `38e2f68deb91d5f26e5aeec2318e260cd0742115`

Minimum preserved baseline: `ef0456a6111ed9bc59fcd6c34d9a8739713e0865`

## Current truth matrix

| Product | Local implementation/tests | Installed | Central | Staging | Public/store |
| --- | --- | --- | --- | --- | --- |
| YNX Shop Web/PWA | complete / pass | browser runtime verified | not integrated | deployed | not released |
| YNX Shop Android | complete / pass | API 36 install, two cold starts, restart and deep links pass | not integrated | APK hosted | not production signed/store released |
| YNX Shop iOS | source/contract/locales complete; runnable CI present | not installed locally (no full Xcode) | not integrated | not installed | not signed/store released |
| Seller Console Web | complete / pass | browser runtime verified | not integrated | deployed | not released |
| Commerce API | complete / race + repository tests pass | systemd active, restart proof pass | Trust configured; Wallet/Pay/AI incomplete | deployed | not public release |

Exact machine-readable states are in `apps/shop/product-release.json` and `apps/seller-console/product-release.json`. `integratedCentral`, `deployedPublic`, `productionSigned`, and `storeReleased` remain false.

## Delivered product closure

`internal/commerce` owns one authenticated, atomic snapshot for stores, products/media/variants/revisions, real inventory and reservations, profiles/addresses, persistent carts, orders, timelines, roles, audit, settlements, AI jobs, idempotency records, and rate windows. Startup recovery deterministically releases expired unpaid reservations. HMAC tamper/wrong-key startup fails; a verified `.bak` can be restored only with the same key.

Buyer surfaces cover Search, Category, Product, Bag, Checkout, Orders, profile/address, reservation, Pay handoff, payment-pending/committed-paid, cancel, seller-entered shipment, delivery, review, return, refund request, dispute, and restart recovery. Product publication requires HTTPS image media and alternative text.

Seller covers onboarding, profile/policy, drafts, edit history, explicit publish/unpublish, inventory, order inspection, fulfillment timelines, returns/refunds, settlements, staff, roles, and audit. Roles are owner, manager, fulfillment, support, and viewer. Support cannot approve a money action; viewer is read-only.

Concurrent no-oversell, reservation expiry/release, exact idempotent replay, changed-replay rejection, restart, authorization, and audit are tested. AI workflows cover catalog creation, search comparison, support draft, fulfillment triage, and return explanation with explicit context/estimate/permission/review/cancel/retry/delete boundaries. AI cannot publish, price, purchase, refund, change inventory, or change policy.

## Wallet, Pay, and Trust boundaries

Web bearer state is memory-only; legacy plaintext session/challenge snapshot data is dropped. Native secrets use Android Keystore-encrypted preferences or iOS Keychain. Recovery keys never enter Shop.

Shop and Seller have separate v2 registry entries:

- Shop: `ynx-shop-v1`, `com.ynxweb4.shop`, `ynxshop://wallet-auth/callback`, buyer scopes.
- Seller: `ynx-seller-v1`, `com.ynxweb4.seller-console`, `ynxseller://wallet-auth/callback`, seller scopes.

Every authenticated request requires central product-session introspection and exact P-256 device/session/product/scope/account binding. The deployed central Gateway does not yet contain these entries, so staging Wallet authentication reports unavailable and never falls back to a local bearer. Exact patches and owner actions are in `docs/handoffs/shop-central-integration.md`.

Pay is authoritative for both paid and refunded. Shop validates exact invoice/intent/merchant/payout/payer/YNXT amount/currency/transaction/audit/block evidence. A Shop-specific merchant payout is not provisioned, so staging Pay stays unavailable rather than using a guessed payout or fake settlement.

Trust staging is configured against the authenticated Trust service. Shop sends only one order-bound SHA-256 digest and a non-sensitive summary; raw address/payment/explanation data stays local. Trust links/cases cannot move YNXT or decide settlement. Tax and carrier providers remain unavailable; shipment data is manual-unverified.

## UI and localization

The Shop giant blue hero and Seller KPI card wall were removed. Buyer is image/title/price/choice first; Seller uses sidebar, table, inventory editor, role-aware toolbar, and timelines. Both support system light/dark, reduced motion, increased contrast, responsive mobile, 12 locales, Arabic RTL, and a separate AI output-language preference.

Real current-run visual evidence, before/after comparisons, generated-asset disclosure, overflow checks, and remaining authenticated-state limitations are in `UI_DESIGN_AUDIT.md` and `docs/handoffs/shop-evidence-index.md`.

## Staging and artifacts

- Buyer: `https://web4.ynxweb4.com/shop-staging/`
- Seller: `https://web4.ynxweb4.com/seller-staging/`
- Health: `https://web4.ynxweb4.com/shop-api-staging/health`
- Version: `https://web4.ynxweb4.com/shop-api-staging/version`
- Android: `https://web4.ynxweb4.com/shop-staging/ynx-shop-0.2.0-testnet-preview.apk`
- Linux/Web/API bundle: `https://web4.ynxweb4.com/shop-staging/ynx-shop-release-38e2f68.tar.gz`

Health/version report version `0.2.0-testnet-preview`, commit `38e2f68deb91d5f26e5aeec2318e260cd0742115`, persistence true, and integrity protection true. The service runs as `ynx` on loopback port 18095 behind the existing Web4 TLS host. Restart preserved the authenticated state SHA-256 exactly.

APK SHA-256 is `0df56042b944f74540be437e314f6331afcb4f9674342d63b1922fbdab7c435f`, size 78,639 bytes, min API 26, signed with an ephemeral RSA-3072 Testnet Preview certificate using APK v2/v3. It is not production signed. Full hashes/signature metadata are in `docs/handoffs/shop-artifact-manifest.json`.

## Verification completed

- `go test -race ./internal/commerce/... -count=1` — pass.
- `go test ./...` — pass.
- Buyer `npm test`, build, and `native:verify` — pass.
- Seller `npm test` and build — pass.
- Android `testDebugUnitTest`, `assembleDebug`, `assembleRelease` — pass with JDK 17 / SDK 36.
- Android signed APK install, two force-stop cold starts, Wallet and order deep-link delivery — pass on isolated read-only API 36 AVD.
- `go mod verify` — pass. Web runtime dependency trees are empty. Linked-binary SBOM contains 35 components with only MIT/Apache/BSD/ISC licenses and no unknown license entry.
- `make no-placeholder-check`, `make secret-scan`, `make env-check`, `git diff --check` — pass.
- Remote Caddy/API/buyer/seller/artifact smoke and service restart — pass.
- iOS simulator is not claimed locally. `.github/workflows/shop-native.yml` performs macOS simulator build/install/launch/deep-link and uploads the simulator artifact.
- Repository-wide `make preflight` was run twice through its Shop-independent gates. Both attempts stopped at `make faucet-check` because the shared local faucet fixture never became healthy on `127.0.0.1:6428`; an existing user-owned `ynx-chaind` process/state on the adjacent local testnet was preserved and not terminated. All Shop/Seller gates listed above passed independently.

## Exact remaining blockers

1. Central Gateway owner must review/merge/deploy the two exact registry v2 entries and provide the authenticated introspection endpoint/service key. Until then no real Wallet-authenticated staging order can exist.
2. Pay owner must provision a Shop merchant and canonical payout address and review the current Pay adapter against the deployed Pay release. Until then real Testnet order settlement/refund acceptance cannot run.
3. Full Xcode or a completed GitHub Actions run is required for iOS simulator artifact/install evidence.
4. AI provider credentials/quota, tax provider, and carrier provider remain external. Their unavailable labels are intentional.

Because blockers 1–3 prevent the requested central and complete native acceptance, this handoff does not claim the entire cross-product goal is complete even though the owned code, staging deployment, Android preview, documentation, and local/runtime gates are delivered.
