# Full validation CPU diagnosis on retained actual history

Sourcec8b7a2f6b14034acbf4a4e801a3260b86a659368; AppleM4/darwinarm64/Go1.25.7/GOMAXPROCS1. The original BenchmarkStateAnchorComparison/records_first validates the same retained real1024-transfer state and migration, verifies their fixed SHA256 and then executes complete semantic validation and canonical state hashing. No fabricated longer history, nodes or transactions are added.

A1s benchmark with CPU profiling returned939iterations/1,211,279ns per validation/243,431B and2849allocations per operation. Total sampled CPU1.16s in1.46s elapsed. Full state hash path accounts for54.31% cumulative samples; JSON struct encoding43.10% cumulative; SHA256 compression23.28% flat. Semantic validation accounts for22.41% cumulative, including fee-event validation13.79%. Cumulative paths overlap and cannot be added. Whole-process samples also include GC/runtime/setup. The short profile is directional evidence, not a reliable small-change benchmark.

This corroborates the original four-node phase observation that validation/hash merits further work. It does not transfer local timings to the Linux8192 history, establish node capacity or justify skipping historical verification. Existing borrowed JSON state hash encoding is already active; its earlier chunked alternative regressed and remains unselected. Next optimization must preserve exact json.Marshal canonical bytes (including escaping/time/maps/nil arrays), domain/version compatibility and full abnormal-state checks, and pass a matched actual-history comparison before activation.

All raw profiles/binaries remain under the authorized WD source packet. The small machine evidence pins the input/provenance and raw output. Reproduction:

```sh
GOMAXPROCS=1 GOPROXY=off GOTOOLCHAIN=local go test -p 1 ./internal/consensus -run '^$' -bench '^BenchmarkStateAnchorComparison/records_first$' -benchtime=1s -count=1 -timeout=30s -cpuprofile /absolute/owned/probe.pprof -o /absolute/owned/probe.test
go tool pprof -top -cum /absolute/owned/probe.test /absolute/owned/probe.pprof
```

In parallel the exact8→16 window packet/tag/plan is frozen on the same source. Original normalCI40084770966 remains in progress; no successful gate, fresh Root grant or multi-node dispatch is assumed.
