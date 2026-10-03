# Quant Paper pending-intent removal readback

Inherited branch `codex/exchange-sso-cookie-binding-20261002`, parent `4e9328f0acbabaed914dd2bcad9b4d3c092a6d73`.

## Reproduction and correction

Added regression before changing the app. A silently ignored `localStorage.removeItem` after a valid controlled Paper receipt left the durable request present while the UI considered storage available and memory pending intent cleared. The regression failed (`recorded/silent`: expected workspace storage unavailable, received available).

The product now removes the pending request, reads the exact key back, and clears the in-memory intent only after confirmed absence. Throwing removal or a surviving value closes stateful preview actions and retains the original intent in memory. This applies both to a bound successful simulated-order receipt and to a definitive typed input rejection. It does not cancel/delete service records, change Paper execution rules, create a fresh idempotency key automatically, or grant Wallet authority.

Four regression cases cover successful/rejected responses with silent/throwing storage deletion failure. The original key remains exact and another submit cannot issue a second request in the failed-storage page session.

## Executed verification

- `node --test apps/quant-lab/tests/business-flow.test.mjs`: 94/94 PASS.
- `node --test --test-name-pattern='actual Chrome blocks fresh Paper intent' apps/quant-lab/tests/browser.test.mjs`: 1/1 PASS, 2.940 seconds. Real local Chrome serves the current app through the Go server; a controlled Paper response and deliberate Storage fault are fixtures. It observes the visible storage warning and disabled fresh submit, then reloads and explicitly retries the byte-equivalent original request. Reload itself sends no order. One tab and no page errors.
- `go test -race ./internal/quantlab -count=1`: PASS, 4.430 seconds. No PostgreSQL URL configured for this run; opt-in SQL coverage is not claimed here.
- `npm test --prefix apps/quant-lab`: 103 PASS, 1 FAIL. The failure is `QUANT_ASSET_HASH_MISMATCH:styles.css` in the final release graph gate. Protected final asset bindings were not changed or bypassed.
- Node syntax and `git diff --check`: PASS.

## Release handoff

Only ordinary app and direct tests are changed. A release owner must bind final app/CSS/HTML bytes before publication; this source checkpoint is not a release-gate pass. No public deployment, installed package, actual Wallet approval, Product Session v2, real order or capital execution is proved. The browser order response is explicitly controlled, not an Exchange or chain trade. Existing public/source and SQL readiness gaps remain separate from this local persistence correction.
