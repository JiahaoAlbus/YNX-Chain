# Exchange advisory preview draft recovery

Inherited parent: 72b69cd1fbf233fd710e15f353bc8ee7030692f5 / tree 3c79d8e513d3f53c843d28db69fca7bf9f06d9f4. Ordinary Exchange UI and direct tests only; no shared authority, SDK, permission, endpoint, engine, Host or formal release pin changes.

Actual mobile Chrome reproduced a delayed public rule read opening a preview for price/amount/side edited after the original click. Red regression failed in 3122.10225 ms. reviewOrder now captures those three draft values and discards both successful and failed read outcomes when the draft differs; existing account/phase/epoch fences remain. Inputs are retained, the preview button unlocks, and a fresh explicit preview succeeds. This remains advisory arithmetic and a public read, not an order submission or Wallet request.

The actual renderer/controller regression covers each changed field, retired read error suppression without erasing the new draft/error, logout, account switch, same-account re-entry, fresh owner preview, unchanged Standard Wallet fixture, zero actual network requests and one tab/zero page errors. Fixture extension initially collided with the arithmetic helper's fail identifier (96 PASS / 1 FAIL / 1 SKIP); renamed its reject callback without changing application logic. Final seven-group run: 97 PASS / 0 FAIL / 1 existing opt-in Go/Chromium authority SKIP, 98 total, 17029.49 ms. Earlier four groups: 77 PASS / 0 FAIL / 1 SKIP, 9683.909083 ms.

Commands: node --check apps/exchange/web/app.js; node --check apps/exchange/tests/candles-browser.test.mjs; node --test apps/exchange/tests/{candles-browser,order-preview,market-data,private-account,candles,owned-controls-browser,owned-record-integrity}.test.mjs; git diff --check.

Controlled local display screenshots: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-3QyZCB. Not public, installed, ComputerControl, real approval/signature or transaction evidence. Existing public v2 write-producer and compatible source-bound formal release dependencies remain unverified. Handoff only to 接续测试网生态审计工作. Rollback is a normal revert of this ordinary UI checkpoint, not history reset.
