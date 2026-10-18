# Opt-in node phase timing

`ynx-abci -phase-timing` emits prefixed JSON lines to the existing stderr log.
The bounded window enables it only with explicit `--node-phase-timing`.
It is disabled by default and does not alter application state formats or Sync.

Each Commit emits cumulative completed CheckTx, PrepareProposal, ProcessProposal,
FinalizeBlock and Commit handler counts, failed responses, total wall nanoseconds
and 64 fixed histogram buckets. Bucket 0 contains zero; bucket i > 0 contains
[2^(i-1), 2^i-1] ns. Quantiles are bucket intervals, never exact points.
Times use the process monotonic clock and include application lock waits.
Concurrent totals can exceed elapsed window time. Counters are not per-block
assignments; CheckTx completions can cross a Commit boundary. Diagnostic record
encoding/writing is outside handler timers, but remains in client-observed latency.

A Commit record also retains the existing actual storage attempt's height,
layout, durable flag, bytes, total and encoding/validation/write/Sync subphases.
These are local storage observations, not inclusion or BFT finality. Missing
pending state produces no old successful storage sample. Errors are preserved.

The recorder stores five fixed sets of counters and at most 4096 Commit log
records plus one terminal shutdown record. Output failure, record overflow or
unfinished timed handlers invalidate the diagnostic session. Each original
node log remains capped at 1 MiB by the bounded controller. A future ten-minute
profile must requalify its data/log budgets and streaming workload separately.

The controller requires four complete shutdown records and exact monotonic
sequence/counter/bucket progression. It retains raw node logs, records per-node
cumulative metrics and Commit subphase totals in the window receipt, and records
missing/malformed/failed/capped output as a first cause. No missing stage is
filled in. Signature verification and state copying remain inside their ABCI
handler totals; separate subcomponent attribution requires additional profiling.

The prepared e022 cached-client comparison uses its frozen e022 controller and
old pinned node binary. It cannot emit these new node timings. A comparison of
these timings requires new binaries and identical opt-in instrumentation on both
sides, with new exact source/build/receipt bindings and Root scheduling.
