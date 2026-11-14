# PUBLIC diagnostic coverage fence

This is QA-only observation/control, not a route qualification or LeakSafe proof.
The byte/line/event/time budgets remain unchanged. The SF Browser adapter now
checks coverage independently of returned events. At exactly256 phase events,
any other exhausted budget, or producer LIMIT_REACHED, it records the first
`diagnosticCoverageIncomplete` cause and synchronously fences the original
adapter generation and requests its existing stop path. It does not classify
this condition as a policy rejection or network failure.

The retained first cause includes the original generation, pipe receipt monotonic
time and MainActor processing time. These are different times. The latter is a
control request, not proof of an instantaneous kernel egress block. Original
Process exit and known managed-PT absence remain separately observed.

`monitoringCoverageAvailable=false` can occur at the exact budget even before an
additional event is lost (`coverageTruncated=false`). Both summary fields use a
single clock sample. Earlier verified policy failure wins; late old-generation
callbacks cannot replace the retained failure or activate another attempt.

## CI

After building the same-cohort QA full Core, run:

```sh
/usr/bin/python3 apps/browser/privacy-routing/tor/tests/test_snowflake_coverage_fence.py \
  --qa-core-products "$QA_CORE_PRODUCTS" \
  --output "$RUNNER_TEMP/tor-coverage-fence"
```

No local WD artifact is required. CI snapshots the real Native/dependency sources,
compiles the same harmless sleep-only child from this repository, and runs two
actual SDK cases: event-budget exhaustion before a257th benign line and late
policy fatal, and producer LIMIT_REACHED. Each case must observe the original
child exit; no Arti/PT, GUI, DNS, URL, Root or authority is started.

Optional `--legacy-native <immutable-original-native-directory>` enables the
actual old cohort counterexample, with the original49ad source-manifest pin.
Absent legacy input is reported NOT_SUPPLIED_NOT_RUN; no counterexample is
fabricated. A valid RED requires actual old SDK execution/expected exit1 after
showing that its cap hid the later fatal, followed by original-child cleanup.

For a parent resource-guarded local run, `--frozen-source`, `--module-cache` and
`--harmless-fixture` permit immutable sources, a managed cache and already-compiled
harmless bytes. Existing compiler/process-group resource limits still apply.

The original App30 trace remains unchanged: its exact truncation transition was
not recorded; only the last retained phase to the first truncated summary bounds
that unknown interval. No network rerun is needed or authorized by these tests.
