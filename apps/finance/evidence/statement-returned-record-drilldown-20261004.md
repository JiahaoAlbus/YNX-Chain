# Finance returned statement records

Source checkpoint: `1637555d2690b442126e3120ce1a57b91211cb0e`.
Source tree: `2aab9e2d5d3ac4b8e2976300b0a90f079e89767e`.
Branch: `codex/exchange-sso-cookie-binding-20261002`.

The existing statement view reconciled the returned observations but exposed
only totals/count. It now exposes each verified returned record's direction,
amount, fee, timestamp and expandable full reference using the existing
activity renderer. Unknown calculation status does not display reconciled
records. Full-period totals remain unknown; no complete history is inferred.

Explorer navigation uses only the statement's own available source metadata,
indexed-transaction source and hash format, with the existing HTTPS origin
validator. The latest overview's source authority is never borrowed. Missing
source metadata still permits reading exact references without invented links.
Types/references are escaped. Existing private-view retirement clears the
records and statement snapshot. No new endpoint or mutation was introduced.

## Executed local checks

- `node --test apps/finance/tests/overview-source-browser.test.mjs apps/finance/tests/owned-read-controller.test.mjs apps/finance/tests/owned-save-browser.test.mjs`: 31 pass, 0 fail, 0 skip, 25241.994292 ms.
- After adding mobile/private-clear assertions, `node --test apps/finance/tests/overview-source-browser.test.mjs`: 8 pass, 0 fail, 0 skip, 11898.142791 ms.
- `node --check apps/finance/web/app.js` and `git diff --check`: pass.
- Real local Chromium: exact incoming/outgoing/fee/reference checks; source-bound link vs missing metadata; HTML injection escaped; 12 locale labels; expanded full reference at 390px without horizontal overflow; unknown/empty observations; actual private-clear function removes record links/references and state.
- Retained controller tests: delayed old account/period/identity responses, export single-flight/ABA and date/owner binding.

Initial combined run: 30 pass/1 fail because the test fixture's lexical
translation function returned keys. Fixed the fixture to read the real locale
module; no amount, coverage or isolation assertion was weakened.

## Immutable source objects

- `apps/finance/web/app.js`: blob `f131703375367b1a9bf63498c536e445b0ad415c`; SHA256 `e0a1b57a3bec5e3cfe432f6693cd0de5f4a086db56f5d907c0c89959af1d7be4`.
- `apps/finance/tests/overview-source-browser.test.mjs`: blob `18b456d517459ea4310dadb2eaa0f92e47ca4df7`; SHA256 `695e7847f5488b616bed53fd4e7e22a5f4cb8697be037b05ecaa671535a1a588`.

## Delivery boundaries

This is owned Finance UI/local browser evidence only. No shared authority,
producer/profile reader, formal pin, vendor bundle, Host or other product path
changed. No production deployment, installer, real account approval, signature,
order, transaction, canonical Product Session or Mac Computer Control is proved.
Formal assembly/public rollout still requires A wallet_release_owner matching
the latest owned input. Report this dependency to 接续测试网生态审计工作,
not the superseded audit chat. The source change remains reversible via a
reviewed ordinary Git revert; no production rollback was attempted.
