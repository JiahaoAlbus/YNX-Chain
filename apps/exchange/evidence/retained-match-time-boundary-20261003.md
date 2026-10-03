# Exchange retained match time versus snapshot observation

Inherited clean owner branch `codex/exchange-sso-cookie-binding-20261002`, predecessor `0cb45b790e3cd1904df3cea55c35dd22e0636673`. Existing ordinary public market display only; no matching, financial execution, private permission or shared release change.

## Current public evidence

Read-only GET `https://exchange.ynxweb4.com/api/v1/market-data/snapshot`: HTTP 200, 9854 bytes, SHA256 `ae11aa13b4faaa3b5d8993392bb322792dfb2ebc70c061eeb412d63d88671b68`, revision 478, observation `2026-10-03T07:59:51.603980229Z`, status `degraded_single_host`, 30 retained trades. Immediately preceding same-revision observation `2026-10-03T07:59:22.898012282Z` had payload SHA256 `a12e2c960ca3efc1c4954a76a70ce149e00e811c370b4ce9ae542bbbaa69a2cf` and latest trade `trade_000000000455`, time `2026-08-03T18:41:37.614045168Z`, type `deterministic_price_time_match`, digest `6e07d764ee8b416cdda23a16c27985109619685d2b9f487a67d26970ac7f3b4f`.

A current snapshot observation is not a newly executed trade. This is retained historical test-venue data, not external liquidity or a current executable quote. No new match, order, account, signature, transaction or write was requested. In the first observation logger a duplicate `status` property masked the HTTP status with source status; the second observation above records `httpStatus` separately. Neither changing payload SHA is presented as a state revision or new fill.

## Actual correction

The market panel now displays the exact latest retained match timestamp separately from the existing snapshot observation timestamp. It binds match ID/time/source digest in DOM data attributes and renders all values as text, retaining RFC3339 nanosecond precision. The existing validated candle ordering determines the latest match, independent of wire row order or chart interval. Empty retained history removes all three attributes rather than leaving a stale success. The historical-price/non-executable-quote boundary and label have all 12 Exchange locale translations; language changes do not redate the match.

Transport connection state and historical trade time remain separate. A disconnected feed retains the verified old match with the existing stale-snapshot warning. Same-revision observation refresh does not invent new activity. No arbitrary stale-price threshold or fabricated ticker was introduced.

## Verification

- `node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/candles-browser.test.mjs apps/exchange/tests/locale-browser.test.mjs`: 40/40 PASS, 0 skipped, 20780.079209 ms.
- Actual controlled local Chrome: 1440/390/320 widths, every locale, 1/5/60-minute candle controls, exact match attributes, empty-history clearing, no overflow/request/provider/order/signature and one tab. Separate read-only feed fixture advances snapshot observation without changing retained match time; conflicting revisions retain old match and stale warning until recovery. These are local fixtures, not public lifecycle acceptance.
- Correct existing backend paths: `go test -race ./internal/exchangeproduct ./apps/exchange/server -count=1`: PASS 9.117 s / 1.437 s. PostgreSQL environment skips are not multi-instance proof. Initial guessed `./internal/exchange` command failed because that directory does not exist; it is not a passing backend check.
- Node syntax and `git diff --check`: PASS.

## Integration and truthful remaining gates

This owner does not update shared formal served graph/pins or deploy the Host. The unique release owner must consume the updated app, HTML and locale as one source-bound release, preserving its current exact release for rollback. Latest ordinary owner fixes for Exchange, Finance and Quant remain cumulative on this branch. Public adoption of this change=false; installed=false; real provider approval=false; private write authority=false; order/chain success=false; overall completion=false. Central reporting destination remains `接续测试网生态审计工作` only.
