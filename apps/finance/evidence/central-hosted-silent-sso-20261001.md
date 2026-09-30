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

## Immutable implementation and successor pin

Implementation commit 012e1ff68c52c3c1655032cd8bcff7781dc7926d, tree
14b48a61baad4751e3e2b1bcaa285a9e7c61c8f0. The successor candidate is
`evm-read-runtime-verifier-candidate-guoqing-hosted-012e1ff68-20261001.json`,
73830 bytes, SHA256 6eb01b4b7be4010546fcf13d9f1eff593477a5c4f5b4a338a70f7d913938db67.
It binds the full three-bundle dependency graph, including the accepted Hosted
vendor, with two independent builds per bundle. Active verifier manifest SHA256
50b313a71662b44d8ec9b998dddbd39b082a0b6a4704d66e055a427c08adecf3.
All previous immutable candidates remain unchanged.

Reproduce the strict gate from apps/finance:
`node --test tests/evm-read-verifier.test.mjs tests/wallet-bundle-verifier.test.mjs`
and `node web/verify-wallet-connect.mjs`. The successor adds an explicit Hosted
byte-tamper negative test; none of the prior graph/tamper tests are weakened.

## Existing Finance service use follow-up

The same local `central-selected-login` command now also exercises the actual
budget form: create a category, create a monthly budget of 123 YNXT, and read
the account-owned persisted profile. The statement form returns the same native
account and `finance-statement-v2`, renders the result, and explicitly keeps
`coverageComplete=false` for unavailable upstream history. A real page reload
restores the same private session ID and both stored planning records without
a second Wallet approval. The later 503 recovery and product-only logout
reject-old-proof checks still pass. Final result: 1/1 PASS, no skips, 15.334s.
This is local Gateway/Go/Chromium QA with isolated approval keys, not a public
Wallet or a verified asset balance/history claim.

Hosted central identity remains separate from product native authorization.
Correction to the initial follow-up diagnosis: the accepted Wallet handler and
adapter already support `ynx_requestProductSessionV2` for exact registered
product origins. Only the central issuer is identity/lifecycle restricted.
Finance's injected-only consumer gate was the native authorization defect;
there was no missing product signing handler. The successor consumer uses the
exact official SDK route URL, strict `{version:2,returnUrl}`, controller
generation and account/chain/provider/revision fencing, then the original
`handleReturn` and protected-API proofs. Central identity never substitutes for
product scopes or converts an EVM address into a native approval.

A read-only public check during this follow-up still reported Finance source
567ee5164db630872102cd25ef78069e0fbc0dce, not this candidate. Its app.js was
78926 bytes/SHA256 9f78360c39b9cbb9f5b9217c25e638cfb1d9430b7c7db051365098f12b28f2c2;
wallet-auth.js was 209482 bytes/SHA256
19a4f68e6be82621eba95b73fae4cf5748d2ab30723d19b7736a5dd2e5a87de7.
Therefore this follow-up does not issue a new current-public-source-accepted
receipt for the unobserved candidate. Release readback and real user service
evidence remain the separate owner's next steps.
