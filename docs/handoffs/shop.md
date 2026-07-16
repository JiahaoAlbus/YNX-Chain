# YNX Shop handoff

## Source

- Branch: `codex/ecosystem-shop`
- Baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Initial implementation commit: `8caa94ebb683396e8dd3a140e361b407ffb107fb`
- Final implementation and handoff: branch tip containing this document (use `git rev-parse codex/ecosystem-shop`)
- Owned paths: `apps/shop/**`, `apps/seller-console/**`, `internal/commerce/**`, this handoff

## Delivered architecture

`internal/commerce` is a standalone commerce domain and HTTP service (`go run ./internal/commerce/cmd/shopd`). It persists one versioned JSON snapshot with mode `0600`, fsyncs a temporary file, and atomically renames it. All inventory reservations, order transitions, idempotency records, roles and audit records share a mutex-protected transaction boundary. Startup calls `Recover`, releasing expired unpaid reservations deterministically.

The buyer surface under `apps/shop` is an API-driven application rather than a navigation shell. It covers Wallet sign-in, persistent profile/address APIs, search/category/price/in-stock filters, product variants/live available quantity, persistent cart APIs, order review, inventory reservation, YNX Pay handoff, payment pending/confirmation, shipment/delivery, cancellation, review, return/refund request and dispute states, plus Trust links and explicit capability status.

The separate seller surface under `apps/seller-console` exposes working views for Wallet-scoped onboarding, store profile/policy, catalog drafts, explicit publication, variants, concurrency-safe inventory, order/fulfillment transitions, seller-entered shipment updates, return/refund decisions, authoritative settlement records, owner/manager/fulfillment/support roles and audit history. Fulfillment, support and refund decisions are permissioned separately; support cannot approve a refund transfer decision.

The service API rejects unknown JSON fields, limits bodies and field lengths, applies global and subject/action rate windows, uses 8-128 character persistent idempotency keys (including HTTP state transitions), returns the original result for an exact replay, rejects replay with changed request hashes, checks buyer/seller ownership on every private record, and emits immutable audit events. Security headers include a same-origin CSP, no-sniff, no-referrer and no-store.

## Payment truth boundary

Checkout creates a Pay intent and invoice only through configured `YNX_SHOP_PAY_URL` / `YNX_SHOP_PAY_KEY`, bound to the configured merchant and payout address. An order remains `payment_pending` until `GET /pay/invoices/{id}/settlement` returns exact evidence matching invoice, intent, merchant, payout account, payer, YNXT amount/currency, transaction hash, audit hash and positive committed block height. Only then are reserved units consumed and the order marked `paid`. Replays are idempotent. Missing Pay configuration returns HTTP 503 `unavailable`; it never creates a local paid state.

Refund approval is also a Pay boundary, not a local money-movement claim. An owner or manager approval calls `POST /pay/refunds`; the order stays `refund_approved` / `approved_pending_authoritative_pay_refund` if Pay is unavailable. It becomes `refunded` only after the returned refund ID, intent, merchant, exact total, YNXT currency, `recorded` status, transaction hash, audit/request hashes, timestamp and committed block height all match. The evidence is persisted on the order and audited; support-role users cannot approve or retry the refund.

Tax calculation and external logistics-provider integration are reported as `unavailable`. Seller-entered carrier/tracking data is labeled as a manual fulfillment update, not external carrier proof. A buyer dispute submits only a bounded SHA-256 evidence digest and non-sensitive summary to configured Trust `POST /api/actions`; raw buyer address, payment history, account and explanation do not cross the adapter. Returned case/evidence/appeal links are persisted and audited. If Trust is absent or rejects the handoff, the dispute remains durable with `unavailable_no_trust_gateway`; Shop never lets Trust move YNXT or decide Pay settlement.

## Wallet and AI boundaries

Shop no longer owns or persists bearer sessions. Web and native clients use Wallet Auth v1 with separate `ynx-shop-v1` / `com.ynxweb4.shop` and `ynx-seller-v1` / `com.ynxweb4.seller-console` bindings, exact sorted least-privilege scopes, `ynx_6423-1`, callback, localized purpose, nonce, four-minute approval expiry and a non-exportable P-256 product-device key. `ynx-shopd` proxies approval/device proofs to the central Gateway and introspects every bearer; it fail-closes on revocation, expiry, cross-product bundle, scope, account, session-binding or unknown-field mismatch. Legacy snapshot migration drops old plaintext sessions/challenges. Web bearer state is memory-only; native sessions use Android Keystore-backed encrypted preferences or iOS Keychain. Recovery keys never cross into Shop.

The buyer delivery now includes responsive Web plus independent native Android and iOS projects under `apps/shop/native`. Android provides catalog/search, encrypted cart/profile/offline mutation queue, checkout, Pay deep links, order/refund/dispute lifecycle, Wallet device proof, AI review and 12 audited locale resources. iOS provides the corresponding SwiftUI/API/Keychain/Wallet contract with a privacy manifest and 12-locale string catalog. Seller operations remain a separate responsive console rather than being embedded in the buyer App.

