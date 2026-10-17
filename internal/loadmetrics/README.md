# Bounded load-driver latency statistics

This package is groundwork for replacing the performance client's lifetime
latency arrays when account result slots are recycled. It is not yet imported
by that client. Current frozen client semantics and workload caps are unchanged.

`Histogram.Add` takes nonnegative `time.Duration` spans produced from monotonic
measurements. It keeps 60,001 uint64 buckets (480,008 bytes), exact min/max and
a sample count, with no per-sample retained list. It rejects more than one
million samples without mutating counters. Six latency distributions therefore
need roughly 2.9 MB of bucket storage even for a ten-minute 1,000/s workload.
That is a capacity calculation, not evidence of executed business transactions.

`Summary` reports P50/P95/P99 as closed nanosecond intervals containing their
exact nearest-rank values. Normal intervals have width <1 ms. Samples >=60 s
remain included in counts and ranks, with overflow flags and an interval ending
at the exact observed maximum; they are never dropped or clamped to 60 s.
Empty summaries mark quantiles invalid rather than inventing zero latency.

A P95 interval crossing the 3 s objective cannot establish P95<=3 s. Use the
retained per-transaction evidence stream for exact offline quantiles. The caller
must still decide whether each sample passed signature, execution, quorum,
persistence and publication gates. This package performs none of those gates
and does not call synthetic sample input effective business TPS.

Test sources cover deterministic comparison to exact sorted nearest ranks,
overflow and the 60 s boundary, empty/invalid/bounded input, and 600,000 synthetic
latency samples with fixed storage and zero normal-path Add allocations.
**These Go tests have not been executed yet.** They are a separate future light
target and were not added to the pending frozen client's resource window:

```
GOMAXPROCS=1 GOGC=50 GOMEMLIMIT=160MiB nice -n 10 \
  go test -p 1 ./internal/loadmetrics -count=1
```
