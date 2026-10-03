# Direct Exchange candle publication gate

Owner predecessor `ead26d011080db4540dacffe873342ace4b3919f`.
Observed UTC 2026-10-03T16:14:38.656Z (Asia/Shanghai 2026-10-04).

## Public evidence, not a source-only receipt

Actual installed Google Chrome opened `https://exchange.ynxweb4.com/`, HTTP 200, default en, one public page and no uncaught page errors. API version is still `91c1a40587d28ad4c931d4a4d601766bd467ea20`, 0.1.0-testnet. `/api/version` HTTP 200, 107 bytes SHA256 `b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8`.

`/api/v1/market-data/snapshot` HTTP 200, 9852 bytes SHA256 `eebc27af73860bff30744f665f7be447e6363bc9a5056b1b452c8a233d342ee0`, revision 478, observed asOf `2026-10-03T16:14:38.61095573Z`. Existing strict owned validator accepts the real returned payload: 30 retained price-time test-venue matches, 3 bids and 0 asks. Authority YNX-owned deterministic order state; classification testnet; source status degraded_single_host, file_snapshot backend, multiInstance=false. Latest retained trade is from 2026-08-03T18:41:37.614045168Z, not a new October trade. Snapshot SHA varies with observation timestamp; no assertion that the old price is a current executable quote or real-chain settlement.

Public page displays 20 recent matches, but `chart-empty` remains visible; interval control count 0 and candle trace rows 0. Exact public `/app.js`: 200, 29163 bytes SHA256 `74d389577a2c4cfa0c8f747f51b43274bf4bc209cafe694392942e125c8dc562`. The current owned candle UI has not been published.

The initial unmodified read-only browser open additionally observed automatic GET SSO start/callback and a redirect to `#assets` without clicking sign-in. The frozen verifier now blocks `/sso/start` and `/sso/callback` plus every browser write method; the final run captured an attempted GET `/sso/start` and aborted it. No Wallet/account provider method, signing or order was invoked. This prevents future guest QA from silently entering authentication. No credentials or response secrets are retained.

## Same real data, owned candidate renderer

`apps/exchange/scripts/verify-public-market.mjs` independently renders the exact returned trades in a controlled local Chrome page using the actual owned HTML, market-data module and `renderPublicMarket` function. No invented matches or prices. Each 60,000/300,000/3,600,000 ms interval yields one real candle group and one trace row; SVG hidden attribute removed correctly. This local candidate passes; it is explicitly separate from direct public failure and does not prove published source or private business.

Executed verifier exits 65 deliberately with `currentCandlePublicationGate=false`, `publicMarketReadable=true`, `localOwnedRenderer.passed=true`. Syntax/diff gates pass. No production writes, Host access, service changes or source replacement. Provider approval, Product Session, native install and multi-instance production remain unverified.

## Exact next release action

Unique A must integrate ordinary Exchange candle/rendering/locale/market-feed hunks from this owned branch into its coherent authority graph, preserve the real persisted venue data, then publish a source-bound version. Re-run this read-only public gate: interval selector present, retained matches yield nonempty trace/candle view, and automatic unactioned SSO must not disturb guest market browsing. Do not overwrite A's shared graph or fake a trade to make the chart appear. Formal backend database migration and protected write permissions remain their separate acceptance requirements.
