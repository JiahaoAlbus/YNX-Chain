# Finance locale/source recovery

Source commit: 1e649ad90b8279fe44fe6d3aa3c7bc459eae1813.
Source tree: a385485fa737c1ecac52c78ef6ec389c7c775df1.

The real locale-change event previously dereferenced unavailable Explorer metadata and used truthiness rather than the exact `available === true` authority rule. The event now tolerates missing metadata and keeps non-boolean availability fail-closed, matching normal rendering. It does not rewrite the overview or invent source evidence.

The existing browser regression now cycles all 12 locales for null, array, empty object, string-true and numeric availability values. It verifies localized unavailable balances, absent Explorer links, unchanged source objects, no page errors, no requests and no new tab.

Executed: `node --check apps/finance/web/app.js`; `node --test apps/finance/tests/overview-source-browser.test.mjs`; Finance-only `git diff --check`.
Result: 9 tests passed, 0 failed, 0 skipped; 6758.251417 ms. Controlled local browser rendering only, not public/installed provider or business proof.

No shared SDK, authority profile, producer, generated bundle, Host, credentials or other product was modified. A's source-bound formal composition/public release and direct authorized user journey remain separate pending gates.
