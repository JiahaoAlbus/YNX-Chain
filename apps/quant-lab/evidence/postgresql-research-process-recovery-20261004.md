# Quant research persistence and process recovery

Base: 956441941a8c1e79766cb12eac653e6f1e4e752e. Test-only change; no production engine, permission, endpoint, shared authority or release artifact changed.

## Executed evidence

- Real isolated PostgreSQL and actual OS service processes; two controlled tenant bindings, not authenticated Wallet users.
- Twelve concurrent HTTP research submissions across two processes and two tenants. Each tenant retained exactly one completed OOS experiment and strategy, with the existing three audit events and no Paper/Testnet orders.
- Same idempotency key with different tenant strategy/cost assumptions remained isolated. Exact replay after both processes stopped returned byte-identical receipts without history access. Changed request under the same key returned 409; fresh research without history returned 503 rather than fabricated data.
- Offline replay, conflicting request, failed fresh research and snapshot reads left persisted SQL revision and full payload unchanged. A second process launch again returned exact original receipts.
- Focused race test repeated three times: PASS, 14.562s. Actual process PIDs: 8060/8063/8087/8089; 8111/8113/8142/8234; 8256/8258/8281/8285.
- Full `go test -race ./internal/quantlab -count=1` with the isolated PostgreSQL configured: PASS, 15.069s. Existing Paper and scheduler process regressions included.
- `git diff --check`: PASS. Owned `quant-process-it-*` rows remaining: 0. QA database stopped; cluster retained.

## Failed draft checks and correction

The new test initially referenced nonexistent `Strategy` instead of existing `StrategySpec`. The first executable check then exposed an incorrect test expectation of one audit event; existing engine emits `strategy_drafted`, `strategy_research_validated`, `backtest_completed`. Corrected tests only; no business behavior relaxed.

## Truth boundaries

History uses the existing controlled synthetic test adapter. This proves local real-service persistence/concurrency/restart behavior, not public market provenance, canonical authentication, public deployment, native installation, real account approval, signing, capital execution or Product Session v2. Those gates remain unverified. Public release is assigned to the separate release owner; no SSH or production action performed.
