# Exchange long-lived subscriber capacity — isolated source evidence

Parent: 35d7bc5ca1d71b98c3d962d0eed5f7ab538d3110. Owner worktree: exchange-sso-cookie-binding-20261002; branch: codex/exchange-sso-cookie-binding-20261002.

## Actual reproduction

An httptest HTTP server runs the original Exchange Server/Service with retained test state. A real HTTP client holds 128 independent SSE response bodies open. Before correction all 128 are accepted, consuming every shared request slot. `/health`, `/v1/market-data/snapshot`, `/metrics` each return 503 `capacity_exhausted`. Red test: 0.507s. This is an actual local HTTP/resource failure, not a synthetic order, account or public-volume claim.

## Correction and actual checks

Keep total request concurrency at 128. Separately bound the existing SSE/WebSocket routes to 64 live requests, still counted within the same shared 128-slot semaphore. Thus long-lived subscribers alone cannot consume the remaining 64 slots needed by ordinary requests. This is not a promise of indefinite health under arbitrary ordinary-request overload. Over-capacity streams receive 503 `stream_capacity_exhausted`, Retry-After=1 and existing request/error IDs/logging. Deferred release runs on transport failure, context cancellation, state/auth rejection and normal return. No permission, producer, matching, persistence schema or trade source changes.

The direct actual-HTTP regression verifies 64 accepted / 64 rejected streams, continued 200 ordinary health/snapshot/metrics, WebSocket attempts cannot evade the bound, active stream count and capacity metrics are 64, both capacity semaphores return to zero after disconnect, and a new subscriber is accepted again. Existing native-fixture owner isolation, original WebSocket, browser-v2 rejection/replay/restart and two independent real HTTP market reader tests are retained.

Executed gates on final source:

- `go test -race ./internal/exchangeproduct -run 'Test(OpenStreams|MarketStream|MarketDataStream|OpenMarketStream|Guest|MarketWebSocket|BrowserV2)' -count=3`: PASS, 19.737s.
- `go test -race ./internal/exchangeproduct`: PASS, 23.948s.
- `node --test apps/exchange/tests/market-data.test.mjs`: 36/36 PASS, 0 skip, 101.504416ms.
- `go vet ./internal/exchangeproduct`, gofmt, `git diff --check`: PASS.

New additive Prometheus gauges: `ynx_exchange_streams_in_flight`, `ynx_exchange_stream_capacity`. Limits are per-process resource admission, not distributed tenant quotas; PostgreSQL/multi-instance state remains the existing distinct original contract. No new opt-in PostgreSQL run in this checkpoint.

## Release and full-goal boundary

Owner source only; no formal release/build/installer/deploy/real Wallet approval/sign/transaction/ComputerControl was performed. Shared protected main/producer/profile and final source-bound release are owned by the central release owner. No update to existing formal manifest/pins and no modification of Finance authority, DEX/Card/Pay/Calendar/Wallet or another owner's worktree. Public old runtime is not upgraded by these tests. Overall financial product goal remains incomplete; source gates cannot substitute for installed/public user journeys.

Rollback for a future approved matching assembly: revert only this checkpoint's capacity change/test, retaining 35d7 transport retirement and earlier owner work, rerun the listed gates. Preserve user state; never reset or force push. Handoff and release gap go to 接续测试网生态审计工作, not the former audit thread.
