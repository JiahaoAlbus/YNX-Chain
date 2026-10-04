# Exchange preview owned-balance lifecycle

Base 02d6ec771d9ec87bd6eb98888f82633306b7c545 / tree b1d39709a08fa98085aa8763e3c3817385ceb6ff. Previous ordinary Exchange runtime 97a259368d533d97e1fcc5396e04663df19e7a12 is inherited, not recreated.

Confirmed local defect: while the same private owner remains connected, a newer owned balance snapshot leaves an open preview displaying the older available funds. The same owner/phase check also admits a delayed public rule read after that balance changes. These are advisory observations, not reservations or submission authority; this repair does not claim an executed order was affected.

Original actual browser regression: 0/1 FAIL, 1360.409667 ms; `same-owner balance change retires the old available-funds preview`, expected closed but actual dialog remained open.

Correction only inside the ordinary app renderer: compare canonical owner/asset/available/reserved balance observations before accepting the incoming state. Any actual change increments the existing preview epoch, closes/clears the old modal and fences a pending read. A sorted copied projection preserves valid previews when equivalent balance rows or object keys reorder. Original snapshots are not mutated or normalized; source validation remains the existing private controller's responsibility. Draft price/amount, selected Standard Wallet and private account authority are unchanged.

Executed validation:

- `node --test apps/exchange/tests/candles-browser.test.mjs apps/exchange/tests/order-preview.test.mjs apps/exchange/tests/preview-market-lifecycle-browser.test.mjs apps/exchange/tests/owned-controls-browser.test.mjs`: 26 PASS, 0 fail/cancel, 16037.709125 ms. Includes same-owner available and reserved changes, pending review epoch, prior account-loss/ABA/input-edit fences, market/rule change and exact arithmetic, localized controls and owned history.
- After adding the final equivalent row/key ordering regression: `node --test --test-name-pattern='real order preview retires private balances' apps/exchange/tests/candles-browser.test.mjs`: 1 PASS, 0 fail, 1066.352459 ms. Actual product HTML/render functions in isolated Chrome, zero HTTP requests, one tab, zero page errors, no account approval or orders.
- `node apps/exchange/web/verify-versioned-assets.mjs`: PASS, pageAssets=4/moduleAssets=4. Ordinary app SHA256 ec29b6941244b2156b383f5ac3a26dd3803bf9cb97ccda16c31a7c9860edfb31; exact HTML query pin updated. Shared assets/SDK untouched.
- `node --check apps/exchange/web/app.js` and `git diff --check`: PASS.

Publisher integration: only this evidence, app.js's balance epoch hunk, its index app query pin and candles-browser regression are new. Preserve the current shared graph and prior ordinary UI source; take the bounded base-to-runtime diff rather than replacing the owner branch or old generated SDK. Historical market-consumer-inputs-20261004.json remains accurately frozen to dce7005/97a and must not be labelled this current runtime; a stale current-byte custody check is not a new production or SDK defect.

Current public source replacement, formal build, installed packages, actual Provider approval, Product Session, signed order/settlement and completion remain NOT VERIFIED. Source resource hashes/local controlled browser success do not establish them. Real UI presently offers only guest limit preview with no submission; command permission/producer integration remains with the unique shared/release owner. No production writes, financial writes, Standard Wallet disconnects or new SDK/protocol changes were performed.
