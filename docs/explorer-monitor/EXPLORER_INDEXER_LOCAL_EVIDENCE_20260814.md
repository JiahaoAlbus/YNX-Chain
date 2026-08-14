# Explorer and Indexer local evidence — 2026-08-14

Implementation checkpoints: `ed1261bd` plus the bounded-admission continuation commit recorded by the enclosing branch history.

Commands executed from the isolated continuation worktree:

```text
gofmt -w internal/indexer internal/explorer
git diff --check
perl (extract embedded browser script) | node --check
go test -race ./internal/indexer ./internal/explorer ./cmd/ynx-indexerd ./cmd/ynx-explorerd
make explorer-check indexer-check
make deploy-dry-run
```

Observed result: exit status 0. Indexer and Explorer Race suites passed; both command packages compiled. The macOS linker emitted its existing malformed `LC_DYSYMTAB` warning and did not fail the test.

Covered positive vectors include canonical block/transaction pagination, feed-bound cursor rejection, account-specific activity paging, RPC/indexer summary, block/transaction/address/YNXT/contract search, transaction status/gas/events, account holdings/history/flow, rich-list evidence, SSE, and public deep-link shell routes.

Covered negative vectors include tampered/cross-feed cursors, index store warm-up, deep reorg fail-closed behavior, and dependency errors containing `127.0.0.1`, private paths, or connection-refused text. Public responses are asserted to omit those internal values.

The continuation also adds configurable application-level resource limits for both services: maximum concurrent requests, global requests per second, finite queue wait, and bounded HTTP server headers/timeouts. Explorer separately caps live SSE clients so long-lived subscriptions do not consume ordinary request slots. Indexer serializes polling and manual synchronization so concurrent triggers cannot race one canonical write. Dedicated Race tests prove 429 rate-limit responses and 503 bounded-queue responses while preserving a successful admitted request.

Default limits are 64 concurrent non-stream requests, 500 requests/second, a 150 ms queue wait, and 256 Explorer SSE clients. Deployments can lower or raise them through the `YNX_EXPLORER_*` and `YNX_INDEXER_*` flags/environment variables; overload remains explicit and fail-closed.

The deployment dry-run built the Linux release bundle, verified exact commit/release identity and manifest integrity, exercised the four-role installation/backup/rollback command sequence without remote writes, verified Caddy/Nginx Explorer and Indexer bindings, and passed the packaged local-service self-test. The release units set `MemoryMax=2G` and `TasksMax=512` for Indexer and `MemoryMax=512M` and `TasksMax=512` for Explorer. This is deployment-package evidence, not a staging or public deployment.

## Public-vantage bounded load observation

The source-bound `cmd/ynx-explorer-load` verifier was added to exercise concurrent reads, a caller-supplied real search query, and concurrent SSE subscriptions without manufacturing chain data or treating failures as success. Its unit/race tests and `go vet` pass.

`make explorer-check` now includes a three-second controlled baseline over the transaction created by that Testnet integration run: five HTTP workers, a global 10 requests/second target, one SSE subscriber, and a real transaction-hash search. The gate requires both zero HTTP error rate and zero SSE errors; after a one-second service-settle interval it passed three consecutive full integration runs with different real transaction hashes. Unpaced mode remains available for explicit overload/search-storm evidence and is not confused with the healthy baseline.

The following bounded observation targeted the currently deployed older public Explorer, not the continuation release:

```text
go run ./cmd/ynx-explorer-load \
  --base-url https://explorer.ynxweb4.com \
  --duration 10s --concurrency 10 --sse-clients 2 \
  --search-query 1017890 --timeout 5s
```

Observed at `2026-08-14T14:08:32Z`: 73 completed HTTP samples, 7.30 requests/second, p50 829.58 ms, p95 3838.67 ms, p99 4667.49 ms, maximum 4709.39 ms, 72 HTTP 200 responses, one HTTP 502 response, two additional request errors, eight SSE events, zero SSE reconnects, and zero SSE errors. The HTTP error rate was 4.11%, so the verifier exited non-zero as designed. This is negative public evidence: it does not satisfy the concurrency gate and must not be presented as a passing soak result.

This document is local evidence only. It does not assert central integration, staging, public deployment, production signing, or Computer Control verification.
