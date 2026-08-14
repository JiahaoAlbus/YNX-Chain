# Explorer and Indexer local evidence — 2026-08-14

Implementation checkpoints: `ed1261bd` plus the bounded-admission continuation commit recorded by the enclosing branch history.

Commands executed from the isolated continuation worktree:

```text
gofmt -w internal/indexer internal/explorer
git diff --check
perl (extract embedded browser script) | node --check
go test -race ./internal/indexer ./internal/explorer ./cmd/ynx-indexerd ./cmd/ynx-explorerd
```

Observed result: exit status 0. Indexer and Explorer Race suites passed; both command packages compiled. The macOS linker emitted its existing malformed `LC_DYSYMTAB` warning and did not fail the test.

Covered positive vectors include canonical block/transaction pagination, feed-bound cursor rejection, account-specific activity paging, RPC/indexer summary, block/transaction/address/YNXT/contract search, transaction status/gas/events, account holdings/history/flow, rich-list evidence, SSE, and public deep-link shell routes.

Covered negative vectors include tampered/cross-feed cursors, index store warm-up, deep reorg fail-closed behavior, and dependency errors containing `127.0.0.1`, private paths, or connection-refused text. Public responses are asserted to omit those internal values.

The continuation also adds configurable application-level resource limits for both services: maximum concurrent requests, global requests per second, finite queue wait, and bounded HTTP server headers/timeouts. Explorer separately caps live SSE clients so long-lived subscriptions do not consume ordinary request slots. Indexer serializes polling and manual synchronization so concurrent triggers cannot race one canonical write. Dedicated Race tests prove 429 rate-limit responses and 503 bounded-queue responses while preserving a successful admitted request.

Default limits are 64 concurrent non-stream requests, 500 requests/second, a 150 ms queue wait, and 256 Explorer SSE clients. Deployments can lower or raise them through the `YNX_EXPLORER_*` and `YNX_INDEXER_*` flags/environment variables; overload remains explicit and fail-closed.

This document is local evidence only. It does not assert central integration, staging, public deployment, production signing, or Computer Control verification.
