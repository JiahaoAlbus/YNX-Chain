# Explorer, Indexer and Monitor Integration Handoff

Status: continuation candidate; not centrally accepted  
Owner: `12-explorer-and-13-monitor`  
Base commit: `2a78ace0a647b73dd2961fae3361189116453a7d`  
Continuation source commit: pending first checkpoint

## Recovered authority

The continuation preserves the centrally merged Explorer UI and Monitor operator/public-status implementation from `origin/main`. It restores the exact public Indexer implementation from `c5150caa35ee8cc563538d15acc9e404a6f2bf08` without importing unrelated branch content.

The restored Indexer provides durable snapshot plus append-only journal persistence, sequence validation, restart replay, bounded journal compaction, bounded block batches, canonical fork detection, rollback and re-index, source-height rollback recovery, deep-fork fail-closed behavior, opaque signed cursors and concurrent-reader evidence. It reads Chain Core only through its existing RPC contract and does not redefine chain identity or finality.

## Public truth boundary

Historical public services currently expose:

- Explorer source `660ab05db423319d92e9597ce5a280474ae293d6`.
- Indexer source `c5150caa35ee8cc563538d15acc9e404a6f2bf08`.
- Monitor source `5d42be02`, release `0.2.0-testnet-preview`.
- Website Vercel production project `ynx-web4-website-new`.

Those deployments do not prove the continuation source is integrated, staged, deployed or publicly verified. The continuation release states therefore remain false for every post-local gate.

## Consumer rules

1. Consumers must validate `network`, `chainId`, service identity, source/canonical height and native asset before using data.
2. A successful process health response never implies every dependency, validator or product is healthy.
3. Cursor signatures are feed-bound; tampered and cross-feed cursors fail closed.
4. Reorg recovery removes orphan transactions before canonical replay. A fork beyond the configured recovery depth requires an operator rebuild.
5. Browser responses must use bounded public error codes and may not echo loopback URLs, paths, stack traces or raw upstream messages.
6. StreamBFT remains shadow/candidate until the Chain Core owner publishes an accepted cutover fact.
7. Monitor has no asset, Treasury, validator-key or Quant-mandate authority.

## Current acceptance evidence

- `go test -race ./internal/indexer ./internal/explorer ./cmd/ynx-indexerd` passed after recovery.
- Monitor 39-test suite and production build passed on the continuation base.
- Website verification, production build, 15-route prerender and 48-URL IndexNow dry run passed on Website `origin/main`.
- The exact requirement matrix is `docs/explorer-monitor/FABLE5_REQUIREMENT_EVIDENCE_MATRIX.md`.

## Next gates

The next slice must sanitize public dependency errors, expose complete cursor/deep-link contracts through Explorer, and finish the Explorer transaction/address/search/localization UI before Monitor schema expansion and Website publication.
