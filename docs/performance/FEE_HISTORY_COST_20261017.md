# Fee history growth: bounded structural probe

The immutable fee journal already removes per-transaction history copies. The
next remaining cost is whole-history validation, JSON encoding and durable
snapshot replacement. This probe measures those costs separately without
changing runtime behavior or weakening persistence.

## Scope and method

Runtime source is `440539fdf748cea567c76dc5edcb235678d6e5e4`. Apple M4,
Go 1.25.7 darwin/arm64, `GOMAXPROCS=1`, Go `-p 1`, nice 10, shared external
boot disk. The previous fee-journal application A/B used `GOMAXPROCS=2` and
a different time window; its throughput figures must not be compared directly
with this probe's timings.

The fixture is the retained 1,024-transfer application snapshot and its original
migration. Larger histories are **synthetic audit records**, with unique IDs and
recomputed audit/state hashes. Balances and nonces are unchanged. Structural
validation succeeding does not establish that those extra transactions ever
executed. No business TPS, network throughput or finality is inferred.

At each history size, three repetitions compare 32 legacy full-history copies
plus appends with 32 immutable journal appends. Timing order alternates between
repetitions. Journal materialization is measured separately, once per resulting
branch, and complete ordered outputs must equal the legacy result. These are
algorithm cost comparisons; they do not substitute for the existing real
transaction before/after binary comparison.

Each repetition then uses the actual eight-phase durable snapshot writer,
including validation, file Sync, atomic rename and directory Sync. Full readback
must equal the input state; persisted bytes must match the canonical JSON format.
GC runs outside each algorithm timing. Commit timings include naturally occurring
GC and shared disk contention. Three samples are insufficient for tail-latency
claims.

The opt-in test requires at least 1 GiB free at entry, caps snapshots at 32 MiB,
uses only its fresh directory, and removes its one synthetic snapshot on exit.
It retains the report. No node or network listener starts.

## Observed medians of three repetitions

| History records | 1,024 | 8,192 | 32,768 |
| --- | ---: | ---: | ---: |
| Snapshot bytes | 812,656 | 5,432,432 | 21,271,664 |
| Legacy 32 copies/appends, ms | 1.723 | 11.873 | 48.358 |
| Legacy allocated bytes | 7,380,992 | 56,950,784 | 226,918,400 |
| Journal 32 appends, ms | 0.001916 | 0.001958 | 0.001708 |
| Journal allocated bytes | 7,168 | 7,168 | 7,168 |
| Journal materialize once, ms | 0.017 | 0.076 | 0.298 |
| Whole durable write, ms | 23.339 | 60.972 | 247.771 |
| Validation/hash, ms | 2.756 | 14.923 | 55.109 |
| JSON encoding, ms | 2.674 | 21.179 | 73.425 |
| Write, ms | 0.133 | 1.146 | 12.915 |
| File Sync, ms | 8.913 | 15.650 | 18.585 |
| Directory Sync, ms | 8.501 | 8.733 | 86.039 |

Per-phase medians need not sum to the median total. The directory Sync jump is
an observation on this shared disk, not proof of a deterministic history-size
relationship. All nine raw records, including file preparation, close, rename,
snapshot digests and readback flags, are retained in
[the evidence JSON](evidence/fee-history-cost-20261017.json).

The fee journal's append allocation stays flat here. Whole-history encoding and
validation still grow. At 32,768 records their separate medians total about
128.5 ms before the remaining durable-write phases. Do not extrapolate these
three short samples into a 600,000-transaction or sustained 1,000 TPS result.
Further persistence work needs an evidence-backed design preserving the current
hash contract, complete fee audit history and crash/recovery guarantees.

## Reproduce

From the performance worktree, using the existing isolated fixture:

```sh
env GOMAXPROCS=1 YNX_CHAIN_HISTORY_COST=1 \
  YNX_CHAIN_HISTORY_DIR="$PWD/artifacts/chain-performance-20261017" \
  YNX_CHAIN_HISTORY_STATE="$PWD/artifacts/chain-performance-20261017/abci-run-1234288681/state.json" \
  nice -n 10 go test -p 1 ./internal/consensus \
  -run '^TestFeeHistoryCost$' -count=1 -v -timeout=45s
```

The first structural run passed in 2.80 seconds. The full consensus suite passed
in 2.578 seconds. These are source/test results. Four-validator paced probes
remain subject to a fresh Root-scheduled slot, and sustained business throughput
and actual inclusion/finality latency remain open acceptance gates.
