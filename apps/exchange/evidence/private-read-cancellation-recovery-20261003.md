# Exchange owned account read recovery

Reviewed predecessor: 17f55860896370847429a7edcff71cbbf5060123,
tree 607b3e6aff26b67e5844952eadec5ca3fc21397d.

## Implemented

The owned account controller now bounds its complete HTTP response and body
wait against cancellation. A non-cooperative transport cannot keep the original
read promise pending after the deadline, Guest, offline, or close. Expired read
operations do not accept late bodies or replace a newer account. Retry still
requires the unchanged canonical SDK to produce a new introspection proof.
No write scope, token, provider permission, or standard-wallet disconnect was
added. A timer seam permits deterministic operation-lifecycle regression tests;
production retains the existing native timers and ten-second read deadline.

## Executed gates

Command: `YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test
apps/exchange/tests/private-account.test.mjs
apps/exchange/tests/market-data.test.mjs
apps/exchange/tests/order-preview.test.mjs
apps/exchange/tests/candles.test.mjs
apps/exchange/tests/candles-browser.test.mjs`.

59/59 PASS, zero skipped, 4619.730583 ms. This includes the controlled actual
Chromium-to-Go HTTP account read, host-only browser identity binding, two account
isolation and linked logout denial fixture; it is not real Wallet approval.
Response/body waits each exercise deadline/Guest/offline/close, late foreign
results, fresh proof retry, and complete request/expiry timer cleanup.
Node syntax and `git diff --check` pass.

## Exact remaining internal integration requirements

- `private-session.js` is a frozen compiled entry. The release owner must build
  the updated owned controller into that entry and update the complete served
  graph and pins. Direct source-controller QA does not prove that old compiled
  entry or public runtime has changed. No compiled/shared authority graph was
  overwritten by this checkpoint.
- Accepted v2 policy in `internal/exchangeproduct/session_v2.go` is exclusively
  `exchange:read`, with only GET account, margin account and liability-proof
  routes. Existing PUT security / POST support / POST AI cannot be authorized
  by promoting this read grant. Shared action verifier/grant and actor/object
  commit contract are required from the existing shared owner; ordinary API
  adaptation and user-facing recovery remain this product owner's work.
- Newer Exchange source is not yet proven source-bound publicly. Installer,
  real provider approval/callback, private Product Session lifecycle, signatures,
  orders and on-chain execution remain unverified. The complete ecosystem goal
  remains active; this is not a product-completion claim.
