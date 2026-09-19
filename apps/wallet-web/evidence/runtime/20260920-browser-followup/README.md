# Firefox provider and Chrome loading diagnostics — 2026-09-20

No product source, manifest, artifact bytes, installed browser profile, signing or deployment changed. This follows PR #139's previous fixture repair. The previous Firefox gap is now covered with the existing branded Firefox 140 binary and the exact existing Firefox ZIP. HTTP positive action remains unproved.

## Firefox 140 — PASS

`firefox-final/result.json` and `firefox-final/geckodriver.log` record the final run. Mozilla Firefox reported version **140.0**, build **20250616215311**, using the existing `/tmp/ynx-firefox-install.Lkf88L/Firefox.app/Contents/MacOS/firefox` binary. The initial successful run remains in `firefox/`.

Exact ZIP: 545809 bytes, SHA256 **51609d80ac6c4e09b441d4c3ad7afbd675e2623e8484395b5773cee036763528**, embedded source **6e502c3a2d7feb2b4cfc0290c8539b9b08a5faf1**. The same read buffer is written to the temporary ZIP and installed via Mozilla's supported `/moz/addon/install` endpoint with `temporary:true`; `dist/firefox` is not used.

- First launch: exactly one independent `com.ynx.wallet` EIP-6963 announcement, `eth_chainId=0x1917`, YNX true/MetaMask false. The foreign frozen provider array remains unchanged.
- HTTP without browser action: zero YNX announcements. No toolbar action, shortcut, injected grant or account request was attempted.
- Same-profile browser restart before addon reload: zero announcements; the controlled DApp marker remains, proving it is the same browser profile and the temporary extension did not persist.
- Explicit reload of the same ZIP: announcement, chain ID and frozen-provider coexistence pass again.
- Both Firefox processes shut down and cleanup records no surviving owned browser PIDs.

The local HTTPS fixture uses a temporary self-signed certificate and WebDriver `acceptInsecureCerts:true` in its disposable profile. This is not production TLS or installation acceptance. Accounts, signatures, transactions, HTTP positive injection, persistent installation and deployment remain false.

Driver: official Mozilla **geckodriver 0.36.0**, downloaded to `/tmp/ynx-geckodriver-0.36.0-wallet-acceptance`. `driver-provenance.json` records source URL, byte count and observed hashes. No system installation or repository dependency change. Mozilla documents standalone WebDriver use at https://firefox-source-docs.mozilla.org/testing/geckodriver/Usage.html and its addon endpoint at https://github.com/mozilla/geckodriver/releases/tag/v0.36.0.

## Chrome 153 — automation loading boundary, NOT PASS

`chrome.stdout.json`, `chrome.stderr.log` and `chrome/` contain one bounded diagnostic run. Chrome **153.0.8010.50** launched and exited normally. Its own stderr says:

> --disable-extensions-except is not allowed in Google Chrome, ignoring.

The exact Chromium ZIP is unchanged from the prior slice. Diagnostics prove its extracted manifest exists, declares a module `service-worker.js`, and that worker has 35078 bytes / SHA256 `ffb02a0913f77e37e4849d144589e73b7b9d6038e7c3c2deced09b61b9d16a9f`. Browser service-worker registrations and versions are empty, no worker error was emitted, no extension target exists, and the isolated profile extension registry is empty. Full launch arguments are in Playwright's browser stderr log. `Browser.getBrowserCommandLine` itself declined because `--enable-automation` was not set; this is recorded instead of changing browser controls to obtain it.

These observations identify a branded automation loading boundary, not a wallet worker execution failure. No attempt was made to circumvent the rejected flag or browser restriction. Real Chrome manual loading/use remains unproved. HTTP positive remains manual-required.

Edge **153.0.4234.32** still passes the exact-ZIP HTTPS/provider/preferences restart gate with the added diagnostics (`edge.stdout.json`), isolating the Chrome startup limitation from the package's behavior on a supported automation runtime.

## Tests and reproducible commands

Focused **13/13**, full Wallet Web **354/354**. Added negative gate cases for missing first/second launch, duplicate announcement, wrong chain, RPC error, mutated foreign provider, unexpected persistent addon, changed profile, unauthorized HTTP announcement and mismatched addon ID. Source and manifests remain untouched.

From `apps/wallet-web` with its existing installed dependencies and the previously documented isolated shared-dependency resolver:

```sh
node --test test/runtime-firefox-provider.test.js test/runtime-evidence.test.js test/runtime-extension-gates.test.js test/runtime-harness.test.js
npm test
YNX_FIREFOX_BRANDED_BINARY=/tmp/ynx-firefox-install.Lkf88L/Firefox.app/Contents/MacOS/firefox YNX_GECKODRIVER_BINARY=/tmp/ynx-geckodriver-0.36.0-wallet-acceptance/geckodriver YNX_WALLET_WEB_EVIDENCE_DIR=evidence/runtime/20260920-browser-followup/firefox-final node scripts/runtime-firefox-provider.mjs
DEBUG=pw:browser YNX_BROWSER=chrome YNX_WALLET_WEB_WRITE_EVIDENCE=1 YNX_WALLET_WEB_EVIDENCE_DIR=evidence/runtime/20260920-browser-followup/chrome node scripts/runtime-branded.mjs
DEBUG=pw:browser YNX_BROWSER=edge YNX_WALLET_WEB_WRITE_EVIDENCE=1 YNX_WALLET_WEB_EVIDENCE_DIR=evidence/runtime/20260920-browser-followup/edge node scripts/runtime-branded.mjs
```

All stdout/stderr, exits, exact browser capabilities, profile paths and cleanup results are retained beside this file. Temporary profile paths are recorded for correlation and were removed after execution.
