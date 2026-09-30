# Exchange central browser identity consumer checkpoint

## Implemented boundary

The shared `internal/productsessionv2/browser_sso.go` adapter handles only registered browser identity: exact client, origin, audience, PKCE callback, server-only grant introspection and host-only Secure/HttpOnly cookies. Its production constructor rejects loopback authorities. Finance's original key derivation domain and cookie AAD remain compatible; the existing Finance implementation is not replaced in this checkpoint.

Exchange enables the adapter only with exact `YNX_EXCHANGE_CENTRAL_BROWSER_SSO=true`; empty or `false` leaves it disabled, other values fail startup. It uses the fixed official authority and existing persistent operator key material. No new secret, issuer, account mapping or financial permission is introduced.

The existing schema-10 repository, data and original `exchange:read` Product Session proof gates remain. Optional durable native-session-to-central-grant association requires the same native account and fresh backend introspection. It is semantic/idempotent under concurrent first reads and existing repository CAS. A linked session cannot bypass product/global revocation by deleting its browser cookie or restarting the service. Orders, custody and execution remain separately gated; `identity:read` never grants these permissions.

The web consumer provides explicit identity sign-in to the current registered target, recheck and product-only logout. Refresh/focus only rechecks identity; it never redirects into authorization. Identity status is explicitly not private Exchange authorization. Original native/private and public market routes are retained. The new module hash is bound in HTML.

## Local verification (not installed Wallet/public evidence)

`go test -race ./internal/productsessionv2 ./internal/exchangeproduct ./apps/exchange/server -count=1`

PASS: shared adapter 1.817s, Exchange service 15.029s, executable server 1.444s. Existing original private-proof tests are included. Shared adapter tests cover original Finance ciphertext/pending/grant compatibility and production rejection of loopback authorities.

`TestBrowserSSOV10OwnedReadsAndDurableProductRevocation` uses actual TLS product endpoints and two isolated cookie jars, with explicitly simulated central/native authorities. It reads existing Alice 17 and Bob 31 YUSD_TEST balances, first concurrent same-approved-session reads, cross-user rejection, product logout, then actual Close/New on the same schema-10 state. Alice's linked read without a cookie remains 401 after restart; Bob's existing identity/session still reads the original 31 balance successfully. This is not a real Wallet signing or public cross-product receipt.

After restoring both existing lockfiles with `npm ci --ignore-scripts`, `node --test tests/cache-version-browser.test.mjs tests/private-account.test.mjs tests/wallet-sdk-consumer.test.mjs` passes 32/32, zero skipped (2.830s). The initial run failed to resolve absent local dependencies, not a product assertion. The browser case verifies actual Chromium cache invalidation, not central sign-in. `node web/verify-versioned-assets.mjs` passes the exact three page and three module asset hash bindings. No vendored SDK bytes were changed.

## Remaining acceptance

This checkpoint does not claim installed Wallet, public deployment, mobile/browser platform acceptance, native permission acquisition from the new identity UI, or full Exchange SSO E2E. The existing native request consumer still needs selected provider/full-route integration and transport/session restoration validation. Pair connection code and dependencies remain a separate draft. Quant is not modified. Subsequent runtime packaging must use the exact committed source and existing hash-bound packaging verifier; no dirty working-tree archive is a release receipt.
