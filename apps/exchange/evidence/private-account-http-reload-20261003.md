# Exchange owned HTTP/browser reload verification

Baseline: `3b6ce23903e231112d6ea44592ff03c7dd173e63` on
`codex/exchange-sso-cookie-binding-20261002`.

Executed the previously opt-in-only Chromium/Go boundary test, then extended
that same actual browser test with a real page reload and a freshly created
shipped private-account controller. No product authority or shared SDK changed.

## Direct observations

- Chrome forwards the host-only HttpOnly browser cookie to the isolated owned Go API.
- Alice reads 17,000,000 and Bob reads 31,000,000 YUSD_TEST micro-units.
- Mismatched browser identity/native subject is denied, not mapped to another account.
- Reload retains Bob's cookie; default Alice native subject remains denied.
- Selecting the matching Bob fixture restores exactly Bob's prior account/balance,
  without another signin or approval operation.
- Global browser logout denies the previously linked account read.
- The independent native fixture, without browser identity, retains its existing
  approved read channel; browser logout is not a fabricated global native revocation.

## Commands and results

```sh
YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test --test-name-pattern='actual Chromium controller forwards' apps/exchange/tests/private-account.test.mjs
YNX_EXCHANGE_CONTROLLER_HTTP_QA=1 node --test apps/exchange/tests/private-account.test.mjs
node --check apps/exchange/tests/private-account.test.mjs
git diff --check
```

Initial boundary test: 1/1 PASS, no skips, 4,711.888375ms.
Extended full private-account cohort: 26/26 PASS, no skips, 6,153.63925ms;
actual Chromium/Go test: 6,002.426583ms. Syntax and diff checks PASS.

## Evidence boundary

The Go service is an `httptest` loopback server with disposable test state and
simulated authority responses. Chrome's declared Exchange domain is intercepted
through CDP and forwarded only to that local test server. It is not a request to
the public Exchange runtime. No real account authorization, key, signature,
capital order, deployment or installed Wallet action occurred. Public source
binding, real Wallet lifecycle, native installation and full product acceptance
remain unproved by this test. Formal release remains the unique release owner's
responsibility.