AI workflows are `catalog_creation`, `search_comparison`, `support_draft`, `fulfillment_triage` and `return_explanation`. Each requires an allowed context class, privacy summary, unit estimate and explicit permission; records provider status, result/failure and audit; supports cancel, retry by new job, apply-draft or reject. Allowed actions are draft-only. AI cannot publish, price, purchase, refund or change policy. Missing provider configuration is an explicit failure, not a canned response.

## Verification evidence

- `go test -race ./internal/commerce/...` — pass. Covers concurrent no-oversell reservation, persistence/restart recovery, exact Pay settlement and refund evidence, central Wallet introspection/proxy tamper/replay rejection, legacy plaintext-session removal, Trust privacy boundary, authorization/lifecycle and AI permission/provider/review boundaries.
- `go test ./...` — pass. Includes the full repository and an authenticated HTTP workflow covering seller onboarding/roles/catalog/publication/inventory, buyer cart/order, Pay handoff and exact committed settlement/refund, shipment/delivery/review/return, role denial, settlements, idempotent replay and strict JSON validation.
- `npm test && npm run build` in `apps/shop` — pass; build emitted ignored `dist/`.
- `npm test && npm run build` in `apps/seller-console` — pass; build emitted ignored `dist/`.
- `npm run native:verify` in `apps/shop` — pass; verifies Android/iOS bindings, privacy contracts and exactly 12 complete locale catalogs including Arabic RTL.
- Android `assembleDebug` and `testDebugUnitTest` with JDK 17 / installed SDK — pass. Debug APK SHA-256: `7db990d0ccf7c6727a4a6609b1ae33deb336e5b05523de8e22d9c8c7ff502157`.
- Android install/cold launch on `emulator-5562` — pass: package `com.ynxweb4.shop.debug`, `LaunchState: COLD`, activity resumed with a live process.
- iOS plist, privacy manifest, Xcode project and native contract/i18n static checks — pass. Simulator compilation is not claimed because this machine has Command Line Tools but no full Xcode installation.
- Cold-start `ynx-shopd` plus `npm run smoke -- --base-url http://127.0.0.1:18095` in both Web apps — pass for health, capabilities and catalog. Smoke also accepts `YNX_SHOP_URL`.
- Browser verification — buyer and seller at 1440x1000 and 390x844; no console errors or horizontal overflow. Responsive viewport screenshots were reviewed visually.
- `npm run hardhat:build && npm run contracts:selectors` — pass. The root package has no `npm test` script; app tests and Go tests are the applicable suites. Generated artifacts and `node_modules` are ignored and not committed.
- `make no-placeholder-check` — pass.
- `make secret-scan` — pass.
- `make env-check` — pass.
- `git diff --check` — pass.

Screenshot evidence:

- `apps/shop/evidence/buyer-desktop.jpg`
- `apps/shop/evidence/buyer-mobile.jpg`
- `apps/seller-console/evidence/seller-mobile.jpg`
- `apps/seller-console/evidence/seller-desktop.jpg`

## Exact integration requests

1. Register the exact Shop and Seller client/bundle/callback/scope tuples in the deployed central Gateway and point `YNX_SHOP_GATEWAY_URL` / `YNX_SHOP_GATEWAY_KEY` at its Wallet Auth v1 product-session API. The adapter contract is implemented and tested against a strict fake; no live Gateway endpoint or credential is present in this worktree.
2. Point `YNX_SHOP_PAY_URL` at reviewed `ynx-payd` and provide `YNX_SHOP_PAY_KEY`, `YNX_SHOP_PAY_MERCHANT_ID` and canonical `YNX_SHOP_PAY_PAYOUT_ADDRESS` via deployment secrets. Settlement and refund schemas must preserve the exact fields validated by the adapter.
3. Register Shop-specific AI scopes for the five workflows and map the current `/ai/generate` adapter to the reviewed Gateway contract. No provider secret belongs in either Web bundle.
4. Point `YNX_SHOP_TRUST_URL`, `YNX_SHOP_TRUST_KEY` and `YNX_SHOP_TRUST_PUBLIC_URL` at the reviewed Trust action/case service. Supply tax and logistics providers only when real; until then preserve `unavailable` and seller-entered-unverified labels.
5. Add deployment service wiring outside this branch's ownership after review. No public deployment or store acceptance is claimed here.

## Known external gaps

- Live central Wallet client registration and deployed endpoint/credential are not present in this worktree; auth therefore reports `unavailable` until supplied and never falls back to local bearer issuance.
- Pay merchant credentials and a deployed endpoint are not present in this worktree; payment and refund transitions fail closed until supplied.
- AI provider quota/credentials, tax service, carrier API and reviewed Trust evidence service are external inputs.
- This branch proves responsive Web products, a deployable Go service, an installed debug Android buyer App and an iOS project/static contract. It does not claim iOS simulator/device installation, production signing/store acceptance, live merchant acceptance, mainnet readiness or public launch.
