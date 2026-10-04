# Schedule configuration acknowledgement preserves current runtime

Baseline: `96540989c099a30b4386e72c14c9d685da17ea26`, owner branch `codex/exchange-sso-cookie-binding-20261002`.

The original service preserves an identical enabled schedule configuration even when its worker has already claimed/completed/failed the current run. The actual app handler incorrectly required `running=false,lastRunStatus=scheduled` on every start acknowledgement. A valid bound response became an unconfirmed write, disabling ordinary stop/recovery controls.

Only the ordinary Quant app handler and its direct tests changed. Acknowledgement still requires exact saved strategy ID/hash/Stage, enabled flag, 60-second interval and every submitted cost/seed/window assumption. Accepted enabled statuses are scheduled/running/completed/failed_invalid_or_cancelled_configuration/failed_market_data_unavailable, with running true only for running. Stop still requires stopped_by_user and running false. Unknown, contradictory, cancelled/stopped-enabled, foreign identity and mismatched assumptions remain unconfirmed. No retry, account proof, execution, SDK or server protocol was added.

## Executed verification

- Initial fixture preparation failed because the harness defaults to cancelled confirmation; corrected the fixture to perform explicit controlled confirmation. This was a test setup error, not product evidence.
- Corrected pre-fix RED: focused 3 tests, 2 pass/1 fail, 88.538333ms. `running` receipt retained `scheduleUnconfirmed=1` instead of 0.
- `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/records.test.mjs apps/quant-lab/tests/research-recovery-browser.test.mjs`: 105 pass, 0 fail/skip, 16639.073458ms. New matrix covers four accepted runtime states during a failed follow-up read and five contradictory states. Existing identity/cost mismatch, duplicate request, stale snapshot, cancellation and localization tests remain passing.
- `go test -race ./internal/quantlab`: PASS 4.884s. No PostgreSQL URL was supplied for this run; do not claim a new PostgreSQL run.
- `node --check apps/quant-lab/web/app.js`, `git diff --check`: PASS.

Original Go/two-Chromium-context controlled-tape recovery test retained evidence under `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-aR4v7d`: two isolated contexts, four clean SIGTERM stops. QA binary 11516786 bytes, SHA256 `59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a`. Screenshots are local controlled recovery evidence, not proof of the new schedule matrix or public provider approval.

## Release boundaries

Source/local regression only. Public release, canonical private main/SDK consumption, real wallet approval/signature/transaction, native installation, production signing and ComputerControl acceptance remain NOT_VERIFIED. Formal assembly/build/deployment remains with the existing release owner. No shared paths, production mutation or real financial operation occurred.
