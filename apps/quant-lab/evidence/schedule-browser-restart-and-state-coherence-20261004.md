# Actual saved-schedule UI, restart and tenant isolation

Baseline `c3a55590d40253496186e3341738f2ffe309d1d4`, existing branch `codex/exchange-sso-cookie-binding-20261002`.

Extended the existing original Go/two-Chromium research recovery test, rather than inventing a schedule server or injecting persisted runtime/clock/tenant identity. The normal Strategies button now has actual controlled-browser coverage for cancel (zero PUT), confirmed start (one PUT, exact 60s and fee 29), persisted enabled state through full SIGTERM/restart/reload, confirmed stop (second PUT), then stopped_by_user/disabled/nonrunning/zero due-time through another full restart. Reload and refresh do not add schedule writes. The other independently generated browser tenant remains unscheduled; Paper and research data isolation/recovery tests remain intact. This verifies configuration and explicit stop persistence, not an autonomous due-time run or capital execution.

The same investigation found that snapshot rendering accepted contradictory runtime flags even after submit acknowledgements had been tightened. The source now shares one enabled-state predicate between snapshot observation and configuration acknowledgements. Only running status can be running; enabled schedules cannot claim stopped/cancelled status; disabled schedules permit initial inactive, stopped_by_user, stopped_stage_advanced and cancelled_before_execution only. Non-string status fails closed. Contradictory observations render Schedule unverified and cannot start/stop via forged DOM click; existing valid initialization, stage advancement and language/status behavior remain covered.

## Executed evidence

- Expanded original Go/Chromium journey before coherence fix: 1 PASS, 14029.285792ms, retained local QA root `ynx-quant-research-recovery-N2QC6r`.
- New actual production-app controller RED: contradictory scheduled observation (`enabled=true,running=false,status=running`) rendered Run claimed and active Stop schedule instead of Schedule unverified; 1 FAIL, 162.03525ms. Failure retained here, not replaced with a green-only claim.
- Final original business-flow/records/research-recovery-browser suites: 106 PASS, 0 FAIL/SKIP, 20192.52825ms.
- Original scheduled/scheduler Go tests with race detector, count=3: PASS 3.471s. No PostgreSQL URL supplied; PostgreSQL tests are not newly claimed.
- Node syntax and git diff whitespace checks: PASS.

Final controlled actual Go/Chromium artifacts: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-GcH64A`, two browser contexts and four clean SIGTERM stops. QA binary 11516786B SHA256 `59c960666ac41a254e27eb6d6a9d1626ff19450f181627a7ca4f737236dade9a`. Existing unavailable/recovered screenshots remain respectively 208242B SHA `60d29d03efe7f8edc222c9d13c070af1a6f46734d51cf8c5b3de6a76edd0891f` and 191614B SHA `ddfb02ecc53cda3d91b28811bfc4e52bc7c4709c9d2416e892754734caaaf489`; these screenshots are workspace-recovery evidence, not schedule execution or real Wallet approval.

## Boundaries

Ordinary Quant UI/direct tests only; backend/protocol/schema/signing/permissions unchanged. Controlled loopback tape and preview tenant are not canonical Product Session, public source binding, real account, strategy mandate, testnet transaction, installer or ComputerControl acceptance. Formal matching assembly/release remains with its existing owner; whole financial goal remains incomplete.
