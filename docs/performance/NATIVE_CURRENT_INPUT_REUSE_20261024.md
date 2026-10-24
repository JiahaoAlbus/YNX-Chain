# Native current input reuse candidate

Latest evidence: frozen147eae73e/run40047424926 completed the original qualified
same-VM/four-ELF8192x2 pair. Effective final rate229.240→252.644/s (+10.21%),
CPU−13.24%, sampled peak RSS+2.75%; sustained1000TPS/600s remains unproved.
See [complete comparison](NATIVE_CURRENT_INPUT_PAIR_COMPARISON_20261024.md).

The original forty-second four-node attempt (run 40037942357, source
`d6fb96d3ef08ac25e755695cba1a3701d3a8a244`) timed out before completing its
first relative-paced side. Its second side never started. The failed partial
measurement recorded 7,665 effective final transactions (194.3167/s), reader
gate wait 21.4970s, gate hold 20.3604s and decode 18.0288s. These overlapping
durations are not additive. This is a diagnosis, not a completed workload or
an A/B result.

The new explicit `-native-current-input-reuse` candidate removes duplicate
decode, replay, full-state validation and index construction when two current
files of the same private reader have exactly identical captured bytes. Both
the original full-file hash and a fresh captured-byte hash remain mandatory;
the candidate additionally checks current path/inode/permissions/size/mtime
under the original journal read lock. Every miss follows the original path.
Per-transaction signatures, fee and nonce facts, published Info and finality
gates remain unchanged. The original serialized reader mutex remains in place.

Only the existing at-most-four private slots can supply immutable state and
indexes. There is no global cache or additional generation. Retained encoded
input is conservatively charged per slot to the original cache budget and
released on original eviction. A lagging current peer cannot lower the prefix
decoder high-water mark. The flag defaults off in the Go client and is accepted
only in the registered native streaming profile with a nonzero cache budget.

## Local evidence

`TestNativeStreamingCurrentInputReuseAvoidsDuplicateDecode` first reproduced
two full validations for two identical current stores. The candidate produces
one validation and one cross-slot hit, while both transaction verifications
still run. Independently executed signed/committed stores produce the same
store, state and snapshot hashes with the flag off and on. These are local
application/reader tests, not a four-node throughput measurement.

Race-enabled coverage also checks subsequent signed state updates, immutable
peer publication, high-water preservation, invalid signatures, fee/nonce and
chain scope rejection, cancellation, concurrent observations, inode replacement,
truncation and cache release. The retained raw files are under
`artifacts/chain-performance-20261017/native-stream-small-source/`:

- `native-current-input-red.raw`: original duplicate-validation failure.
- `native-current-input-final-all.raw`: seven candidate tests, PASS.
- `native-current-input-complete-regression.raw`: original reader/native stream
  and readback race regression, PASS (13.758s).
- `native-current-input-pair-final.raw`: nine controller pairing tests, PASS.
- `native-current-input-zip-pair-final.raw`: 21 artifact tests, PASS.

## Next original-controller measurement

The registered `paired-native-current-input` workflow route uses the original
controller and resource/cleanup gates. It runs 8,192 planned transactions per
side on the same VM and same four node binaries. Both sides use bounded-cadence;
the first disables reuse and the second enables it. An incomplete first side
prevents the second from starting. Source, actual command, plan, report and
artifact reader bind the selected boolean. Existing UNKNOWN records, terminal
failures and cleanup evidence remain authoritative.

Prepare without nodes:

```sh
python3 -B scripts/loadtest/supply-linux-window.py --prepare-pair \
  --pair-kind native-current-input --observer-phases --transport grpc \
  --profile supply-native-stream-2048x4
```

Actual four-node execution requires Root's fresh pressure-level-1 slot and
exact single-use scheduling grant. The subsequent qualified finite run is linked above;
it provides a measured finite improvement, not sustained target qualification. The 1,000 valid final transactions/s for ten
minutes and P95 finality <=3s targets remain unachieved. Node completion/client
clock metadata likewise requires an actual same-run identity join before it
can establish node-stage latency.

## First cache-pair attempt: controller deadline identity defect

Root's new single-use grant dispatched the frozen `7c4cac62a` source once as
run 40044977213. The first bounded-cadence/cache-off case started nodes, then
the original consumer rejected `streamingWorkload.maxRuntimeMs`: it still
expected the old literal 30000, although the selected client command, plan and
producer report use 40000. The synthetic composite test had repeated that old
literal, masking the real producer/consumer mismatch.

The original failure remains authoritative: case36.268s, pair36.576s,
second side not started, no A/B qualification. Original terminal frames retain
post-fsync samples and two empty owned scans for launcher38995/startTicks70748.
Full selected artifact recovery/readback is a separate gate; this diagnostic
does not turn the original failure into a successful experiment.

The owning controller repair derives workload maxRuntimeMs from the original
`STREAM_BUDGET.timeoutMs` and also binds top-level report timeoutMs to that same
selected budget. It changes no timeout or resource allowance. Updating the
composite fixture to the real40s producer shape reproduces the original RED;
the repaired reader accepts it and rejects stale30s, off-by-one, bool and null
values. All88 original controller source tests pass. Raw RED/green/full results
are `native-original-max-runtime-{red,green,controller-all}.raw` in the original
small-source artifact directory. Any next network attempt needs a new frozen
source, successful original CI and a new Root grant; this consumed pair cannot
be reopened to start its second side.
