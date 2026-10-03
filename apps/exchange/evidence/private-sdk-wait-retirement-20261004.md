# Exchange private read: retire stalled SDK waits

Inherited branch `codex/exchange-sso-cookie-binding-20261002`, parent `5df80161fb736f4f03fcc107c884b420c9730117`.

## Reproduced defect and correction

Executed the controller from parent HEAD in an isolated Node module with an unresolved SDK restore. After Guest, the visible snapshot was cleared but the original caller remained unresolved. The HTTP/body abort deadline did not cover waits in SDK restoration or introspection proof creation.

The product controller now races the operation against its own retirement notification. Guest, network loss, close and superseding operations settle waiting callers without depending on the SDK promise finishing. Existing epoch checks remain active, so late restore/proof results cannot issue an account API read or repopulate private data. Native pending retirement still uses the unchanged SDK disconnect path; standard Wallet state is not modified. This change neither cancels promises inside the shared SDK nor claims private-session server revocation.

Regression exercises restore/proof waits across Guest, offline, close and replacement (eight cases). It verifies settlement before late completion, fresh recovery after retirement, no late API request and no account-permission/signing/standard-disconnect interaction.

## Executed gates

- `node --test apps/exchange/tests/private-account.test.mjs`: 26 PASS, 1 opt-in browser skip, 0 failures.
- `YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test --test-name-pattern='actual Chromium controller' apps/exchange/tests/private-account.test.mjs`: 1 PASS, 5.270 seconds. Actual local Chrome and Go API test service; controlled identity/proof authority, not public Wallet approval. Cookie binding, linked logout, switch-account and navigation recovery remain isolated.
- `npm test --prefix apps/exchange`: 99 PASS, 2 FAIL, 1 SKIP. The failures are the protected historical release identity-helper hash and versioned `styles.css` hash gates, not a passing release. Neither protected binding was changed here. Release owner must reconcile final source graph and pins before publication.
- `node --check` and `git diff --check`: PASS.
- Private module build to temporary output only: 140326 bytes, SHA256 `a08916cf3256b19da4e0a531d9b079782e98f9fc9e51732fc58930818f751d1e`; `/tmp/ynx-exchange-private-cancel.hcZIbt/private-session.js`. Tracked release bundle/pins were deliberately not overwritten.

## Remaining boundaries

This is an ordinary product-source correction. The release owner must regenerate the official private module and complete the exact source graph/pin verification before publishing. No Host, shared SDK, Finance authority, production database, installed artifact or public runtime was modified. Real Wallet approval, Product Session v2 lifecycle, public account reads and public trading remain unverified. Controlled browser QA cannot promote those gates.
