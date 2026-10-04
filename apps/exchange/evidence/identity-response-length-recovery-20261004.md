# Exchange identity response and regression recovery

Scope: Exchange owned Web identity consumer and tests only. No shared Wallet/Auth change, Host operation, account approval, signature or transaction.

Inherited source: `218afc4562207bb28767ca544c5414bd4e8b4f04`.

The new real-consumer regressions first failed: a declared identity body length mismatch was accepted; an excess stream was read 131073 times instead of cancelling after its first excess chunk. The identity helper now compares exact decoded byte length for absent/identity encoding, rejects excess immediately and truncated bodies at EOF, preserves compressed wire-length semantics, fatal UTF-8 decoding, 256 KiB limit and five-second deadline.

The exact reviewed helper SHA-256 is `07602477a4e04f8e994559f84ca6f23b1dd6c4f1507846f4be65b333a32be36c`. The historical P0 verifier pins this helper, the actual three distinct identity call sites, and only the exact venue status display literal; mutation tests still reject business routes, arbitrary identity routes, additional calls and direct fetches.

Two owned record fixtures were migrated from obsolete standalone introspection to the current request-bound dual-proof contract. Negative fixtures prove missing/confused/nonempty-body proofs send no private HTTP request. Hosted Wallet cancellation checks now use actual localized fallback and disconnected/null-account state rather than obsolete raw copy. This does not prove real approval.

Executed gates:

- New length regressions before fix: 0 passed, 2 failed as expected.
- Eight-file focused Node suite: 71 tests, 70 passed, 0 failed, 1 opt-in isolated HTTP QA skipped; 6098.779084 ms.
- `go test ./internal/exchangeproduct/... ./apps/exchange/server/...`: PASS (business cached, server 0.351 s). An initial mistyped `cmd/server` target was a setup failure; it was corrected to the actual inherited `server` path, not treated as a source failure.
- `git diff --check`: PASS.
- Controlled installed Chrome stream and hosted-popup checks are local product regression evidence only. No public source binding, installed Wallet approval, business operation or user acceptance claimed.

Remaining: historical market-consumer inventory still binds older source and must not be rewritten as current. Formal Host publication belongs to A; the earlier upload channel's unknown remote state must be resolved there before any compatible publication. No blind retry, new SSH or egress change was attempted.
