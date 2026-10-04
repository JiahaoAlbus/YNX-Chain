# Finance statement record identity — local browser evidence

Parent: 9d202f13dd62b1f76efb9609f2585a744b93d932. Branch: codex/exchange-sso-cookie-binding-20261002; worktree: exchange-sso-cookie-binding-20261002.

## Reproduced and corrected

The original statement controller accepted a row without a valid ID and displayed observedIncoming=1 and returnedRecords=1 (actual headless Chrome failure, 2566.688292ms total). It also accepted a duplicated record ID, counted the same 7-YNXT observation twice, and displayed observedIncoming=14, observedFees=2, returnedRecords=2 (separate actual Chrome red run, 1864.381917ms total). Matching arithmetic alone cannot establish distinct source observations.

Partial statement validation now requires every record ID to be a nonempty, unpadded string and unique within that response. Missing/duplicate/conflicting IDs fail the whole partial observation rather than silently dropping rows, inventing IDs or asserting a corrected total. Existing account/period/time/amount/BigInt equality and incomplete-coverage requirements remain. Direct render also performs the same observation validation before replacing DOM, including language/route re-render entry points. No backend schema/authority or financial rules changed.

Actual browser regression covers missing/null/numeric/empty/padded IDs, exact duplicate and conflicting-direction duplicate IDs, valid distinct records with identical amounts/timestamps, explicit fresh-read recovery and direct invalid re-render preserving the previous verified display. All-full-period totals remain unknown. Local fixtures are not real personal-account observations or public business acceptance.

## Executed gates

`node --test` for overview-source-browser, planning-source-browser, owned-read-controller, owned-save-controller, owned-ai-controller, ai-ordinary-browser, finance-12-locales: **41/41 PASS, 0 skip, 7783.360292ms**. Tests retain old-account/identity/period fences, export ABA, four planning-save receipts and unknown-outcome exact retry, AI controller cancellation/deletion ownership, ordinary actual Chrome overview/planning and all twelve locale copy checks. Network is blocked in the isolated view fixture; no account/proof/sign/write traffic is sent. This test scope is not a formal protected producer/main composition gate.

`node --check apps/finance/web/app.js`, `git diff --check`: PASS.

## Fresh public readback — old source, not this change

Public-only GETs, without account authorization, 2026-10-04T00:28:48–49Z:

- `https://finance.ynxweb4.com/version`: HTTP 200, application/json, 127B, SHA256 `92eee2e51b111513df0f3637bf257aad8ac1d532c96a2e3640f6b07e7b5abaa8`, commit `17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c`.
- `https://finance.ynxweb4.com/health`: HTTP 200, application/json, 544B, SHA256 `7e6f037a79c7dce4780437087e09c7e4227fa23797b84292d47371d6d6061476`.

No new public release, install, Wallet approval, Product Session, ComputerControl or personal business execution is proved. Formal main/profile/producer/asset graph and publishing remain the central release owner's responsibility. The ordinary app.js change needs a matching source assembly; do not overwrite old manifest hashes to manufacture a pass.

## Source dependency and rollback

Read-only inspection of inherited `internal/finance/upstream.go:109-132` shows the Explorer collection iterating transaction records into activity without an explicit duplicate-ID fence. No upstream or Finance authority change was made here. Central should inspect duplicate/missing-ID handling in the original source collection and statement/budget producer together; this frontend arithmetic boundary alone is not a claim that every producer rejects ambiguous source data.

Future approved rollback: revert only this checkpoint's owned frontend validation/direct test; retain earlier BigInt coverage and identity/export/consent fixes. No state/data deletion or destructive Git operations. Exact source, public mismatch and producer concern are reported only to 接续测试网生态审计工作. Overall financial goal remains incomplete and continues.
