# Ordinary Finance receipt/support navigation

Predecessor `3ee80e73f809ed4b1cb1c61276e12efacf9664b2`.

Receipt dispute and support renderers previously escaped HTML characters but
accepted executable URL schemes. They now share an ordinary navigation guard:
only explicit HTTPS URLs or single-slash site paths, no credentials, protocol
relative URLs, backslash, whitespace/control characters or malformed URL.
Invalid receipt links are not clickable; the receipt remains visible. Invalid
support cards retain the localized title and existing unavailable label rather
than a fabricated fallback. This is protocol safety, not proof of external
destination ownership or authority. No Wallet/Auth, grant or payment change.

Local execution:

```
node --check apps/finance/web/app.js
node --test apps/finance/tests/owned-navigation-browser.test.mjs apps/finance/tests/owned-save-browser.test.mjs
git diff --check
```

9 PASS / 0 FAIL / 0 SKIP, 36495.13375 ms. Actual installed Chrome runs production
renderer functions with controlled receipt/support data; rejects executable,
HTTP, credentials, malformed and ambiguous URLs; preserves normal HTTPS/site
links, account records, page URL and single tab. Existing actual form-save,
export, privacy, idempotency and account-switch fixtures also passed. No real
account, signature, transaction or public installed acceptance was performed.

Only ordinary app.js hunks and this test/evidence should be integrated by the
release owner into the current Finance formal graph. Never publish this whole
older Finance checkout or replace its authority/vendor modules. Asset graph,
build/publication, exact public source readback and normal authenticated user
acceptance remain required. No production or database changes; rollback is an
ordinary source successor limited to these renderer hunks.
