# Exchange preview market lifecycle

Starting checkpoint: 5b378ba06de38b67511906232d8e513dfb5f37bc. Ordinary Exchange consumer only; shared Wallet/Auth, service and release graph unchanged.

Actual extracted production-renderer Chrome regression first failed (0 pass, 1 fail, 1459.358083 ms): loading left the old preview dialog open. The fix retires the visible preview on loading/offline/reconnecting/unavailable and changed trading-rule content. Equivalent live observations with reordered rule keys do not invalidate the preview. Price/amount draft is preserved. Pending read-only review is not cancelled by its own refresh; no review epoch or execution permissions changed.

Focused command: `node --test apps/exchange/tests/preview-market-lifecycle-browser.test.mjs apps/exchange/tests/order-preview.test.mjs apps/exchange/tests/market-data.test.mjs` — 46 pass, 0 fail/cancel/skip, 1232.710208 ms. Production app syntax and git diff whitespace checks pass. Browser fixture uses actual HTML and production lifecycle functions with controlled feed callbacks; one tab, zero HTTP requests. It is not public-market, real-wallet, account-approval or order-execution evidence.

App SHA256: da54021fe2f177463320ed6411c5238113ec8156198a2291ad45a42f26bad1af. Only ordinary app query pin updated. Unique release owner must compose these consumer bytes with its authoritative shared graph; no deployment, installer or formal bundle is claimed.

Existing owned-controls Chrome regression: 10 pass, 0 fail/cancel/skip, 14475.968042 ms. Combined locale/candle regression initially produced 22 pass/1 fail (22009.108208 ms): its isolated candle harness extracted renderMarketStatus without the newly referenced production helper, causing ReferenceError. Both affected extracted-renderer harnesses now include the actual helper, not a stub. Rerun: 23 pass, 0 fail/cancel/skip, 22453.446583 ms, including delayed preview owner transitions, stalled read unlock, conflicting revisions, 12 languages, desktop/mobile candle controls and private-service separation. These controlled browser regressions are not public or authenticated acceptance.
