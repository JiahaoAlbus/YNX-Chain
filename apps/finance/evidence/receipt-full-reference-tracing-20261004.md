# Finance receipt full-reference tracing

Source commit `78ccbffa598970061d492d150852c9848bd33656`;
tree `5e34cbcc08b1b1ed102464f90c28d4fa89b88e95`;
branch `codex/exchange-sso-cookie-binding-20261002`.

Existing Finance Pay receipt summaries exposed only a shortened transaction
reference. The owned Finance renderer now exposes the exact receipt ID and,
when different and present, the exact transaction reference in expandable
read-only details. No transaction URL is guessed. Identical/missing/invalid
hash values do not create duplicate references. Existing safe dispute URLs,
bounded recent-five behavior and strict integer amount formatting are retained.
Receipt source unavailability and replacement with an empty owned snapshot
remove previous references. This change does not implement or modify Pay.

## Executed checks

`node --test apps/finance/tests/overview-source-browser.test.mjs apps/finance/tests/owned-navigation-browser.test.mjs apps/finance/tests/planning-source-browser.test.mjs apps/finance/tests/ordinary-renderer-integration.test.mjs`

Result: **16 pass, 0 fail, 0 skip**, 10714.809875 ms.

Actual local Chromium checked exact distinct IDs/hashes, valid zero amount,
unknown missing amount, malicious HTML as escaped text, no invented links,
390px expanded-reference layout, hash fallback/deduplication, unavailable source
and empty-snapshot clearing. Retained tests also exercised statement reconciliation,
all twelve locale planning labels, unsafe navigation and the previously frozen
ordinary integration capsule against its original source. That capsule was not
regenerated and does not yet contain this new receipt change.

The first run exposed a missing helper in isolated sliced-renderer fixtures
(11 pass, 2 fail). Kept the receipt reference helper local to its renderer,
preserving independent owned renderer composition; reran the complete set above.
No test assertions were relaxed. Syntax and `git diff --check` passed.

## Source identity

- app.js blob `b77547b1441be1995cacb9717af886c25993caf2`, SHA256 `6df8b0ac474e3f7f67aaea57c39a3d5f3357de0cdcde7b930b6a185216a9d06f`.
- overview-source-browser.test.mjs blob `5e56cbb262b94b5f7c9e5b020ed67089cdd115ca`, SHA256 `63004e2d15ac373990589d78d8c11f66de98c9e39e54875ad435c7e2229d5bc9`.

## Remaining delivery boundary

Owned ordinary source/local browser only: no public deploy, installer, real
Wallet approval, signing, order, transfer, canonical Product Session or Mac
Computer Control proof. No shared authority/protected reader/formal pin/vendor/
Host or other product paths changed. A wallet_release_owner must match this
new renderer input alongside statement source `1637555d` for formal delivery.
Report that concrete integration need only to 接续测试网生态审计工作.
Rollback of this ordinary source is an explicitly reviewed Git revert; no
production rollback or remote mutation was performed.
