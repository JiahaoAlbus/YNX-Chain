# Reuse cryptographically verified native envelopes

The preceding CPU sample identified repeated native signature verification as a
material cost. CheckTx, proposal preparation, proposal processing and finalization
all verified the same immutable transaction again. The candidate reuses only the
canonical decoded envelope and successful static cryptographic verification.

## Cache contract

- Each application owns a separate, initially empty cache. Nothing is persisted.
- The key contains expected chain ID and SHA-256 of the complete wire payload.
  Lookup also compares the retained exact canonical bytes, not just the digest.
- Misses own the input bytes, run the original strict decoder and complete
  `SignedTransaction.Verify`, then publish an immutable value. Invalid envelopes
  and failed signatures never enter the cache. Concurrent misses may each verify;
  verification runs outside the cache mutex.
- Returned transaction values and reused caller buffers cannot modify entries.
- FIFO eviction limits entries to 4,096 and retained raw/decoded string data to
  4 MiB. Map/ring/scalar overhead is separately bounded by entry count. This is
  not a 4 MiB total process-RSS limit.
- Every execution still checks the current account, nonce, balance, fee movement,
  lots and resource usage, with the original rollback clone. The cache supplies
  no admission or business authorization. It does not reserve a mempool nonce.
- Ethereum and application-action verification are unchanged. Validators never
  import another process's verification result. A cold node verifies a native
  envelope itself before reuse; a restarted process begins cold again.

Native static validation currently depends only on the envelope, compiled rules
and expected chain ID. There is no time, account or mutable policy dependency in
`SignedTransaction.Verify`. Future changes to that contract must revisit cache
keys/invalidation. The current cache does not replace quorum signatures, proposer
validation, persistence or mutable execution checks.

## Tests and equivalence

New tests cover changed payload bytes, caller-buffer reuse, returned-value
mutation, wrong chain, forced private-store digest collision, malformed and
noncanonical JSON, changed signed fields, missing/bad signatures and public keys,
oversize input, entry/byte eviction and concurrent publication. Algorithm-bound
tests directly seed private storage with synthetic strings; those fixtures are
not signed, admitted, executed or counted as business traffic.

After priming a valid envelope, nonce changes, zero balance, absent lots and
exhausted bandwidth must still reject it. The same envelope then executes and
commits through the actual persistent application. Replay remains rejected both
warm and after restart, and the restarted process must perform a fresh successful
signature verification before rejecting the committed nonce.

Focused tests and the complete ordinary consensus suite passed. No race-detector
run is claimed. An initial new restart assertion used `reflect.DeepEqual` and
failed because the existing loader normalizes omitted `DexPools` from nil to
empty. Inspection showed complete canonical JSON unchanged. The final test uses
exact full canonical JSON equality, consistent with the durable contract, and
reports the normalized field. No loader behavior was changed.

Six actual 1,024-transfer application runs additionally produced identical
per-block AppHashes and final snapshot bytes across baseline and candidate. Each
run executed all transfers with code zero, wrote and synced the original state
format, retained all fees, compared full state after restart and rejected replay.

## Same-condition measurements

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10; build `-p 1`.
Baseline runtime is `c14e7e403b2b84cef7152d3c6326090111ec122b`, compiled with the
dormant cache implementation and the same application-probe counter reporting.
Its execution path still directly decodes/verifies every time. The baseline test
binary predates the test-only correction of the nil/empty restart assertion;
the measured benchmark and application probe are identical in both binaries.
Zero baseline cache counters mean that the helper is unused, not that baseline
transactions lack real signature verification.

Microbenchmark and application order: before, after, after, before, before,
after. The microbenchmark repeats the exact same next valid signed nonce against
the original 1,024-transfer snapshot. It is a **warm reuse** measurement after the
first miss, not capacity for fresh transactions or business commits.

| Warm repeated CheckTx, median of three | Before | After |
| --- | ---: | ---: |
| ns/op | 101,683 | 9,507 |
| allocated bytes/op | 33,785 | 30,111 |
| allocations/op | 70 | 29 |

The real application workload remains 256 accounts, 64 senders,
64 transactions/block and 16 blocks, using the same original migration. Signing
and post-run restart checks remain outside pipeline timing. Each distinct new
transaction starts with a cold signature-cache miss. Every candidate run reports
exactly **1,024 successful cryptographic verifications, 3,072 hits and 4,096
lookups**, with 1,024 entries retaining 730,416 string bytes. The measurement
runner asserts those counters rather than assuming reuse occurred.

| Application run metric, median of three | Before | After |
| --- | ---: | ---: |
| pipeline tx/s | 1,273.87 | 2,027.41 |
| allocated bytes | 197,004,192 | 187,086,864 |
| CheckTx total ms | 114.208 | 118.238 |
| PrepareProposal total ms | 111.937 | 12.203 |
| ProcessProposal total ms | 111.392 | 11.910 |
| FinalizeBlock total ms | 143.652 | 43.501 |
| durable Commit total ms | 313.611 | 319.303 |

The observed pipeline median increases 59.15%, while allocation decreases 5.03%.
The first-admission CheckTx stage is slightly slower, consistent with extra miss
bookkeeping; this sample does not establish a causal latency estimate for every
new transaction. Later stages reuse already verified bytes, and persistence is
unchanged. Throughput ranged 1,009.73–1,306.39 before and 1,892.10–2,037.48 after.
These are three short runs per version on a shared host/disk, not sustained
network capacity or finality qualification.

All raw reports, counters, binary/source digests and output are retained in
[the evidence JSON](evidence/native-verification-20261017.json).

## Reproduction and outstanding gates

From the performance worktree (substitute `before` for the baseline):

```sh
env GOMAXPROCS=1 YNX_CHAIN_CHECKTX_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/verification-after.test \
  -test.run '^$' -test.bench '^BenchmarkCheckTxTransfer$' \
  -test.benchtime=200ms -test.count=1
env GOMAXPROCS=1 YNX_CHAIN_PERF=1 \
  YNX_CHAIN_PERF_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/verification-after.test \
  -test.run '^TestABCITransferPerformance$' -test.count=1 -test.v -test.timeout=45s
```

Run the final candidate's complete suite from `internal/consensus` with
`../../artifacts/chain-performance-20261017/verification-after.test -test.run .`,
or use `go test -p 1 ./internal/consensus` under the same resource settings.

No network nodes started during this stage. The earlier frozen network candidate
was not overwritten. Whole-history hashing/JSON/persistence growth and the load
client's observation cost still require work. Actual four-validator inclusion,
durable finality, errors/backlog/resources and at least ten continuous minutes
at 1,000 valid business commits/s remain open. Further network runs require a
fresh Root-scheduled slot; the source result does not complete the overall goal.
