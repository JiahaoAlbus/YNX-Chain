# Exchange account read consumes the accepted business-proof method

Baseline `0cdbe49d84844c37f92c9505c445727c864bb73b`; branch `codex/exchange-sso-cookie-binding-20261002`.

Authority read in full: `recovery-20261004/shared-ai348-pay286-finance-identity-source-composition-20261004/EXCHANGE_READ_DUAL_PROOF_CONSUMER.md` under the existing coordination-01a094cc directory, SHA256 `2ac072dfc60a4a8b699b2e7e2f6c12d817a28b003e80cebc83cfa8a4ab8ba141`. Its accepted standalone `consumer-sdk-inputs/wallet-auth-web.mjs` independently hash-checked to `872e83462de6ecca671a3b18177700a04ff8d050f3810c82c9c846079109af51`. Original factory is createBrowserProductSessionClient, not a fabricated Adapter alias. The accepted SDK source was inspected, not copied, modified or executed in this change.

The ordinary account controller now calls its bound adapter once:

`createBusinessProof({method:'GET',path:'/api/v1/account',body:'',requiredScopes:['exchange:read']})`

It sends `introspection.proofHeader` as X-YNX-Product-Session-Proof-V2 and independent `proofHeader` as X-YNX-Product-Session-Action-Proof-V2. GET has no wire body. Missing method, missing/oversized/control-character header, reused identity header or nonempty/missing returned body fail before HTTP with ACTION_PROOF_UNAVAILABLE. Session expiry is rechecked after proof creation. No introspection-first nonce consumption, low-level signing, fallback identity proof, new scopes, SDK protocol or write was introduced. Existing exact origin/cookies/epoch/abort/response-body/record ownership fences remain.

## Actual verification

- Pre-fix RED: both new controller tests failed (63.028667ms): old handler called standalone introspection, and missing business method surfaced the wrong generic error.
- Four-file regression (`private-account.test.mjs`, `browser-identity-response.test.mjs`, `market-data.test.mjs`, `owned-controls-browser.test.mjs`): 91 pass, 0 fail, 1 opt-in skip, 15951.880958ms.
- Explicit original Go/Chromium HttpOnly-cookie/reload/account-switch/global+linked-logout regression: 1 pass, 0 skip, 3514.667834ms. This original authority fixture verifies browser association, not the new canonical dual-proof dispatcher; its extra action header is controlled test orchestration, explicitly documented in the fixture.
- Final expanded malformed-header/fresh-pair tests: private-account suite 31 pass, 0 fail, 1 opt-in skip, 162.305958ms.
- Node syntax and git diff whitespace gates pass.

## Required matching assembly, not complete

Existing `private-session-entry.js` and vendored 9840 SDK, formal generated private-session.js, registry/pins and production main were intentionally not overwritten. Old 9840 lacks createBusinessProof and now fails closed before account HTTP. Release owner must assemble the approved standalone input and matching existing factory/registry/entry with this exact controller while preserving prior stream, UTF-8, error-classification and owned-record changes. The other two admitted GET routes have not been added to this account-only controller. Other private writes remain ungranted.

No real approval, account proof, signature, transaction, SSH, Host change, public release or installation occurred. Canonical main/SDK pairing, public business flow and native/Wallet acceptance remain NOT_VERIFIED. This is an ordinary source consumer checkpoint, not whole-SDK or public completion.
