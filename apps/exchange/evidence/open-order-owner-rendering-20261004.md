# Exchange current-order owner boundary

Predecessor: `22efb60a563ef5496a146371bb3a19e629216566`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.

The current-order renderer previously selected open/partially-filled rows only
by status, unlike the owner-filtered activity history. A controlled mixed-owner
input reproduced two action buttons where only one belonged to the current
account. Initial installed-Chrome regression failed `2 !== 1` (1301.144 ms).
This is a renderer defense gap; the existing private snapshot validator already
rejects foreign-owned API records. No live cross-account API access is claimed.

Product fix: require the selected owner for open rows, tolerate unavailable
snapshots, and recheck current owner plus exact record membership before
forwarding a button intent. Account switch, loss, and detached old buttons must
not forward a retired record. Record input is neither sorted in place nor mutated.
No write permissions, endpoint, transaction or cancel implementation was added.

Actual installed-Chrome fixture executes the product render functions with
controlled local records, at mobile viewport 390x844: A/B rows isolated; closed
rows excluded; only matching current records reach a captured local intent;
detached old buttons after switch/loss do nothing; no page errors or new tabs.
The intent capture is not cancellation or financial execution evidence.

Concentrated regression:

`node --test apps/exchange/tests/owned-controls-browser.test.mjs apps/exchange/tests/owned-record-integrity.test.mjs apps/exchange/tests/locale-browser.test.mjs`

Final: **34/34 passed**, 0 skips/failures, 28684.234 ms. Includes account and
history isolation, signed ledger quantities, malformed-read recovery, draft
preservation, logout fencing, and twelve-language records/market/preview flows.
First concentrated run: 33 pass/1 fail; an older public-chart fixture stripped
`export` without removing named export declarations, leaving invalid inline JS.
The fixture now removes named export declarations before its existing inline
conversion; production market code and its validation were not changed.

`node --check apps/exchange/web/app.js` and `git diff --check`: passed.

No shared authority/SDK, formal bundle/hash pin, Host or production mutation.
Public source-bound release, native installation, real approval/cancel/order,
Product Session lifecycle and ComputerControl remain unproven. Existing write
actions still need their accepted authority/producer contract and release-owner
integration; this checkpoint must not be called a complete trading product.
