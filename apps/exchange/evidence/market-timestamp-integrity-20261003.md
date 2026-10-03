# Exchange market timestamp integrity — 2026-10-03

Owner scope: Exchange public read consumer/tests only. No shared SDK,
authority, formal asset pins, Host, installer or public release changed.

## Reproduction and correction

An actual `validateSnapshot` regression initially failed: `Date.parse('0')`
was accepted as a venue timestamp. The same validation accepted locale dates,
zone-less dates and normalized impossible calendar dates such as February 30.
These inputs can give misleading source ages, tape times and candle buckets.

The existing consumer now requires the venue RFC3339 shape with an explicit
zone, valid calendar day/leap year, valid time/offset and at most nine fractional
digits. UTC, offsets and nanosecond precision remain accepted. No historical
record is rewritten and no price, trade, candle or observation is synthesized.
HTTP rejection produces no snapshot/stream; invalid reconciled stream time
preserves the verified snapshot and retires the stream as MARKET_DATA_INVALID.

## Executed checks

- `node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/candles.test.mjs apps/exchange/tests/candles-browser.test.mjs`: 39 pass, zero fail/skip.
- Real controlled local desktop/mobile candle browser tests: 3 pass, screenshots
  `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-a5EPhV`.
- Full Exchange `npm test`: 98 tests, 96 pass, 1 fail, 1 skip. Retained failure
  `EXCHANGE_ASSET_HASH_MISMATCH:styles.css`; no gate waived or formal pin edited.
- `node --check apps/exchange/web/market-data.js` and `git diff --check`: pass.

Local browser fixtures are not public runtime, real account, installed Wallet,
order, signature or transaction evidence. Formal coherent graph integration
and publication remain with wallet_release_owner through the successor audit
thread; all unproved public/installed/private-session/transaction gates remain false.
