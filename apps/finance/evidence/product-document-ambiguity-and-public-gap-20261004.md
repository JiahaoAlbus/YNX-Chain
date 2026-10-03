# Finance product-document integrity and current public gap

Predecessor: afbb2d3643ce82c7cc83f45bc7d6a8e1c356c209. Changes are ordinary product document parsing/tests only, not Wallet/SSO/Finance authority, formal bundles or Host.

## Implemented and verified

New regression failed before the fix: duplicate balance fields were silently materialized using the last value. Product JSON now scans decoded object keys before materialization, rejects duplicates (including escaped aliases), rejects depth over 64 and trailing/malformed documents. Existing UTF8, byte ceiling, timeout, retirement, export and exact-empty cancellation acknowledgement contracts remain intact. Separate objects may legitimately reuse a field name; quoted Unicode strings and ordinary nested data remain compatible. CSV is not parsed as JSON. This parser does not handle or replace Wallet/SSO authority messages.

Real installed Chrome with controlled native streamed responses refuses conflicting balances, then accepts a fresh unambiguous response on an explicit next read without changing the controlled Standard state. This is transport QA, not installed Wallet/provider/private authorization evidence.

Final eight-group ordinary Finance regression: 60/60 PASS, 41.395 seconds. Product/test JavaScript syntax and git diff whitespace checks PASS. No source change was made during the final run.

## Login-suite diagnostic

The isolated historical evm-read-browser test `main Finance login reads owned workspace and handles account-change` fails after 31.010 seconds waiting to click #wallet-login-verify: the old verification button exists but is not visible in that test's current page route. The test never reaches its account/signature path. This proves a stale/incomplete full-page test journey, not that current authorization succeeded or failed. The accepted current entry journey and authority fixture must be integrated with its owner; do not force-click the hidden control, restore retired EVM capabilities or bypass the current identity contract to make this old test green.

## Fresh direct public guest observation

Observed 2026-10-03T19:59:43.544Z. `node apps/finance/scripts/verify-public-guest.mjs` exit 0, stderr 0 bytes. Raw non-sensitive local report /tmp/ynx-finance-public-guest-20261004-latest.json SHA256 a305b6af7a9c336cfe3c0438cd23f2106a01442aab6c3df2f855add38358acfe.

| Resource | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| https://finance.ynxweb4.com/version | 200 | 127 | 92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8 |
| https://finance.ynxweb4.com/health | 200 | 544 | 7e6f037a79c7dce4780437087e09c7e4227fa23797b84292d47371d6d6061476 |
| /app.js?v=6038c02a3e20d144f8f887d9f8cff9d4c91ae6541342496f9a8e0e0a0925e390 | 200 | 94133 | 6038c02a3e20d144f8f887d9f8cff9d4c91ae6541342496f9a8e0e0a0925e390 |

Public version: commit 17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c, release root3-lifecycle-17d2d6dd0, buildTime 2026-10-03T01:40:39Z. Script query SHA equals fetched bytes. Owner candidate app: 120158 bytes, SHA256 f89da378f202aa33b742302e6929e7f05fc1550e67d02de69d4558eaf16d878c; not public-byte identical. Distinct authority graphs alone are not a regression verdict. Public source still lacks ordinary receipt-availability guard, planning-row guard and translated reminder-cycle markers, as in the earlier direct inspection.

Actual public URL https://finance.ynxweb4.com/#overview, title YNX Finance. Default English, all twelve language choices set exact language/RTL, English restored and reload verified. One tab, unchanged URL, no uncaught page errors or blocked write requests. No connect/account approval/signature/transaction/private write was requested. This owner performed zero production mutations.

## Required continuation

Route ordinary fixes and the stale test journey to 接续测试网生态审计工作. Its unique release owner must incorporate ordinary changes into the current coherent authority graph, build/publish and return exact public source/rollback identity. Do not deploy this entire inherited checkout or overwrite shared bundles. Current-source public, installed release, provider approval, Product Session, real owned persistence and real financial operations remain unverified; the long-term goal is not complete.
