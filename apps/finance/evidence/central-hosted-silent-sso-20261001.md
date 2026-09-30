# Central Hosted and bounded silent identity recovery

Source-only handoff. Installed Wallet, public approval, platform lifecycle and
public owned-service success remain NOT_VERIFIED by this local checkpoint.

## Contract and dependencies

The central chooser explicitly opens Wallet Web using the accepted generated
adapter from Wallet source 39c063da0c395e8fbfd18d9af20fb26ae5051310.
`packages/wallet-auth/src/vendor/hosted-wallet-adapter-39c063da.js` is exactly
12509 bytes, SHA256 fef4c040721b2759af7ca0928fe5363f3850bf59d66c425f724b3e79b00c11cc.
It permits the central issuer's identity/lifecycle methods only; EVM signing,
transactions and product-session permissions remain denied. The single native
identity RPC and canonical challenge/approval contract are unchanged. Connect
does not approve identity. Provider selection, cancellation and deadline fences
remain active. There is no automatic popup or provider fallback.

## Silent recovery

Finance, Exchange and Quant may make one bounded top-level `prompt=none`
identity attempt, preserving the original registered target. A valid central
root session issues the existing identity-only PKCE code; a guest returns
state-bound `login_required` without chooser, QR or signing. No native product
scope is issued or expanded. Interactive callbacks reject `login_required`.

Host-only Secure HttpOnly suppression cookies prevent product logout from
automatically signing in again (30 days), and bound a quiet attempt (60 seconds).
Only explicit product sign-in clears suppression. Product logout clears pending
callbacks and revokes that product's grants/codes, not other clients or the root.
Global logout remains a distinct server generation operation. Wrong/duplicate
state, expired code, replay and late logout callbacks remain rejected.

## Local verification

Commands run from repository root unless noted:

- `go test -race ./internal/productsessionv2 ./internal/finance ./internal/exchangeproduct ./internal/quantlab ./apps/quant-lab/server ./apps/exchange/server ./apps/finance/cmd/server -count=1`: all seven packages PASS.
- `npm test` and `npm run test:types` in packages/wallet-auth: 206 tests PASS plus types.
- `node --test tests/central-browser-signin-browser.test.mjs` in apps/finance: 3/3 PASS; real accepted adapter transport with isolated Wallet-page signing fixture, not released vault/public Wallet.
- `node --test --test-name-pattern=central-selected-login tests/local-product-session-cross-service.test.mjs` in apps/finance: 1/1 PASS; local Gateway/Go/browser owned API, category write and product logout reject-old-proof flow.
- `node --test tests/private-account.test.mjs tests/ui.test.mjs tests/cache-version-browser.test.mjs` in apps/exchange: 29/29 PASS.
- Quant browser identity/records/private/protocol/cache combination: 15/15 PASS; final rebuilt bundle identity/records subset 6/6 PASS.

The silent actual-TLS Finance/Gateway regression covers guest quiet return,
existing-root recovery, logout during pending recovery and global revoke. Shared
Go tests cover all three product cookie boundaries. Quant UI-only redirect
transport fixture uses a scripted navigation; actual 303/PKCE/HttpOnly authority
semantics are verified separately by the TLS Go regression.

## Activation boundary

Root's release owner owns runtime configuration/deployment. Existing durable
ProductSession/control/revocation state must not be reset. No source test here
renews, signs or activates endpoint authority. Use exact signed manifest dates,
not conversational expiry estimates. Finance scope approval and public owned
service must still be exercised with the real installed/Hosted Wallet and
separately recorded for each platform and product.
