# Commerce continuation — active, incomplete

Owned worktree: `/Users/huangjiahao/Desktop/YNX Final Worktrees/63-shop-connect-state`.
Original HEAD: `35dc239546c2bf963534d5031d4c35c4e22c2d1c`; initial tree was clean.
Only `apps/shop`, `apps/merchant-console`, `apps/seller-console`, and existing `internal/commerce` are written. Shared SDK/Auth/registry/Host/internal/pay and other product paths remain excluded.

## Precise inheritance

- Merchant source, tests, product docs and vendored original Wallet Auth: `84581af52cc54d3e5e419199d1cb365f7a75f608`, owned product directory only. Historical deployment controls and screenshot receipts were not imported as current deployment evidence.
- Seller product source, tests, layout and original Wallet Auth vendor: `fe98fdc00c5e4228b77f2e38e009cce749066c53`, owned product directory only.
- Seller's original roles, invitations, provider configuration and persistence recovery engine already lives in main `88c0f3a54`; exactly `internal/commerce` was ordinarily inherited. No whole-branch merge; Shop's original web/native assets remain in place.
- Original logos copied unchanged from Shop, without distortion. Commerce navigation preserves the original public Shop, Seller and Merchant links and role separation.

## Current source changes

- Product request contexts cancel old work and reject late response bodies after logout, selected store/view or account changes. Merchant CSV exports use the same boundary. Errors from superseded requests do not overwrite the new workspace.
- Shop/Seller memory-only legacy product sessions now reject non-finite expiry and are invalidated on account/chain transitions. Cancelled standard connection attempts cannot reconnect after signout. These are legacy compatibility protections, **not a v2 migration**.
- Shop static offline cache is allowlisted; callback queries, authorization-bearing requests and APIs are not cached. Activation removes only old Shop shell caches.
- Checkout and Seller product retries retain the original idempotency key when the submitted intent is unchanged. Product editing preserves all other variants and media.
- Persistent cart validation rejects duplicate lines and mixed sellers without replacing saved data. Profile/cart input and returned slices and Product responses/revision collections are detached from the live store. Order sum overflow is rejected before reserving stock.
- Catalog create/update cannot change inventory without the existing `inventory.write` authority. Generated variant IDs no longer alter the input hashed for idempotency. Store access metadata describes only the authenticated actor; mutation authorization remains server enforced.
- Seller operates the selected store's orders, uses current service-returned role permissions for actions and presents live fulfillment/catalog/customer request tasks.
- Android product-session metadata is stored as one encrypted account/token/expiry record. API requests snapshot and recheck that record; UI callbacks are checked on the UI thread. Release API URLs require HTTPS.
- Android offline requests and cart storage are account-bound. Old unbound queues and old cart records are preserved but not executed or silently attributed to a new account. Queues are bounded, permit only buyer order actions, and stop on the first execution failure. No payment execution is queued. Signout clears only local active session/pending approval and current presentation; account-specific records remain recoverable.

## Validation and limits

- `go test -race ./internal/commerce`: passed after backend changes, including profile/cart persistence and isolation, mixed/duplicate cart rejection, overflow without reservation, Catalog inventory bypass rejection, and stable generated-variant retries.
- Shop Node checks: 18 passed. Seller: 14 passed. Merchant: 17 passed. Seller/Merchant local checks use the exact original read-only DApp SDK from worktree 55 because this worktree's shared SDK directory is absent. This is explicit **LOCAL_QA_ONLY**, not a release build or restored shared dependency.
- Local Chromium original Seller journeys: 3 passed; Merchant journeys/mobile role navigation/logo/overflow: 3 passed. Deterministic QA providers do not prove an installed Wallet, true SSO, private owned business, public runtime or human acceptance.
- Android JDK 17 source compilation and `:app:testDebugUnitTest` passed. Actual Android queue tests also passed: old unbound and another account records remain stored/unexecuted, queued input is detached, failed retry retains the exact original intent and stops later work, and guest/payment execution is excluded. First JDK 24 incompatibility and first offline missing declared org.json dependency failures are retained in tool history. Existing dependency was subsequently resolved normally; no APK, installation or release was produced.
- Native contract/i18n/privacy static checks passed. Existing iOS source is preserved; its old schema/queue/session adaptation still requires follow-up.
- First Seller guest-preview clearing failure was fixed; original failure artifacts are preserved at `/tmp/ynx-commerce-first-browser-failure-20261002/seller`. First Merchant QA fixture did not serve newly added logo and was corrected without weakening assertions; failure artifacts remain in the same root's `merchant` folder.
- QA-only dependency resolver/build scripts: `/tmp/ynx-commerce-legacy-sdk-qa-loader-20261002.mjs`, `/tmp/ynx-commerce-owned-web-qa-build-20261002.mjs`. They read original dependency files; no shared source is changed. Normal Seller/Merchant builds still need A's shared dependency integration.

## Exact shared work required from A

The source-only canonical tuple was read from `/tmp/ynx-public-products-exact-canonical-source-contract-20261002.json`, registry source `63f9fca04a4a7bdfecdb2be5287853a15df3a8d9`, SHA `1e32ecb1d97a6ad7d285e4a21097e21645308a8dff6a0452f23647c466fa3674`.

1. Shop: `ynx-shop-v1`; Web `com.ynxweb4.shop.web`, origin `https://shop.ynxweb4.com`, callback `/wallet-auth/callback`; native `com.ynxweb4.shop` and `ynxshop://wallet-auth/callback`; scopes `account:read`, `shop:orders:write`, `shop:profile:write`, duration 240s. Existing owned code/service is v1 and must consume A's canonical v2 adapter, not synthesize a second identity/session.
2. Seller and Merchant are not registered in current canonical registry. A must register exact least-privilege role tuples and callback/native contracts; neither product may borrow Shop or browser permissions.
3. A must provide the precise existing browser SDK artifact, gateway endpoint/adapter and business proof contract. Introspection proof is not arbitrary business authorization. Social's audience revalidator cannot be repurposed by renaming endpoints or removing tuple guards.
4. Keep original Commerce store/role/model and original Merchant PayAPI paths. A owns shared Pay merchant session, trustworthy signer pin and invoice signing service. Wallet owns consumer payment review and execution; Commerce never imports account secrets or auto-signs.
5. A owns complete service/static routing/CSP/callback configuration, formal Android/macOS/Web builds and public release. This owner then retests from the final public/install entry, actual Wallet approval, own business read/save/reopen, logout/account changes and recovery.

Current status: `SOURCE_IN_PROGRESS`, complete product release and installed/public/true SSO journeys **NOT_VERIFIED**, MONSTER **NOT_RUN**. The original full goal stays active. This checkpoint is recoverable continuation, not completion or release authorization.
