# Explicit native-copy client and same-VM pair entry

Source b8ae642db162ad1293595cd7eff799f2fe30c533 wires the previously measured
private-copy candidate into the original client, controller and workflow.
Internal tree af2931e0c9109da5ef37d947894bfbe92aa1418b; client tree
af253ce4ba22f80f7d2f822e3656f5fcbeb94d1d. The preceding source CI 39969058651
completed SUCCESS at ccb10e64eba3e3a0c86967999e763248660f9102. This new integration
requires its own normal CI and a fresh Root grant before any network window.

## Selection and measurement

The binary accepts `-prefix-native-clone` only with explicit
`-prefix-durable-replay`, which retains the original paced, single-round,
block-scan, observer-timing, reader-size and no-shared-replay restrictions.
Unselected reports omit the new mode/cache fields and retain the original ten
phases. Selected reports bind `prefixNativeClone=true`, eleven phases including
actual `privateNativeClone` calls/errors/nanoseconds, and the retained cache
inventory. Each private copy still runs full Validate. Native mathematical
signature verification, canonical output, fee/nonce checks and quorum/durable
business acceptance retain their original paths.

Cache inventory reports snapshot presence, canonical byte length, height,
account count, complete fee-event count and Lots entry count. It holds the decoder
gate while reading and supports cancellation. Returned telemetry objects are
private copies. These are object counts, not an estimate of decoded heap or RSS;
the original process sampler charges the additional retained snapshot memory.

The controller rejects unexpected mode flags, boolean-as-integer counters,
missing or extra phase fields, inconsistent branch/validation counts, child time
exceeding the original parent, absent/stale/inconsistent cache inventory, and
selection drift between case receipt and original raw client report. The bound
native-only workload must actually exercise native reconstruction. Other-domain
fallback remains available in the decoder; it is not accepted as a native-copy
comparison without the required original native fixture and telemetry.

## Same-VM comparison, preparation only

The registered `prefix-native-data64` pair runs `prefix-control` followed by
`prefix-native-clone`, sequentially on one actual VM and one set of four ELF
binaries built once. Both use prefix replay and the same signed workload policy;
only native-copy selection differs. Fresh fixture identities and block scheduling
still differ. Existing shared-prefix and other comparisons remain available.

```sh
python3 -B scripts/loadtest/supply-linux-window.py \
  --prepare-pair --pair-kind prefix-native-data64 \
  --profile supply-2048x1-data64 --transport grpc --observer-phases
```

This command prepares a recipe and starts no nodes. Workflow routing uses the
existing `run_linux_supply` action, with `linux_supply_pacing` explicitly set to
`paired-prefix-native-data64`, grpc, supply-2048x1-data64, observer phases enabled,
and the unrelated standalone `prefix_durable_replay` input false. It does not add
an automatic trigger, retry, fallback or a resource increase.

Limits remain case45s active +15s cleanup including fsync≤60s, pair120s including
metadata fsync and double empty closures, ten owned processes/nine children,
1 GiB RSS, 320 threads, case64 MiB data, pair128 MiB retained, case1 MiB logs,
pair2 MiB logs and build1 GiB. Original native memory/disk floors and initial
aggregate reserve remain. Failure/UNKNOWN, changed binary/raw hash, business,
signature, mode, phase or cleanup failure refuses the next case. Generic native
resource annotation fields are provenance; they do not replace the original
effective case timers and owned-process limits.

## Actual focused evidence

Before the controller repair, an explicitly native-marked report was accepted
under control selection. The retained RED test failed with `RuntimeError not
raised`. It now passes because unexpected native selection is refused.

A real signed transaction was executed and committed into a private journal,
then read through two private stores using the new client configuration. Native
clone/full validation counters, original business results and mathematical
signature facts passed both Go assertions and the Python strict telemetry gate.
Actual retained inventory: height2, six accounts, one fee event, three Lots
entries and 3984 canonical bytes. This is an offline readback, not new network TPS.
Parallel/race checks also verify caller telemetry mutations cannot change future
reports.

The original four-node 39964428468 raw4096-transaction readout was recomputed with
the new controller and was exactly equal to its retained original readout.
No historical result was rewritten or reclassified. Pair orchestration fault
tests use synthetic fixtures and launch no nodes; they preserve first-failure,
cleanup, UNKNOWN, hash, signature/fixture, phase, native-mode, cache and fsync
refusal behavior.

Focused results: controller70 tests PASS/6.646s; prefix plus native client tests
PASS/0.945s; corresponding race tests PASS/2.402s; complete client regression
PASS/12.355s; cache inventory cancellation PASS/0.433s. The source qualification
gate independently checks current trees against the committed derivation and
retains the frozen original diagnostic guards.

[Machine evidence](evidence/native-clone-client-integration-20261023-actual.json):
10317 bytes, SHA256 db8a030a17040d0b209395552230765d622b1cdddb6c9d1fb9e38d9403c18a57.
Original logs, cross-checks and the RED remain under
artifacts/chain-performance-20261017/abci-drain-window-source/. Prepared recipe
and provisional pregrant contract are under native-clone-window-source/.
The code-source contract is not a final dispatch grant; final CI-qualified HEAD
and fresh actual resource conditions must be bound before Root schedules it.

No four-node run was dispatched in this integration step. The earlier local
17.49% copying-pipeline improvement remains a local result at its stated source
and conditions. Actual sustained1000 effective final TPS, ten-minute stability
and queue-inclusive final P95≤3s remain unproven.
