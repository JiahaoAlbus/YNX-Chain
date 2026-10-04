# Exchange UI source candidate — 2026-10-04

Complete UI repair in the inherited Exchange source. This is an uncommitted source candidate for Finance's single Git checkpoint and A's compatible formal release; no public deployment or real Wallet/business completion is claimed.

Worktree: `/Users/huangjiahao/.codex/worktrees/exchange-sso-cookie-binding-20261002`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.
UI lease baseline: `093610c481abdaab1684b51f9e11d65be01cd3b0`.
Snapshot committed HEAD: `dbb589e8ca9fbd8bcc9ccb821c8f49cad597dd0d`.
Snapshot committed tree: `a372d37f80199f1e06cfddc6df1887dad2c1786f`.
The committed tree is not the dirty UI candidate tree: exact candidate bytes are recorded in `candidate-manifest.json` and the immutable archive.

## Delivered behavior

- Original 798×420 YNX logo remains byte-identical and renders at 23px desktop / 22px mobile with its original aspect ratio. Formal favicon is included.
- Wallet chooser retains the existing provider IDs and explicit handlers. Three 76–80px provider cards use the original YNX logo and the official MetaMask SVG. Native modal focus trap and Escape remain; backdrop close and guarded focus restoration are added without auth/SDK calls.
- Private status, approval link, retry, refresh and verified current account remain visible when applicable. Existing guest/revocation controls and scope, source and standard-wallet explanation are in a real expandable account manager. Browser identity, when enabled by the original app, retains its distinct original controls and status.
- All default buttons, focus/disabled/error states are styled. Desktop market/chart/book/order use a clear three-column workspace; mobile stacks panels and retains the four product navigation views. Source and order risk details remain accessible through disclosure controls. Unsupported actions keep original guards and fail-closed behavior.
- Existing 12-locale business catalog and RTL remain intact. Three new UI-only disclosure labels and close labels use known-locale lookup with English fallback. No original financial values, IDs, input nodes, event handlers, errors or disabled flags are replaced.

## Ownership / files

UI source written: `web/index.html`, `web/styles.css`, `web/ui-preferences.js`, `web/verify-versioned-assets.mjs`, `web/assets/metamask.svg`, `web/ynx-favicon.png`.
UI tests written: `tests/ui.test.mjs`, new `tests/ui-product-browser.test.mjs`, and one setup step in the existing revoke journey in `tests/locale-browser.test.mjs` to expand the new manager before clicking revoke.

UI owner did not write `app.js`, `wallet-connect.js`, `locale.js`, business/Go source, vendor, shared SDK/Auth/Host, registry, account keys or environment files. Finance owner separately repaired only app.js's existing four import query hashes. Its app.js working delta remains Finance-owned and must be checkpointed by that owner. No stage, commit, reset, restore or deployment was run by the UI owner.

## Validation

- Final source + UI browser tests: **17/17 passed** (`ui-final.log`: 13 original source tests + 4 dedicated browser tests).
- Existing 12-language renderer / private / Wallet / preview / revocation regression: **17/17 passed** (`locale-regression-final.log`). The earlier red log is retained and identifies the now-adapted revoke journey and corrected 44px mobile language control.
- Versioned asset verifier: **4 page assets + 4 modules passed**, with exact SHA256 query versions; no locale exemption or module-check bypass (`versioned-assets.log`). Read-only baseline mismatch retained in `baseline-version-errors.log`.
- 320px and 390px mobile plus 1440px enlarged desktop × all 12 locales × all 4 views: no document horizontal overflow; original status remains visible, details accessible, provider cards fit, Arabic RTL preserved, no non-GET requests during ordinary navigation.
- Native modal Tab/close/Escape/backdrop, trigger focus restoration and order draft preservation passed. Desktop standard typography retains three aligned panels. Formal logo dimensions and rendered aspect ratio passed.
- `node --check web/ui-preferences.js` and `git diff --check` passed.

Browser tests serve the actual source files locally with API routes deliberately unavailable. They do not invent prices, balances, candles, users or private authorization. ORIGIN_NOT_ALLOWED / market-unavailable screenshots are truthful source-test states, not production API outage evidence. Existing locale tests use already established isolated adapters to verify rendering semantics; they are not real Wallet approval/revocation proof.

## Exact release inputs for A

Archive: `exchange-web-ui-candidate.tgz` (17 web files, no node_modules, credentials or user data).
SHA256: `45ebcc32995af0f69581611e92b594fe4db4561bb9090919c7c188b8d244936e`.
File byte counts and hashes: `candidate-manifest.json`.
Owned source patch including new files: `owned-ui.delta.patch`.

YNX logo SHA256: `df071f540f21d54e92286fd709df5293187c269058850820adb11e7c5087c12d`.
Favicon SHA256: `5a6fb80c48a2047ad5632cf0b69f410ebaefd8aff0bb3da7dce28c1ce8c992c7`, copied from the original site-favicon-exchange-controls worktree Finance asset.
MetaMask SHA256: `163dd1be1558ee648c266f4a533b6e10d40b737f838bbe40739d9637017cd35f`, copied byte-for-byte from `social-wallet-chooser-20261001/apps/social/web/assets/metamask.svg` (not the older simplified f761… asset).

Before screenshot: `before-user-public-screenshot.png`.
Representative final after screenshots: `desktop-standard.png`, `wallet-desktop-standard.png`, `workspace-320.png`, `workspace-390.png`, `workspace-1440.png` (enlarged text), `wallet-320-ar.png` and all 36 wallet locale/width captures.

Remaining gates: Finance owner exact checkpoint; A's immutable source/release mapping, compatible staging/formal deployment and asset readback; public UI confirmation; installed/hosted/MetaMask real Wallet flows; approved private reads/current account/revocation; real protected business journey and human acceptance. This UI candidate does not broaden paused SDK/crypto or product scopes.

Latest Chinese review captures: `workspace-1440-zh-Hans.png`, `workspace-390-zh-Hans.png`, `wallet-1440-zh-Hans-final.png`, `wallet-390-zh-Hans-final.png`.
Runtime preparation failure history is retained in `tool-runtime-note.log` (system Python exit137; corrected with Node, no source reset).

FINAL FREEZE: UI owner has stopped all writes to the owned source/tests/evidence after this receipt. Finance may stage/commit only the 9 owned paths in `candidate-manifest.json` plus `apps/exchange/evidence/ui-product-20261004/**`; Finance's separately owned app.js import-version change must be included by Finance. The 13 static tests import the existing Wallet-auth reducer as before; they are engineering checks, not broad SDK certification. The 4 UI browser tests load the actual local app/locale/private/standard-Wallet bundles without any real provider or private API. Existing 17 locale tests exercise established controlled render adapters. No human account, Wallet signature, asset transfer, installed provider or public trading gate passed in this UI run.
