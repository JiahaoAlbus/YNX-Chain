# Explorer and Indexer local evidence — 2026-08-14

Implementation checkpoint: `ed1261bd`

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

This document is local evidence only. It does not assert central integration, staging, public deployment, production signing, or Computer Control verification.
