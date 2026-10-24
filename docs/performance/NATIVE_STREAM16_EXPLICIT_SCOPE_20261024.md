# Explicit native stream16 client candidate

The measured stream8 Status pair offered about 327.68 transactions/s against a declared 1000/s. This change prepares a separately identifiable submit-concurrency experiment; it does not establish that concurrency is the bottleneck or that throughput improves.

Select `--native-stream8 --native-stream-submitters 16 --concurrency 16` together with all original native streaming options. Zero (omitted) preserves the original eight submitters. The plan identifies `scoped_native_prefix_stream16_v1`, records sixteen submitters and four observers; the report records the explicit selection. Plain concurrency16 and unsupported overrides fail validation. Original signing, sender nonce sequence, balances, bounded queues, native reader budget, durable readback and full evidence checks remain active.

Focused actual-business validation executes 102 signed transactions, three accounts with 34 nonce cycles each, CheckTx/FinalizeBlock/Commit, original native signature/state observation, full terminal evidence verification, reopening and replay rejection. It constructs the sixteen worker inventory and checks the persisted plan against it. This fixture has only three sender accounts: it does not exercise sixteen simultaneous submissions or measure network capacity. Quorum gates remain synthetic in the application fixture. The original eight-worker public archive fixture is preserved separately.

Validation on the current local Go toolchain: focused tests PASS 2.531s; focused original8/new16 race PASS 6.676s; full client package PASS 15.988s. Existing Chain Core CI already selects all TestNativeStreaming tests with race; no separate workflow is added. Raw logs reside under `/Volumes/西部数据/YNX-large-work/chain-performance-20261017/native-reader-finish-pair-source-1c86e2bad/native-stream16-*.raw`.

Next: prove bounded sixteen-way simultaneous issuance with more test senders, instrument/compare submit waiting and queue utilization, and bind the new profile through the pair controller, worker and archive verifier. Hosted four-node execution requires a fresh exact Root grant after the prior run fullstream readback is independently qualified. No old grant is reused, no new network test has run, and Status remains off by default. Sustained1000/s and finality latency are unproven.

## Sixteen concurrent callbacks validated

A separate 32-account/two-round fixture now completes 64 real signed business executions and durable commits. A cancellation-aware first-wave barrier holds the first sixteen submission callbacks until all sixteen have entered, then releases them to the original CheckTx path. The original occupancy recorder confirms peak16, exactly64 callback entries/returns, no active callbacks at completion and all64 queue-wait samples. The test keeps the full native signature/current-state verification, terminal evidence readback, reopen and replay rejection. The barrier controls scheduling only; these timings are not a measured improvement or a network result. The original three-account/34-cycle fixture remains unchanged in scope.

Focused concurrent-business race PASS4.124s (test body2.54s); full client package PASS17.824s. The initial compile mismatch in the generalized transaction-verification counter was corrected without changing runtime semantics; both initial and green raw logs are retained on WD. Existing CI TestNativeStreaming selection includes this test. Next implementation step is binding explicit16 through the pair controller, worker and archive verifier before requesting a new heavy window.

## Pair controller and complete verifier route

The existing workflow now exposes `paired-native-stream-submit16` with fixed pair-kind `native-stream-submit16`. Prepare with:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair --pair-kind native-stream-submit16 --observer-phases --transport grpc --profile supply-native-stream-2048x4
```

This prepare action starts no nodes. Both actual cases keep configured1000/s,2048senders×4rounds=8192signed business inputs, bounded cadence, current-input reuse, original strict JSON certificate, Status hint off, four observers,2048 submission queue and2048 each observer queue. Only submit8 versus explicit submit16 changes. The second profile has a `-submit16` identity suffix; the actual command must include `-native-stream-submitters 16` and concurrency16. Plan/report/worker inventory/producer selection and recovered pair receipt must agree; no worker count is inferred as authority from the report.

Both retain original45active+15cleanup/60s case and120s pair limits, RSS1GiB, thread320, maximum simultaneous owned processes10, private256MiB per case/aggregate512MiB, log2MiB/build1GiB and original memory/disk floors. More workers do not grant extra resources. The verifier runs only after client exit, performs both full8192 checker passes within the active budget and is replaced/cleaned under the original process guards. Archive recovery recognizes both new labels and checks the explicit submitter axis against the selected pair. New16 uses an explicit typed verifier key; original8 selection format remains unchanged.

Local control validation: controller89PASS; pair32PASS (including actual run invocation binding via mocks, first-failure stop, same-budget comparison, command-only delta, worker count/queue mutation, typed verifier selection, receipt axis mutation and original SHA binding); archive23PASS using a freshly produced original real-signed102 public Go fixture. The first archive invocation failed because the mandatory fixture environment was absent, rather than skipping the positive; failure and subsequent green logs are retained. These are source/control tests, not a Linux network benchmark. Existing CI already selects these files and tests.

A fresh exact Root scheduling grant is still required after normal CI/source freeze. Old10-process grants cannot be inherited by the16-worker candidate. No network throughput/latency improvement is established by this route wiring.
