# Bounded client: reuse validation only after fresh full-file hashing

The observer previously read, decoded and validated the complete local snapshot
for every transaction. The new reader still opens and streams the actual current
file on every observation. It reuses parsed state only when the freshly computed
SHA-256 matches the already validated bytes for that specific node path and
privately cloned migration anchor. File timestamps and inode identity do not
authorize a cache hit.

There are at most four fixed snapshot slots. Each owns a 32 KiB read buffer, one
validated state and immutable fee/nonce indexes. Full parsing/validation and
index replacement occur under that slot's mutex. No mutable state pointer escapes
to observers; they receive only height, AppHash, snapshot digest and cache-hit
metadata. Every requested native transaction is still strictly decoded and
cryptographically verified, and its matching fee/height/payer/type/amount and
current account nonce are checked. Weighted quorum, Merkle proof, RPC identity
and execution-code checks are unchanged.

On a miss, the same opened file is rewound and read for parsing; its bytes must
hash to the first-pass digest. An in-place change between passes fails closed.
Missing files, malformed/tampered snapshots and snapshots behind the requested
height do not reuse an old success. Cancellation is checked during streaming and
before returning evidence. The observer also checks its monotonic deadline before
publishing final confirmation. No submission is retried.

Reports advance to schema 4, add aggregate read/validation/transaction-verification
work counts and attach the actual snapshot SHA-256/cache-hit flag to each durable
observation. These counters are work measurements, not business transaction
counts. Original raw observations are not rewritten.

## Tests

The complete client suite passed, including existing signed-quorum, weighted
threshold, proof-tamper, wrong-ACK, unknown-submission and pacing tests. New tests
use an actually executed and synced local transfer and cover:

- equality with the original durable verifier and full bytes hashed on every hit;
- same-size corruption with restored mtime, deletion, future height and wrong fee
  inclusion height;
- real atomic replacement after a further empty block, including changed height
  when AppHash remains unchanged;
- concurrent requests sharing one parse while individually verifying signatures;
- bad transaction signatures even on snapshot hits, copied migration ownership,
  cancellation, duplicate/unregistered paths and the four-slot limit.

No race-detector result is claimed. The original verifier remains as an independent
test/benchmark reference. The preceding real 128-transaction network run used the
old frozen client; this changed reader has not yet run in a network window.

## Same-condition microbenchmark

Apple M4, Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, nice 10. Both implementations
run in the same retained `durable-reader.test` executable against the unchanged
real 1,024-transfer snapshot, 812,656 bytes. The transaction is a genuine included
signed transfer from that fixture. The new reader is primed outside timing; this
measures repeated readback of an unchanged snapshot, not first-parse cost.
Each measured call still streams all 812,656 bytes and verifies the transaction.

Order: original, new, new, original, original, new, 200 ms each. Median of three:

| Local readback operation | Original | Fresh hash + reuse |
| --- | ---: | ---: |
| ns/op | 7,874,976 | 443,681 |
| allocated bytes/op | 8,581,444 | 4,504 |
| allocations/op | 15,811 | 51 |

The observed operation is about 17.75 times faster in this small warm-file probe.
It is an observation-cost result, not 2,254 business commits/s or a finality
measurement. All six raw outputs and binary/source digests are retained in
[the evidence JSON](evidence/durable-reader-20261017.json).

Reproduce from the performance worktree:

```sh
env GOMAXPROCS=1 YNX_CHAIN_DURABLE_BENCH_DIR="$PWD/artifacts/chain-performance-20261017" \
  nice -n 10 ./artifacts/chain-performance-20261017/durable-reader.test \
  -test.run '^TestDurableReader' -test.bench '^BenchmarkDurableSnapshotReadback$' \
  -test.benchtime=200ms -test.count=1
```

## Remaining load-driver limitations

The existing 16 MiB per-snapshot input limit and 256-transaction/short-deadline
driver bounds remain unchanged. Retained decoded state and indexes also consume
memory; the encoded-file limit is not a total-RSS limit. Every transaction still
hashes the whole current file, so read bandwidth grows with history. This reader
alone cannot qualify a ten-minute 1,000 TPS run. A later driver/storage design
must handle larger histories, grouped durable observations, controlled memory and
longer offered traffic, with new Root resource scheduling. This stage introduces
no node, deployment or network acceptance claim.
