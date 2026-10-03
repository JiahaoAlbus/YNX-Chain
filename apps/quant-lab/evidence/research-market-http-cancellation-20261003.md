# Quant research cancellation reaches the actual market HTTP request

Predecessor `288c97e5f00f11cb96d5dea075be763f88fa56f4`, tree `2dd5eab719e4064b565fbba6cc6da5165576400d`, branch `codex/exchange-sso-cookie-binding-20261002`.

## Change

The previous checkpoint prevented cancelled research from committing after a context-free market adapter returned, but did not stop its upstream HTTP request. The existing `HTTPExchangeMarketData` now supports optional `HistoryContext` and uses `http.NewRequestWithContext`. Both ordinary saved-research paths and public research status forward their original context to the same configured market URL. A ten-second child deadline bounds the HTTP tape request without extending a shorter caller deadline; response body decoding occurs while that child context is alive and its response body is closed.

Existing History/Latest API callers remain compatible. Context-free local adapters still run synchronously and are not made interruptible by abandoned worker goroutines. This change does not claim that an arbitrary non-cooperative custom RoundTripper/Body or legacy adapter can be forcibly stopped. No source data, price formula, synthetic market, new endpoint, retry or financial execution is introduced. Original returned source and bar transformation stay unchanged.

## Executed tests

- Focused HTTP/source/replay/cancellation race regression: PASS, 1.704 s.
- Full `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`: PASS, respective 2.587 s and 1.348 s.
- `go vet ./internal/quantlab ./apps/quant-lab/server`: PASS.
- `git diff --check`: PASS.

Actual local HTTP server cases cover stalled headers and stalled body, each through the real saved-research handler with and without the original recovery key. Once the parent context is cancelled, the upstream HTTP request observes cancellation, the handler settles within the fixture's two-second safety bound, exactly one market request occurred, the response is 408 and the state file remains byte-identical. A separate transport observer verifies the ten-second deadline is present and an existing 200 ms caller deadline is not extended. This observes deadline metadata rather than claiming a full ten-second elapsed production test.

Existing provenance acceptance, calculation, saved-receipt restart/concurrency and legacy adapter tests remain in the full package regression. Optional PostgreSQL tests still require a reachable disposable QA URL; package PASS does not imply those optional tests ran. No production/testnet accounts, signatures, transactions or deployment were used.

## Integration and honest gates

Consume this ordinary backend together with `288c97e5` and the prior saved-research page in the unique release owner's coherent graph. No schema migration or configuration endpoint change is needed. Public source binding, real Wallet permissions/private Product Session, installed flow and multi-instance production DB remain unverified. Report only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`). No public mutation occurred; retain the prior signed complete artifact until the integrated runtime is built and verified.
