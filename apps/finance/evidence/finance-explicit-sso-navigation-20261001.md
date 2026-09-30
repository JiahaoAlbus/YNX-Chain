# Finance explicit browser sign-in navigation

This source fix gives a user's explicit sign-in click priority over pending
quiet identity restoration. It does not approve an identity or product scope.

Reproduction: actual Finance Go `/api/sso/config` response number two is held,
then the visible browser sign-in anchor starts the real `/sso/start` request.
While that document request is in flight, the config body is released. The old
app emitted an additional `prompt=none` document request and failed the exact
zero-overrides assertion (1 versus 0). The fixed app marks explicit page intent
and increments the existing recheck revision before following the anchor.
Quiet restoration checks that intent both before and after its bounded fetch.
Subsequent focus/recheck cannot silently replace that user intent either.

The isolated Chromium fixture preserves both registered HTTPS origins, every
redirect hop and individual Secure/HttpOnly Set-Cookie headers through CDP.
Responses are actual Go/NodeHost responses, not successful identity mocks.
There is no provider approval, central complete/token call, or native grant.
It also covers completed quiet guest recovery followed by immediate explicit
sign-in: the chooser is present and the real authorize response is 200.

Verification:

```sh
node --test --test-name-pattern='explicit Finance browser sign-in|every Finance browser dependency' apps/finance/tests/local-product-session-cross-service.test.mjs apps/finance/tests/versioned-assets-browser.test.mjs
go test -race ./internal/finance ./internal/productsessionv2 -run 'TestCentralBrowserSilentRecoveryActualGatewayAndLogoutRace|TestBrowserSSOSilentGuestAndLogoutSuppressionAreBounded' -count=1
```

Result: Chromium/cache 3/3 PASS, zero skipped (4.665s); Go race Finance 1.927s,
shared helper 1.340s PASS. `index.html` binds the new app's exact SHA256
6811107c1942cda53445954b523744630e85843cf29842e889920d3bf3d06ab3.

Root's 019 public immediate trace separately observed explicit navigation
being replaced by quiet navigation. This local regression is not a retest of
the public release. An older isolated central HTTP400 has no established typed
root cause and is not claimed fixed here. Public approved identity and owned
business services remain NOT_VERIFIED for this successor until release QA.
The existing PKCE, origin, cookie, replay, expiry and product logout suppression
rules are unchanged. Quant Paper backend draft is excluded from this checkpoint.

## Immutable successor candidate

Implementation commit 3d2fe39c90b50d13345cc323489ef18c4e442999,
tree cc24a725af7a4b4be0324c81ac96f04b20cf66d9. Candidate
`evm-read-runtime-verifier-candidate-explicit-sso-3d2fe39c-20261001.json`:
74031 bytes, SHA256 07fccaad95a8cd385d5420ac0698e8d4cdd04bf7d23e8472b97e4508b8d7eac8.
Manifest SHA256 627a8286445d1b045603df96afe2bac75cf7daa9d8e44eabe2be09cf66b9bc38.
Wallet bundle unchanged: 211324 bytes,
fe50d473914ee5f56590865f270cd6d09b09e328a840ac40a362cfa81c638190.
The prior d334 candidate is preserved as immutable historical evidence.

```sh
node apps/finance/scripts/build-guoqing-account-session-candidate.mjs 3d2fe39c90b50d13345cc323489ef18c4e442999 apps/finance/evidence/evm-read-runtime-verifier-candidate-explicit-sso-3d2fe39c-20261001.json
node apps/finance/scripts/build-guoqing-transport-manifest.mjs ../evidence/evm-read-runtime-verifier-candidate-explicit-sso-3d2fe39c-20261001.json 07fccaad95a8cd385d5420ac0698e8d4cdd04bf7d23e8472b97e4508b8d7eac8
node --test apps/finance/tests/evm-read-verifier.test.mjs apps/finance/tests/wallet-bundle-verifier.test.mjs
node apps/finance/web/verify-wallet-connect.mjs
```

Result: strict graph/tamper/rebuild tests 23/23 PASS, zero skipped (1.406s);
direct Wallet verifier PASS. Generators accept an exact successor commit/path
and reviewed candidate SHA, retain historical defaults, reject invalid arguments
and never overwrite an existing candidate with different bytes. No build or
verifier exception is introduced for this navigation fix. Deploy source and pin
successors together; the unique release owner performs runtime/public QA.
