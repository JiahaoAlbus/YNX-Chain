# Exchange selected-language time display

Owner base 075663ac30a8540e92ce330bc7cf66cc11836de3. Ordinary Exchange renderer and browser regression only; no SDK, authority, build pin, deployment or business write.

Actual pre-fix Chrome regression failed: English product language expected `10/3/2026, 8:19:00 AM`, but matched-trade table displayed browser-default `2026/10/3 08:19:00`. The renderer used `Date.toLocaleString()` without the product language. The read-only order preview had the same omission for its rule observation time.

Both now use `document.documentElement.lang || 'en'`. Canonical timestamps, source digests, matching order, OHLCV, balances, fees and business authority are unchanged. Rule source status remains its machine value; this is not a claim every product string is now translated.

The actual DOM/browser regression switches all twelve product languages. Matched trades are checked in 1440/390/320-pixel viewports; source JSON remains byte-identical, and canonical match ID/time/digest remain unchanged. Actual preview handler uses its existing decimal/rule validation and read-only refresh seam; its rule time follows all twelve selected languages, with no Wallet call, POST or created tab. Fixture market/rules are controlled local input, not public trading evidence.

Commands/results:

- `node --test apps/exchange/tests/candles-browser.test.mjs`: 5/5 PASS, 8714.541167ms.
- `node --test apps/exchange/tests/candles.test.mjs apps/exchange/tests/order-preview.test.mjs apps/exchange/tests/market-data.test.mjs`: 46/46 PASS, 92.475375ms.
- App/test syntax and git diff checks PASS.

Local controlled screenshots retained at `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-candle-display-MXKJrD`: candles-1440.png, candles-390.png, candles-320.png. These are Playwright local fixture screenshots, not ComputerControl public/provider acceptance.

SHA256 respectively: `f5ddb09d0516af93198a5c6bd72f13f9d916e988f9c3d714140a252f62c84639`, `c3bccb7779be321e38ec0aa11db810d29bc555b33f7963cb2ecb3b5498e7ae2c`, `691a93e85d85a8590032f117c2e0ec1c87c16b58bdcd2ef4eab3f52e745fdbb2`.

Public source binding, actual installed Wallet approval, signatures and orders remain unproved. Release owner must consume ordinary renderer hunks into its coherent source graph; inherited version pins were not changed by this owner. Shared Web write-contract gap remains separately recorded.
