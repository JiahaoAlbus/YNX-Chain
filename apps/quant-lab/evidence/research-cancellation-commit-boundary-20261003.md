# Quant research cancellation at the durable commit boundary

Predecessor `6f16f6b422e1a8b74660500077c31c4945da5268`, branch `codex/exchange-sso-cookie-binding-20261002`. Scope is the existing ordinary research service, HTTP request context and direct regression tests. No shared Wallet/Auth/SDK, session verifier, grant, scheduler/execution permission, or release pin changed.

## Reproduced failure

A real existing local-preview POST `/v1/backtests/from-market` with a controlled market adapter cancelling the request immediately before returning its bars still returned **201** and changed durable `state.json`. Both omitted-key compatibility and same-request-key paths failed the regression. The pre-fix result is retained here; it was not a public or authenticated Wallet test. The first implementation compile also failed due a missing context import; it was corrected before verification.

## Implemented correction

- HTTP inline, market and isolated public research paths pass the original request context to existing research logic.
- Context-aware service methods check admission, after market response, after reload under the existing durable commit lock, before replay or mutations. Existing Go API names remain background-context compatibility wrappers for non-HTTP callers.
- Cancelled/deadline errors produce HTTP 408 with `request_cancelled` and existing request/error tracking. Cancellation does not synthesize a successful receipt.
- Exact original idempotency key/digest, persisted receipt replay, strategy calculation/formulas, tenant isolation, audit and atomic save remain unchanged. A fresh explicit retry still reads the original completed receipt without rereading market data.

This is a pre-commit cancellation fence, not an undo mechanism after commit begins. It does not make the old context-free market adapter interruptible, eliminate mutex wait time, or prove no cancellation can race after the final admission check. It introduces no goroutine abandonment or automatic POST retry. These limits are important: a lost response after commit must still use the existing same-request recovery.

## Verification

`go test -race ./internal/quantlab -count=1`: PASS, 2.765 s. `go vet ./internal/quantlab`: PASS.

`go test -race ./apps/quant-lab/server -count=1`: PASS, 1.953 s. `go vet ./apps/quant-lab/server`: PASS. `git diff --check`: PASS.

Focused actual service/HTTP regressions pass with race enabled:

1. Cancellation after returned market data: legacy and keyed requests each return 408, and state bytes remain exactly unchanged.
2. Cancellation after admission while the actual commit mutex is held: no durable mutation, and cold reopening retains exactly one prior experiment.
3. Cancelled context cannot replay an old success; an explicit new context recovers the byte-equivalent original receipt with market call count still one.

Existing complete Quant tests include optional PostgreSQL cases that skip when `YNX_QUANT_POSTGRES_TEST_URL` is absent. Package PASS is not evidence that those DB tests ran, or that production has a multi-instance database. No new credentials, production database or testnet capital were used.

## Integration

The unique release owner must consume this ordinary backend with the saved-research recovery page and accepted coherent authority graph, build and verify its exact public runtime. No public deployment, real Wallet approval, installed flow or transaction is claimed. Requests and unresolved issues go only to `接续测试网生态审计工作` (`01a094cc-0ba3-7901-bcd5-56fce8330c0d`).

No migration or state schema change is required. Existing artifacts remain the rollback point until a complete signed release is integrated; this source checkpoint has changed no public runtime.
