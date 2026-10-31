# Fixed original-input height CI preparation

This is a source-only handoff to the original Root. No Go compilation, replay,
network download, input signing, dispatch, node or pressure run occurred here.
It does not modify or replace the chief's four-scope source comparison.

## Placement and exact dependencies

Root may copy this directory (except this handoff's result/manifests if desired)
to `scripts/loadtest/pq-height-ci/`, and copy `pq-height-vectors-ci.yml` to a new
workflow path. The primary/index and current workflows were not edited.

`vendor/consensus-linux-cohort.py` and `vendor/pq-paired-linux-window.py` are
exact bytes from tools `9c22b0700d4e21f7fc35ec3067339722fb8bc330`.
`vendor/pq-source-artifact-intake.py` is the exact frozen original intake from
`f27df72412fca7f5329b1e16c3ce209e6ed20d16`. Bootstrap imports check all three
SHA256 values before executing them. The isolated intake namespace adds one
closed filename catalog; ZIP framing/CRC, API metadata, official digest,
signed-redirect handling, size limits and extraction code are unchanged.

The normal hosted arm checks out tools9c22 and the selected source inside the
original Window, then uses the upstream prepare/run/compare unmodified:

| arm | commit | tree |
|---|---|---|
| before | fdc08527514587d5756264e43ab63588791e189a | 883069d6f4c123d55dea797044186e6b7de2ad0e |
| after-a | b77a3df453d880ab31aca99ce94fc9a7feb4fffb | 1ab3bcca16cd7335866231af1554b9a27a0ea049 |
| after-b | b2120f6a0dc65666145cc9976b9f13d8b175f34d | 3d083b7da930d86c3312024268b846312341d95c |

The old source artifact is ID13042588614 from run41202295972, exact ZIP139140942
bytes, SHA256 `b1ebf76cbb3bf3819e4f111ec48ac640e84ff5dc3d5279b6a53220303446ccd1`.
The only input is the already signed `baseline-input.json`, SHA256
`c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401`.
After arms consume the actual successful new before artifact in the same run,
bound by Actions artifact ID/digest/name/current workflow SHA. They do not
re-download the old ZIP or generate/re-sign another corpus.

## Exact normal commands

An explicit dispatch defaults to **compile-only**. A push on the exact isolated
`codex/ynx-pq-height-vectors-20261101` branch executes **replay**, then the two
fresh after arms only after the new before succeeds. With the exact controller
checkout and setup-go1.26.10 already present, Root can use:

```sh
python3 -B scripts/loadtest/pq-height-ci/test_pq_height_ci_arm.py
python3 -B scripts/loadtest/pq-height-ci/pq-height-ci-arm.py arm \
  --arm before --mode compile-only --operation "$RUNNER_TEMP/pq-height-before" --execute
```

This performs fixed tools/source checkout, original prepare and this real
compile command in the prepared source directory under the same Window:

```sh
go test -overlay "$PREPARED/height-overlay.json" -mod=readonly -p 1 \
  -c -o "$OPERATION/.private/bin/height.test" ./internal/consensus
```

The minimal compiled source closure is original tracked `go.mod`, `go.sum`,
`internal/`, `third_party/cometbft/`, plus the three upstream overlay leaves
`pq_baseline_probe.go.in`, `pq_baseline_test.go.in`, `pq_height_vectors_test.go.in`
and exact upstream entry observers prepared by `prepare-pq-baseline.py`.
No native key material, node, C archive or production signing source is needed.

Only Root may push the isolated replay branch or explicitly select
`mode=replay` in the supplied workflow. It serializes before then fresh
after-a/after-b jobs. The binary's exact selector
is `-test.run=^TestPQPerHeightVectors$ -test.count=1 -test.timeout=780s -test.v`.
An exit0/manifest alone is insufficient: exactly one RUN, one PASS, terminal
PASS, no SKIP/zero-hit/additional tests, the actual owned compile/test PIDs and
startTicks, all41 records and all original vectors must validate. No output
from an old case's last height substitutes for an intermediate height.

## Resource and evidence boundary

Unchanged original Window: two CPU affinity slots, GOMAXPROCS1, aggregate
RSS4GiB, new storage8GiB, total900s including15s cleanup, initial MemAvailable
6GiB, initial disk16GiB, runtime disk floor1GiB, each log4MiB. These are sampled
limits, not a cgroup guarantee. There is no cap override or ignored heavy
process. Source/tool checkout, download/unpack, prepare, compile, replay,
strict JSON readback and original comparison are all within the outer Window.
The original height runner additionally retains its own unchanged Window and
the9c22 post-child resource Monitor. No pre-child `go env` or observer thread is
introduced. Original process PID/startTicks/return/signal and resource samples
remain in `HEIGHT-CI.json`; failures and partial public vectors are retained.

The small controller checkout and setup-go are CI bootstrap. Their workspace,
RUNNER_TEMP and resolved Go toolchain roots are counted, with only duplicate
ancestor storage roots normalized. Toolchain setup CPU is not claimed as arm
execution. Public upload is exactly the runner's public subtree and bounded
outer logs/receipt, never `.private`, source archives, module caches or secrets.

Successful height output has a closed88-file catalog: original input, two
actual logs, manifest, inner receipt,41 state files,41 record files, outer
receipt. The comparator checks complete responses and states/accounts/nonces,
AppHash, ancestry and normal constructor reloading. It does not establish BFT
finality, cold-process timing, throughput, protected signing or pressure grant.

## Fixed observer semantics; production admission unchanged

This module pins original Perf's `9c22b0700d4e21f7fc35ec3067339722fb8bc330`,
including the static nonce expectation correction and all earlier resource
monitoring. The old842 source and preparation are retained separately.
The frozen valid history includes16 same-owner Whole transactions in each
block. CheckTx/recheck read unchanged committed state, so only the first
next-nonce transaction succeeds; subsequent future nonces are correctly
rejected with original outer CodeInvalidTx2 and exact per-member nonce errors.
The observer decodes signed owner/nonces, compares complete responses and
proves admission leaves committed state unchanged. Its Python parser checks
expectations independently from the prior height's account nonce map. Proposal
and Finalize still require the complete original transaction order and every
business member admitted. No production rule, signature, input or prior
baseline is modified. The hosted entry requires exactly nine original fixture
controls with zero skips before the first real compile/replay.

## Local preparation validation

The controller's existing eleven pure intake/parser controls are run with the
available `/opt/homebrew/bin/python3.13`. The prior preparation's default Python
exit137 is retained in its original source receipt. No Go compilation, actual
Window, download, signing, node, hosted dispatch or real replay occurred in
this preparation. The source receipt records the current actual control result
and the exact updated leaf map; a later hosted result must stand on its own.
