# Cached-fee safe-byte lookup

The explicitly selected cached-fee hash encoder scanned each JSON string byte with several comparisons. A short retained-history CPU sample identified this scan as a useful optimization target; its sample also includes fixture initialization, so it is not an exact attribution of steady-state CPU. The implementation now classifies bytes using one fixed256-entry lookup. ASCII controls, quote, backslash, HTML-sensitive bytes and all non-ASCII still use the unchanged encoding/json fallback. Every field, record, original byte order and full SHA256 input remains present. This changes only the existing cached-fee-time-json path. Original-json is still the default, process selection remains immutable, and the pending grouped four-node run stays frozen at1f21f1f2e with its original hash backend.

Matched local comparisons used the same retained actual1024-transfer history, Apple M4/darwin arm64/Go1.25.7, GOMAXPROCS1 and six200ms ABBAAB samples. A is the prior cached-fee branch scanner; B is the same cached-fee encoder with the lookup. These are not original-json versus cached-fee measurements and must not be compared causally across older runs.

| Scope | Prior cached encoder median | Lookup median | Change |
| --- | ---: | ---: | ---: |
| Complete state hash | 739,416ns | 617,804ns | -16.45% |
| Full semantics plus cached state hash validation | 1,204,483ns | 1,097,525ns | -8.88% |

Hash sample ranges are729,994–744,722 versus616,442–652,547ns. Full validation ranges1,195,528–1,406,842 versus1,078,136–1,214,363ns overlap; the reported median improvement is a bounded local observation, not a universal speedup. Allocations remain1049/hash and1843/full validation; byte counts remain approximately28,882 and195,322 respectively.

Focused existing CI race command passed: consensus8.024s/client5.688s. In addition to the existing256 single-byte oracle, a new encoding/json oracle checks65,536 byte pairs after a safe prefix, covering UTF8 boundaries, controls, HTML and escaping. Existing complete canonical bytes/SHA across state versions1–13, timestamp representations, late errors, sink/framing, closed fee schema and parallel private buffers remain covered. The selected real application child retains failed-commit rollback/poisoning and original-decoder replay after actual os.Exit73 following fsync. The actual selected client executed/signed/committed102 inputs with nonce34 and stream recovery; its producer shares the unit process and quorum gates are synthetic, so it does not establish independent BFT/network throughput.

The change and new oracle run in the existing cached-fee race CI step, with the original30s test timeout and20-minute job budget. Normal push CI is required after repinning the exact source guard; no workflow_dispatch or new heavy test is authorized by this source change.

Reproduce the selected correctness scope with GOMAXPROCS=1 go test -race -p1 ./internal/consensus ./cmd/ynx-consensus-perf-client -run '^Test(CachedFeeHashCandidate|StateHashEncodingSelectedApplication|CachedFeeClient)' -count=1 -timeout=30s -v. Compare the prior and changed source files with benchmarks ^BenchmarkCachedFeeHashActualHistory/B-direct$ and ^BenchmarkCachedFeeFullValidateActualHistory/B-cached$,200ms each, using A,B,B,A,A,B order. Exact source/raw digests and all12 samples are in evidence/cached-fee-safe-byte-table-local-20261024.json. Raw logs/profile/test binary stay under /Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-prepared-grouped-pair-source-1f21f1f2e/cached-fee-*.

No new node/runtime default, deployment, independent finality, sustained1000TPS or ten-minute capacity result is claimed. Next: qualify ordinary push CI, retain the grouped-only frozen experiment for Root's pressure1 window, then compare the explicit cached-fee client path in a separate same-condition experiment rather than mixing axes.
