# Exchange snapshot deadline recovery

Predecessor: 3430ae7d925de8c5a72e2d51186424b64bf4ba34. Ordinary public GET transport only; no Wallet/Auth, order, transaction, shared graph or deployment mutation.

Fail-first regression reproduced two defects: the 10-second request deadline only aborted a signal, leaving the phase `loading` and no retry if the transport/body did not settle; offline/stop retained a request timer until the unresolved promise returned. Original suite: 17 pass, 2 fail.

The deadline now retires the read epoch, aborts and labels the last verified snapshot stale/unavailable, then schedules existing bounded backoff. Late results cannot overwrite a recovered revision or create duplicate streams. Cancellation clears request deadlines immediately. An old request's finally block only clears its own timer and cannot clear the current request's timer.

Command: `node --test apps/exchange/tests/market-data.test.mjs apps/exchange/tests/candles.test.mjs apps/exchange/tests/candles-browser.test.mjs`

Result: 24/24 PASS, zero skip, 3805.497875 ms. Includes controlled local Chrome desktop/mobile chart and stale-view recovery; NOT real public Wallet/account approval or public deployment. New stalled-transport tests use isolated deferred reads/fake clocks, not fabricated public matches. The active browser fetch is signalled aborted; an injected noncooperative promise itself may remain unsettled, but the feed no longer depends on its settlement to recover.

`go test -race ./internal/exchangeproduct` PASS (14.470s). Syntax and diff checks passed. Release input manifest at predecessor remains a frozen reviewed-source inventory, not this successor's final publication inventory. Release owner must include this delta and regenerate source-bound inputs/pins before publication. Public/installed/real approval/order/transaction completion remain unproven.
