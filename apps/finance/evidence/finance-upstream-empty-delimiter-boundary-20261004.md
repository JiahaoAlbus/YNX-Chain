# Finance upstream empty delimiter boundary

Owner predecessor `405ae5a92c1c48cf7a93009acb091d6ce9108d90`, tree `3f9bc2314533606b8824b02f7125d550b59100ab`. Root's independent narrow P2 review identified an additional base-URL acceptance defect after the preserved `9ecaf626` transport checkpoint.

Go URL parsing represents trailing `?` with `ForceQuery=true` and an empty RawQuery; trailing `#` loses its delimiter in the parsed Fragment. The old predicate only rejected nonempty query/fragment fields. Accepted original base values subsequently concatenate an owner route, incorrectly placing that route in the query/fragment rather than its intended path. This is a configuration acceptance/path availability bug, not evidence of an authorization bypass or credential disclosure.

`requireHTTPURL` now additionally rejects ForceQuery and any literal fragment delimiter in the original input. Encoded `%3F`/`%23` remain ordinary compatible path data. Fixed error wording does not echo configuration. No routing/signature/permission protocol, HTTP request, shared Wallet code or other product was changed.

Added Go regression coverage for both empty delimiters at root and path-prefixed bases through direct validation, Explorer/Pay constructors and the owner-source configuration path. Added compatibility cases for HTTPS root/trailing slash, HTTP loopback, path prefixes and encoded delimiter path data.

Validation performed: gofmt (syntax parse) and `git diff --check` PASS. **New focused Go tests and full Go race regression NOT EXECUTED**: Data volume remains 100% full with only about 193 MiB available; Root explicitly requires fresh resource budget before new link/compile/package. Neither the previous stripped focused PASS nor older full PASS is evidence for this successor. Once budget is authorized, run `go test -race ./internal/finance -run 'TestFinanceUpstream(RejectsCredentialBearingBaseURLs|CompatibleBaseURLPaths)$' -count=1`, then the necessary affected/full suite. This source checkpoint is pending executed Go validation, not a completed release.

No SSH, Host retry/upload/deploy, package rebuild, installer, real Wallet account/sign/transaction or production mutation. Historical source/package/failed test evidence preserved; report only to `接续测试网生态审计工作`.
