# Existing advanced-order read closure — local source evidence

Source commit: c71fb5b230d73c6d7decf7db14bc770157cc627c
Source tree: f8d93062a4d2e98ab2762144548c724beb6476ce
Predecessor: 13eb6c865c938e70d69f4dfe1775ba528ee790d3
Branch: codex/exchange-sso-cookie-binding-20261002

## Inherited behavior and change

The original Exchange AccountSnapshot already returns conditionalOrders,
ocoGroups, twapOrders and scaleOrders. This change exposes those existing
owned records in the Activity advanced-orders tab. It adds no order endpoint,
scope, signing, strategy execution or write authority.

Present collections require arrays, unique IDs, current owner, original market
and side, nonempty status, nonnegative safe integer amounts, coherent TWAP
slice/scheduled counts and Scale filled quantity, and distinct nonempty child
references. Malformed/cross-owner data fails before presentation. Legacy
responses may omit collections, but the UI labels each missing collection
unreported/unverified rather than inventing an empty collection.

TWAP scheduled quantity is not displayed as filled quantity. Activation of
conditional/OCO tasks is explicitly not a fill. Unknown status codes remain
unaltered. References/reasons use textContent; no invented Explorer link,
cancel button or write request is introduced. All 12 existing locales include
the new tab, task labels and interpretation warnings.

## Executed gates

- node --check: app.js, private-account-controller.js, locale.js,
  owned-controls-browser.test.mjs and private-account.test.mjs: PASS.
- git diff --check: PASS.
- Focused advanced-account and actual-page tests: 2 PASS, 0 FAIL,
  3163.440541 ms.
- Final combined private-account, owned-controls-browser, locale-browser
  and market-data suites: 95 PASS, 0 FAIL, 1 explicit opt-in isolation test
  skipped, 37879.608708 ms.
- Actual Chromium product HTML, tab binding, renderer and locale module:
  current A/B ownership filtering, account loss clearing, all four task
  types, exact quantities/reservation, unknown status preservation,
  literal markup, missing-versus-empty collections, all 12 locales,
  0 network requests and 0 write controls: PASS.

An earlier browser fixture failed because it had not activated the Activity
view before clicking its hidden tab. The fixture now opens the actual view;
the failure was not suppressed. Earlier combined result: 58 PASS, 1 FAIL,
1 skipped (70657.539583 ms). The final combined run above is the corrected
executed result. Prior initial controller regression also caught silently
ignored malformed advanced collections; the controller now rejects them.

## Release dependency and truthful boundary

This is ordinary owner source/local browser evidence, not public, installed,
canonical Product Session, real Wallet approval or trading acceptance.
The old formal private-session entry/vendor still lacks the accepted
createBusinessProof factory. The ordinary controller consumes that accepted
seam and fails closed until A supplies the matching formal SDK/source graph.
No shared SDK, protected composition, formal generated bundle/pin, build,
Host or deployment was changed. Matching release must include this source,
the previously delivered dual-proof consumer and the accepted SDK input;
old controlled authority fixtures cannot establish that integration.

Unproven public/runtime/installation/account-approval/signature/order-write/
chain-transaction/Product-Session gates remain false. Problems and release
requirements are routed to 接续测试网生态审计工作, thread
01a094cc-0ba3-7901-bcd5-56fce8330c0d.

The inherited full engine PostgreSQL/multiprocess race and preview/candle/
locale regression evidence remains separately recorded at
full-engine-and-preview-regression-20261004.md; it is not relabeled as a
new public test by this change.
