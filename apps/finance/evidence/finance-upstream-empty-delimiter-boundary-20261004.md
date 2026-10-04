# Finance upstream empty delimiter boundary

Owner predecessor `405ae5a92c1c48cf7a93009acb091d6ce9108d90`, tree `3f9bc2314533606b8824b02f7125d550b59100ab`. Root's independent narrow P2 review identified an additional base-URL acceptance defect after the preserved `9ecaf626` transport checkpoint.

Go URL parsing represents trailing `?` with `ForceQuery=true` and an empty RawQuery; trailing `#` loses its delimiter in the parsed Fragment. The old predicate only rejected nonempty query/fragment fields. Accepted original base values subsequently concatenate an owner route, incorrectly placing that route in the query/fragment rather than its intended path. This is a configuration acceptance/path availability bug, not evidence of an authorization bypass or credential disclosure.

`requireHTTPURL` now additionally rejects ForceQuery and any literal fragment delimiter in the original input. Encoded `%3F`/`%23` remain ordinary compatible path data. Fixed error wording does not echo configuration. No routing/signature/permission protocol, HTTP request, shared Wallet code or other product was changed.

Added Go regression coverage for both empty delimiters at root and path-prefixed bases through direct validation, Explorer/Pay constructors and the owner-source configuration path. Added compatibility cases for HTTPS root/trailing slash, HTTP loopback, path prefixes and encoded delimiter path data.

Validation performed: gofmt (syntax parse) and `git diff --check` PASS. **New focused Go tests and full Go race regression NOT EXECUTED**: Data volume remains 100% full with only about 193 MiB available; Root explicitly requires fresh resource budget before new link/compile/package. Neither the previous stripped focused PASS nor older full PASS is evidence for this successor. Once budget is authorized, run `go test -race ./internal/finance -run 'TestFinanceUpstream(RejectsCredentialBearingBaseURLs|CompatibleBaseURLPaths)$' -count=1`, then the necessary affected/full suite. This source checkpoint is pending executed Go validation, not a completed release.

No SSH, Host retry/upload/deploy, package rebuild, installer, real Wallet account/sign/transaction or production mutation. Historical source/package/failed test evidence preserved; report only to `接续测试网生态审计工作`.

## Executed closure after resource recovery (2026-10-04)

Reviewed source checkpoint `1482e768c701e22a23ea36c4c68facf4f4e40f9d`, tree `1cb98c035768ae51ea55b7a2a040126f6cba3d22`, was clean and synchronized with its owner remote before execution. The upstream implementation and regression introduced at `d2fe825d67d7e7c6b2f7c84ef14e93ce71903f0d` are inherited unchanged. The earlier NOT_EXECUTED statement and ENOSPC failures above remain historical facts, not overwritten results.

Following the coordinator's task-owned Native resource recovery, fresh Data availability was 840408 KiB. A unique tiny owner-directory write probe succeeded and was unlinked; no unknown material was deleted. The fresh 524288 KiB guard passed before the focused run. No TMP, egress or shared configuration was changed.

Actual commands and terminal results (not dry-run):

- `go test -race -p 1 -ldflags='-s -w' ./internal/finance -run 'TestFinanceUpstream(RejectsCredentialBearingBaseURLs|CompatibleBaseURLPaths)$' -count=1`: exit 0, internal/finance PASS 2.532s.
- Fresh availability before the full serial suite: 954780 KiB, guard PASS. `go test -race -p 1 -ldflags='-s -w' ./internal/finance/... ./apps/finance/cmd/... -count=1`: exit 0; internal/finance 13.373s, brokerage 1.431s, admin 1.494s, broker-tools 1.456s, broker-worker 1.572s, server 1.532s, all PASS.

This closes the outstanding executed Finance Go validation for the inherited URI boundary/transport source at this checkpoint. The already frozen 67c7/1482 caller and controlled browser tests were not redundantly rerun. No binary/archive or installer was rebuilt. Source tests do not prove formal Host activation, source-bound public runtime, installed flow, genuine Wallet approval/callback or Product Session lifecycle; those gates remain unproven. Quant aa6 versus public 664b source mismatch remains separate and unchanged. Publication and shared composition remain under their existing owner; no SSH/upload/retry/deploy was attempted.
