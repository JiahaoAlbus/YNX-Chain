# Exchange owned-fill traceability

Inherited parent: b68e51c42a367695b1e8b6b2751e1938dbc92464 / tree fa64b9f4fcb2be53d4fdd94309ecc4eb7c58c4df. Ordinary Exchange activity UI and direct browser tests only; no shared Wallet/Auth/SDK, scope, engine, API, Host or frozen release-pin changes.

Existing contract: internal/exchangeproduct/types.go Trade carries id, buyOrderId, sellOrderId, buyer, seller, buyerFeeMicro, sellerFeeMicro, sourceType and sourceDigest. service.go match settlement creates that Trade, uses its exact ID as ledger/fee reference and records deterministic_price_time_match. No endpoint, transaction hash or custody assertion is invented.

The previous owned trade-history view displayed time/side/price/amount/fee only, losing the persisted references needed to compare a fill with order and ledger history. Actual Chrome red test failed on missing matched-trade-A-B (1171.80475 ms). The view now also displays exact trade reference, selected owner's buy/sell order ID, source kind and full digest. All values are textContent, missing nonstring/empty references remain unknown, and existing owner filtering/fee-side selection remains intact. Existing translated Reference/Order ID/Source/Source digest labels are reused across 12 locales. Venue records are not made into chain Explorer links or write controls.

Actual mobile Chrome tests verify buyer A gets buy-order-A and fee 17 micros, seller B gets sell-order-B and fee 43 micros, foreign C/D matches are hidden, full digest preserved, no fabricated link/button, source objects unchanged, and no document-width overflow. Actual locale module/selector events verify all new headers and retained exact references/source/digest in every locale, including RTL, with zero requests.

Initial four groups: 70/70 PASS (24312.357709 ms). Extended 12-locale trade case: 1/1 PASS (4217.746708 ms). Final owned-controls-browser + owned-record-integrity + locale-browser + market-data + private-account: 97 PASS / 0 FAIL / 1 existing explicit opt-in Go/Chromium authority SKIP, 98 total, 21733.809125 ms. Syntax and git diff --check PASS. These are controlled local records/renderers, not a public matching or real Wallet flow.

Formal compatible backend/frontend/assets publication and accepted public v2 order-write producer remain unresolved with A. No account approval, signature, order, transaction, native install, public deployment or ComputerControl claim. Handoff only to 接续测试网生态审计工作. Rollback is a normal revert of this owned checkpoint, not reset of inherited history.
