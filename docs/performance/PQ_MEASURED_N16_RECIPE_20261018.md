# Production phase consumer and proposed single N16 paired window

Status: source prepared for review; **no new Go compilation or pair execution**.
The fixed production API was supplied after Run13 package correctness PASS at
`6a3b8f813bcc5a2ee8ab0280783b6ebddf3d9c71`. The original Run10 N1 results,
frozen source commits and raw artifacts are unchanged. Do not rerun N1 here.

## Source behavior

The existing paired overlay now calls `SubmitPQBatchMeasured` for the original
Whole request and retains the returned call-local `wholeMeasurement`. It checks
wire hash, original result/height, actual two signature checks, all N successful
member evaluations, every production phase and both durable file boundaries.
Published metadata must equal the ledger's actual final checkpoint pointer.
The outer API/loop timers stop before these measurement assertions. Replay and
cold restore retain their existing independent correctness checks.

The standalone-member path still uses the ordinary production member API.
Whole timing therefore includes its instrumentation overhead; the report must
retain that asymmetry. The phases are inclusive wall times, not CPU time, and
parent/child values cannot be added. Local pending checkpoints, manually
produced local blocks and cold restore remain separate from BFT finality. The
report keeps both BFT counts and consensus latency null.

The original preparation recipe now requires the measurement API/version in the
fixed Git object and pins the actual production implementation files. Dirty or
older source cannot silently substitute a working-tree helper. Preparation
starts no Go process and does not grant execution.

## Explicit guard scope

The Linux guard defaults to N1/trial1 for compatibility. The proposed N16 case
requires **both** a measured N16 prepared file and explicit `--case-n 16`.
Default scope refuses N16; N64 and other cases remain unsupported by this guard.
The CLI flag only selects the expected case; it is not scheduling permission.

All original caps remain: active105s + cleanup15s within120s; sampled owned RSS
1GiB; 16 owned processes/320 threads; 32MiB private data; 1GiB compiler scratch;
1MiB logs; original actual disk floor/reserves and Linux MemAvailable floor.
Source pins, birth identities, subreaper ownership and two-empty-scan cleanup
are unchanged. Sampled RSS is not hard cgroup enforcement.

New result checks require the original measured result, exact wire/member hashes,
phase counters and decimal int64 nanoseconds, successful snapshot **and marker**
boundaries and published local checkpoint. They do not infer execution or BFT
from a formatter fixture. The existing actual snapshot SHA/readback gates stay.

## Concrete next commands for the original CI owner

First import the six exact owned files in the accompanying source manifest into
a clean approved production descendant. Choose and record that exact resulting
full commit; do not use a moving branch or this dirty development checkout.
Use the original correctness CI for a compile-only overlay check (`-run '^$'`)
without executing the paired test. Root must schedule that step.

For a later **fresh Root-authorized** single N16/trial1 window, use a new private
case directory outside the source checkout:

```sh
node scripts/loadtest/prepare-pq-paired-benchmark.mjs \
  --source-root "$GITHUB_WORKSPACE" --commit "$EXACT_APPROVED_HEAD" \
  --output-dir "$RUNNER_TEMP/pq-n16-trial1-new" --n 16 --trial 1 --write
python3 scripts/loadtest/pq-paired-linux-window.py \
  --prepared "$RUNNER_TEMP/pq-n16-trial1-new/prepared.json" \
  --receipt "$RUNNER_TEMP/pq-n16-trial1-new-guard.json" --case-n 16 --execute
```

This recipe is a proposal, not a grant. No next N, trial, retry or ten-minute
window follows automatically. Keep snapshots private; retain only result,
guard, source pins and bounded logs in shareable artifacts. If the same 32MiB
cap refuses N16, retain the refusal and measure its cause; do not lift the cap.
A single finite pair still cannot establish 1,000 valid final commits/s.

## Lightweight evidence

Actual Node RED: a recipe missing the committed measurement API was accepted;
new requirement repaired it. Four recipe tests now pass. Actual Python REDs:
explicit case argument absent, then production-result qualifier absent; after
repairs all thirteen guard controls pass. These use synthetic proc/format files,
no Go, kernel probe, PQ signature or business acceptance. The `.go.in` was
formatted; it remains uncompiled pending the original CI step.
