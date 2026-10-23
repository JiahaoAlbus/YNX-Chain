# Explicit four versus eight submitter experiment

Source edfb053c86b96e6c45b716fe6593872b8f88b958 adds a separately selected native
submission experiment. It follows actual pair39973570392: configured offers were
about997/s, actual submission about639/s, and finite effective final TPS459.5.
Private copying reduced reader work but did not close the supply gap. Eight
submitters are a testable hypothesis about submission/observation overlap, not a
proven server, network or CPU cause and not a measured throughput improvement.

## Runtime and selection

The existing default limit remains1..4 submitters. Exactly8 requires the explicit
`-native-submit8` flag, `-concurrency 8`, native prefix copying, one rounds-mode
round, configured1000 offers/s and exactly4 observers, together with all original
prefix timing/reader/stream restrictions. Five, six, seven and nine workers are
not silently enabled. Flag-with-four, eight-without-flag, shared replay, altered
round/rate/observer/sender modes and missing timing fail validation.

The original paced worker implementation retains one submission attempt per
input and the unchanged index-to-endpoint authority. UNKNOWN/unaccepted callbacks
do not enter accepted observation and are not retried. No node/writer, signature,
fee, nonce, state validation, quorum or durable acceptance code changed.

Both native control and candidate record actual worker/queue inventory. Worker
counts increment at launch sites; queue capacities come from actual channel
capacities. Submission capacity remains the input count; each of four observation
queues also retains that capacity. It does not grow with submit worker count.
The original callback occupancy separately reports actual active peak, starts,
returns and active-at-end; configured8 need not imply actual peak8 in a real run.

The fixed `native-submit8-data64` pair selects native copying on both sides and
runs `native-submit4` then `native-submit8`. The only experimental configuration
changes are the explicit mode marker and4→8 submit count. Both sides retain2048
independent signed nonce1 inputs, offer1000,4 observers, relative pacing, same
four ELF files built once, one actual VM, identical environment and original
resource/admission/closure gates. Fresh fixture identities and block scheduling
still differ. The controller strictly binds the mode, actual inventory, callback
bound, raw original report and case receipt, refusing an unselected mode or a
changed queue before entering the next case.

```sh
python3 -B scripts/loadtest/supply-linux-window.py \
  --prepare-pair --pair-kind native-submit8-data64 \
  --profile supply-2048x1-data64 --transport grpc --observer-phases
```

Preparation starts no workload. Original workflow routing registers
`paired-native-submit8-data64`; a future exact-source grant would use the original
six inputs with that pacing value, grpc/data64, observer timing true and the
unrelated standalone prefix input false. Other workflow booleans remain false.
Case45+15≤60s/pair120s including fsync/closures, owned10/nine children, RSS1GiB,
threads320, case64MiB/pair128MiB, original logs/build bounds and fresh native
memory/disk floors remain. No new network dispatch or resource increase follows
from this source change.

## Actual local execution and counterexamples

The retained RED shows the old controller accepting a report with an unexpected
`nativeSubmit8=true` marker as control (`RuntimeError not raised`). The new gate
refuses this mismatch, marker/type drift, inconsistent4/8 worker counts, widened
queues, altered observer pools and callback peaks beyond8. Existing first-case
UNKNOWN, cleanup, hash, fixture, phase and post-fsync failures still stop the
second case. The pair fault fixtures are synthetic and launch no nodes.

Local gated worker execution ran16 inputs at4 and8 submitters, each with four
observers. Actual callback peaks were4/8, all16 callbacks started and returned
exactly once, and the unaccepted index was observed zero times. Actual submission
queue capacities stayed16/16 and observation capacities stayed[16,16,16,16] on
both sides. This validates scheduling bounds and no replay; it is not signed
business TPS or BFT performance. Race checks passed in1.629s.

Controller73 tests passed in7.645s. After changing readout validation, rereading the
original39973570392 two signed fixtures/all4096 rows reproduced exactly the old
measurement and CPU/occupancy facts; it did not rerun the workload.

## Regression failure repaired without changing measured time

The first complete client regression failed in
TestObserverPhaseTimingActualSignedBlockAndReadbackCounters/tx_query: one
`validators_query` call had0 errors and0ns duration. The pure in-memory RPC stub
can finish inside one platform monotonic clock tick. That original FAIL remains
in client-regression-pass.raw despite its preselected filename.

Only the timing fixture now opts into crossing an actual monotonic tick inside
the same original RPC call. Positive-duration, exact-call/error, signed block and
business assertions remain unchanged. Production observedCall/time.Since code is
byte-identical; there is no artificial1ns clamp, retry, RPC or benchmark delay.
The targeted signed block/readback test passed20 repetitions in1.945s, followed
by the complete client regression PASS12.506s. This fixture-only wait is not
network latency evidence.

## Retained evidence and remaining work

[Machine evidence](evidence/native-submit8-source-local-20261023-actual.json):
7456B, SHA256 1febed311a0feefd53c74439ea79983f2b671d1b0f22cc5b3b391829b93a4601.
It pins the real local worker samples, both RED records, final passes, original
timer bytes, changed source and historical compatibility check. Raw logs remain
under artifacts/chain-performance-20261017/native-submit8-source/.

The new source must pass its own normal CI and receive a new exact Root window
before four-node measurement. Preserve original input/result rows, all8 node
logs, worker/queue/CPU/RSS facts and negative latency/error samples in that run.
Neither this source nor the previous finite result proves sustained1000 effective
final TPS, ten-minute stability or the higher3000–5000/10000+ goals.
