# Finance local v2 cross-service and Broker status source checkpoint

This is a Finance-owner source and isolated-local-QA checkpoint, not a public
release, installed Wallet approval, production session, Broker order, or
Testnet transaction.

The browser QA starts the real durable Wallet/Auth Gateway NodeHost on
loopback, serves the actual Finance Web files at the registered HTTPS origin
through a socket-only browser relay, uses a disposable Ed25519 QA Endpoint
Authority configuration, and follows the real private begin/callback path.
It signs a disposable test-account approval, then passes a browser-generated
v2 proof to the real Finance Go `NewServer` protected `/api/overview` route.
The Go route introspects the proof against the running NodeHost and rejects
replay. The Explorer fixture is explicitly unavailable, so this does not prove
portfolio data, public Gateway availability, or an installed Wallet flow.

Two Finance-local authority races were corrected: concurrent reads of one
unchanged signed checkpoint no longer supersede each other, and a checkpoint
marker is written only after the durable IndexedDB commit. Unchanged
checkpoints no longer emit cross-tab invalidation. The QA config advances its
trusted clock per request; this is not a production endpoint change.

Broker's submitted/filled status readback now says only that this GET did not
submit or reconcile with the provider. It does not assert that a historical
order was never sent to the provider. Diagnostic codes and provider-originated
data remain unmodified.

Verified locally:

- `go test ./internal/finance/...` passed.
- `node --test apps/finance/tests/endpoint-authority-browser.test.mjs apps/finance/tests/local-product-session-cross-service.test.mjs` passed 5/5.
- `node --test apps/finance/tests/finance-12-locales.test.mjs apps/finance/tests/broker-execution-browser.test.mjs` passed 28/28.
- `npm run build:wallet` produced the deterministic local bundle; shell/JS
  syntax and `git diff --check` passed.

Open release gate: the active immutable Wallet verifier manifest pins the
previous `endpoint-authority-entry.js` and bundle, so its exact-integrity
suite currently fails 6/11 with `FINANCE_WALLET_FILE_INTEGRITY_MISMATCH`.
Do not repin it without independent review of the final Finance source set.
Other legacy dynamic Finance sections still need complete 12-language
coverage. Public deployment, source-bound runtime, real wallet approval,
provider account, sign, order, payment, and on-chain transaction remain false.
