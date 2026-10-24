# Native current input reuse candidate

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
exact single-use scheduling grant. No such execution or network speedup is
claimed by this source change. The 1,000 valid final transactions/s for ten
minutes and P95 finality <=3s targets remain unachieved. Node completion/client
clock metadata likewise requires an actual same-run identity join before it
can establish node-stage latency.
