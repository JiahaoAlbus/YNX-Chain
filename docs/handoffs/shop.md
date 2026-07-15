# YNX Shop handoff

## Source

- Branch: `codex/ecosystem-shop`
- Baseline: `271197feb48fd362292fb2210887edf3109ce4f7`
- Implementation commit: `8caa94ebb683396e8dd3a140e361b407ffb107fb`
- Handoff commit: branch tip containing this document (use `git rev-parse codex/ecosystem-shop`)
- Owned paths: `apps/shop/**`, `apps/seller-console/**`, `internal/commerce/**`, this handoff

## Delivered architecture

`internal/commerce` is a standalone commerce domain and HTTP service (`go run ./internal/commerce/cmd/shopd`). It persists one versioned JSON snapshot with mode `0600`, fsyncs a temporary file, and atomically renames it. All inventory reservations, order transitions, idempotency records, roles and audit records share a mutex-protected transaction boundary. Startup calls `Recover`, releasing expired unpaid reservations deterministically.

The buyer surface under `apps/shop` covers Wallet sign-in, persistent profile/address APIs, search/category filters, product variants/live available quantity, persistent cart APIs, order review, inventory reservation, YNX Pay handoff, payment pending/confirmation, shipment/delivery, cancellation, review, return/refund request and dispute states, plus Trust links and explicit capability status.

The separate seller surface under `apps/seller-console` covers Wallet-scoped onboarding, store profile/policy, catalog drafts, explicit publication, variants, concurrency-safe inventory, order/fulfillment transitions, seller-entered shipment updates, return/refund decisions, authoritative settlement records, owner/manager/fulfillment/support roles and audit history.

The service API rejects unknown JSON fields, limits bodies, applies subject/action rate windows, uses 8-128 character idempotency keys, rejects replay with changed request hashes, checks buyer/seller ownership on every private record, and emits immutable audit events. Security headers include a same-origin CSP, no-sniff, no-referrer and no-store.

## Payment truth boundary

Checkout creates a Pay intent and invoice only through configured `YNX_SHOP_PAY_URL` / `YNX_SHOP_PAY_KEY`. An order remains `payment_pending` until `GET /pay/invoices/{id}/settlement` returns exact evidence matching invoice, status `paid`, total YNXT amount, non-empty transaction hash and positive committed block height. Only then are reserved units consumed and the order marked `paid`. Replays are idempotent. Missing Pay configuration returns HTTP 503 `unavailable`; it never creates a local paid state.

Tax calculation and external logistics-provider integration are reported as `unavailable`. Seller-entered carrier/tracking data is labeled as a manual fulfillment update, not external carrier proof. Trust is `link_only` until the Trust product exposes a reviewed evidence contract.

## Wallet and AI boundaries

The temporary Sign in with YNX Wallet adapter is versioned and binds `ynx_6423-1`, product `com.ynx.shop`, canonical `ynx1...` account, allowlisted callback, device ID, exact scopes, purpose, nonce and five-minute expiry. It verifies a secp256k1 DER signature, derives the account from the public key, consumes the challenge once and issues a bounded role session. Recovery keys never cross into Shop.

AI workflows are `catalog_creation`, `search_comparison`, `support_draft`, `fulfillment_triage` and `return_explanation`. Each requires an allowed context class, privacy summary, unit estimate and explicit permission; records provider status, result/failure and audit; supports cancel, retry by new job, apply-draft or reject. Allowed actions are draft-only. AI cannot publish, price, purchase, refund or change policy. Missing provider configuration is an explicit failure, not a canned response.

## Verification evidence

- `go test -race ./internal/commerce/...` — pass. Covers concurrent no-oversell reservation, persistence/restart recovery, exact Pay evidence, Wallet callback/scope/signature/replay, authorization/lifecycle and AI permission/provider/review boundaries.
- `npm test && npm run build` in `apps/shop` — pass; build emitted ignored `dist/`.
- `npm test && npm run build` in `apps/seller-console` — pass; build emitted ignored `dist/`.
- Cold-start `ynx-shopd` plus both `npm run smoke` commands — pass for health, capabilities, catalog and both static product roots.
- Browser verification — buyer desktop and 390x844 mobile; seller 390x844 mobile. Buyer and seller mobile document widths match their viewport with no horizontal overflow after the responsive fix.
- `npm ci && npm run hardhat:build && npm run contracts:selectors && go test ./...` — pass. Hardhat artifacts and `node_modules` are ignored and not committed.
- `make no-placeholder-check` — pass.
- `make secret-scan` — pass.
- `make env-check` — pass.
- `git diff --check` — pass.

Screenshot evidence:

- `apps/shop/evidence/buyer-desktop.jpg`
- `apps/shop/evidence/buyer-mobile.jpg`
- `apps/seller-console/evidence/seller-mobile.jpg`

## Exact integration requests

1. Review and register the Shop Wallet client/callback/scopes in the central Gateway after Task 1 lands. Replace the temporary adapter only with Task 1's strict protocol; do not weaken device, callback, scope, expiry or replay binding.
2. Point `YNX_SHOP_PAY_URL` at reviewed `ynx-payd`/Task 3 and provide a Shop merchant API key through deployment secrets. Confirm the response schema retains invoice ID, YNXT amount, transaction hash, status and committed block height.
3. Register Shop-specific AI scopes for the five workflows and map the current `/ai/generate` adapter to the reviewed Gateway contract. No provider secret belongs in either Web bundle.
4. Supply reviewed Trust evidence URL contracts, tax service and logistics provider only when those external systems are real. Until then, preserve `unavailable` / `link_only`.
5. Add deployment service wiring outside this branch's ownership after review. No public deployment or store acceptance is claimed here.

## Known external gaps

- Task 1 Wallet client registry is not yet integrated on this baseline.
- Task 3 Pay merchant credentials and deployed endpoint are not present in this worktree.
- AI provider quota/credentials, tax service, carrier API and reviewed Trust evidence service are external inputs.
- This branch proves responsive Web products and a deployable Go service; it does not claim native iOS/Android packages, production merchant acceptance, mainnet readiness or public launch.
