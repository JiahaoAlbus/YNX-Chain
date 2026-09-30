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
