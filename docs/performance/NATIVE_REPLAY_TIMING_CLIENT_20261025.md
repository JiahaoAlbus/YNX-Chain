# Explicit native stream replay child timing

`-native-replay-timing` now reaches the original client options, report, durable reader and combined certificate/suffix replay API. It requires explicit prepared/current-input-reuse8/grouped-cadence4 with original hash encoding; client GOMAXPROCS1 or2 is selectable. Cached hash/canonical/suffix/tip/submit16/finite modes are rejected. Default false preserves the original certificate-only path and omits new markers/children.

The workload plan binds `nativePrefix.replayTiming`; reports bind `nativeReplayTiming` and actual runtime core count; explicit profile names include replay timing and procs1/2. The independent worker selection, both complete checker calls, case/pair receipts and original archive case labels bind the same choice. Strict readback rejects missing/mixed markers, mismatched plan/profile/runtime, absent or extra child fields, boolean/negative counters, missing active timings, impossible branch counts and child durations exceeding parents. Fee append is nested inside native apply; Finalize and MemoryCommit here are reader replay work, never node execution, disk Commit or earliest BFT formation.

The registered `native-prepared-grouped-replay-timing` recipe keeps diagnostics enabled on both cases and varies only client1→2. It retains all existing source/ELF/same-VM/45+15s/case60s/pair120s, RSS/thread/process/private/disk/log caps, exit-MM policy, two-checker lifecycle, first-failure/UNKNOWN stop and double owned closure. The ten original stream recipe objects were compared against git ac058 source and remain exactly equal. Recipe construction starts no nodes. No new heavy was requested or dispatched, and old401763 data was not revalidated or downloaded.

New light evidence:

- Two actual signed execution/Commit/readback/reopen/nonce-replay-rejection workloads, each102 inputs, run with client1 and client2; both certificate and suffix/frame/Finalize/transaction/fee-append children were exercised. These unit quorum gates remain synthetic, not network TPS.
- Actual `main()` CLI execution in a fresh child parses the complete selected flag set, writes a failed-setup report with nativeReplayTiming=true and actualGOMAXPROCS2, then exits1 for a missing manifest. The direct execute case restores parent runtime1. Actual reader cancellation executes no replay/publication and preserves original durable bytes.
- A mandatory newly generated public Go fixture is independently read in Python: complete102 signed/terminal identities and both child families, plus corruption cases. Existing public fixture destinations cannot be overwritten by this scope; CI retains the new public-only fixture separately.
- Controller101 (99PASS/two actual-Linux-only skips), pair46 and original archive23 pass. Fresh original public unit fixtures were generated for archive tests; no historical run data was reused.

A combined invocation containing the new dual-path tests originally reached its30s package deadline. That failure is retained. CI now runs the unchanged original prepared suite and the new diagnostic suite separately, both with race detection and unchanged30s deadlines; local results were10.436s and8.952s respectively. Actual CLI check also passed separately. The initial absent-field RED, a test fixture transaction-vs-journal mistake and a finite-controller selector NameError were preserved and repaired; no failing test was removed or runtime cap relaxed.

Raw logs and SHA inventory are under `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-replay-timing-source-20261025/`. Original Linux CI is the next source gate. This integration provides measurements for the observed2.492s suffix replay/observation bottleneck; it does not itself claim a throughput gain or close sustained1000×600s. Any new four-node run needs fresh exact source/CI/READY and Root once authorization.

Prepare a recipe without activation:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair --pair-kind native-prepared-grouped-replay-timing --observer-phases --transport grpc --profile supply-native-stream-2048x4
```
