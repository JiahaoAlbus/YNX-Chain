# Nym search comparator (opt-in diagnostics)

This is a standalone macOS diagnostic using an independently admitted Google Chrome and a caller-managed local SOCKS relay. It is not the YNX Browser, does not start or authenticate a Nym client, and does not prove routing privacy, WebKit isolation, a kill switch, or installed-app acceptance. The caller must independently establish and own the exact intended upstream SOCKS session and bind its lifecycle before a live run; a listening port by itself is not proof of Nym. Do not use accounts or sensitive information in the test.

The fixture test uses local synthetic SOCKS and HTTP servers. It requires Node.js, an existing Google Chrome installation, and an owner-only scratch directory on a mounted volume. For example:

```sh
NYM_CHROME_TEST_ROOT=/Volumes/your-private-qa-dir node --test apps/browser/privacy-routing/nym/qa-glue/test_nym_chrome_search_comparator.mjs
```

The live command is deliberately not wired into CI. It requires a pre-established controlled route, an independently checked Chrome executable SHA-256, and a short-lived private output directory. It stops on a challenge or unverified response; do not bypass a website challenge or treat a 202 response as search results.
