# Bounded terminal-result evidence stream

`-terminal-stream` optionally connects the ready-pool controller's terminal
handoff to an evidence sink. Its new directory is `<output>.terminal-stream`;
existing directories or segment files are never reused. The default path is
unchanged. This stage does **not** remove the client's full-history result
arrays, raise any CLI/run cap, or provide a ten-minute driver by itself.

The single controller writes each terminal result after the submit/observation
workers hand ownership back, before permitting that sender's successor nonce.
All statuses, including UNKNOWN, timeout and not-submitted cancellation results,
are retained without promotion. A sink error is a run error and prevents any
subsequent nonce signing; existing in-flight work is drained normally. Signed
intent identity still uses the original pre-dispatch Sync journal and immutable
claim. Terminal output never replaces admission or recovery authority.

At most 64 pending rows are retained; each JSON row is at most 64 KiB. A row
contains the original transaction result, a sequence and previous row SHA-256.
Every segment has a manifest/migration/genesis-bound header and a seal with
record count and terminal chain hash. Each sender's terminal rounds must advance
once in order, without a lifetime-sized duplicate map. Each segment is exclusively
created with mode 0600, written, file-Sync'd, closed and directory-Sync'd before
the durable record watermark advances. The final partial segment is sealed at
normal controller return. Write, short write, Sync, close or directory Sync
failure poisons the sink; no replacement or retry is attempted.

The report separates accepted records, durable records, segment count, persisted
bytes, terminal chain hash and poison state. A crash may leave up to 63 pending
rows absent from the terminal stream; those outcomes must be reconciled against
the original signed intent journal and durable node state. A segment containing
a seal but lacking observed successful Sync is still an uncertain write, not a
fabricated durability acknowledgment. Partial segments must never be silently
counted as sealed evidence. The hash chain detects corruption/reordering when
checked against trusted fixture bindings and the reported final chain; it is
not a signature or a consensus proof.

The sink has a one-million-record internal ceiling for later bounded slot reuse;
current CLI workload limits remain **2,048 total / 32 cycles / 30 seconds maximum**,
and the scheduled runner retains its smaller existing deadline/resource caps.
Its buffer costs at most roughly two 4 MiB row/flush representations plus the
current encode and per-account counters. It retains no lifetime result history.
The surrounding client still does; replacing those arrays and bounded online
metrics, signing/journal rotation, funding bounds and long-history readback are
remaining work before ten-minute acceptance.

Planned focused validation (source ready; execution awaits Root's shared-machine
slot, and must not be reported as passed until an actual terminal result):

```
GOMAXPROCS=1 nice -n 10 go test -p 1 ./cmd/ynx-consensus-perf-client \
  -run 'TestTerminalStream|TestReadySender' -count=1 -timeout=45s
```

Coverage includes 130 exact original results across three sealed segments,
independently recomputed hash chains and fixture bindings, durable versus pending
watermarks, exclusive creation/permissions, oversized/duplicate records,
injected persistence failures, preservation of existing segment bytes, and
controller stop-before-successor on terminal evidence failure. The existing
real signed execution / durable restart / fast-sender progress test also writes
and seals six actual terminal results. Synthetic unit confirmation flags remain
unit inputs and do not establish network consensus.

No new four-node workload has been started for this change. The next network
comparison requires frozen source/binary/config identities and a fresh Root
resource window; optional terminal-stream Sync overhead must be measured as
part of the complete client workload, not excluded from its throughput.

The read-only segment decoder now checks complete newline-terminated segments,
exact expected fixture/prefix binding, every row's sequence/hash and per-account
round, and the final seal/count. It retains only one bounded segment and account
counters. Invalid input leaves the prior decoder prefix unchanged, permitting
read-only reinspection of the original valid bytes without any dispatch or
resubmission. Added counterexamples cover changed status/fixture, truncation,
missing or duplicated rows, segment replay and out-of-order segments.

## First light-test admission and owned-process correction

The first scheduled light-test preflight terminated before Go was started:
`go: null`, first cause `400MiB control/owned RSS cap`, 12 ms. Direct tool
execution made PID 1093 (the shared Codex app-server, 1,074,511,872 bytes) the
Node launcher's parent. The wrapper incorrectly included that shared process in
this job's cap. Launcher RSS was 51,380,224 bytes; the measured 1,129,463,808-byte
total therefore does **not** represent Go test memory or required job capacity.
The native probe completed successfully. Both original owned PIDs/groups were
independently absent afterwards. The original failed receipt is preserved in
[evidence](evidence/terminal-stream-light-admission-failure-20261017.json).

The corrected source wrapper is `scripts/loadtest/consensus-light-window.mjs`.
It defaults to prepare-only, requires an explicit new receipt path and execute
flag, and still needs a fresh Root window. It watches only its own launcher,
all members of the actual Go process group, and recursive PPID descendants
(including compilers that change group). Shared ancestors are recorded as
excluded, not mixed into the job cap. The existing native sampler/fork-child
reserve and 400 MiB cap remain; more than 16 watched identities, invalid process
inventory or monitoring failure stop the window instead of truncating coverage.

The scope helper and existing async-probe tests passed **11/11**, 395.429 ms,
without Go or network nodes. Syntax and prepare-only checks passed. These Node
controller tests do not satisfy the pending Go terminal-stream regression.
The corrected wrapper has **not** been executed; Root queued its test after the
next Wallet full-package window. No automatic retry occurred.

```
# Only inside a fresh explicitly scheduled slot:
node scripts/loadtest/consensus-light-window.mjs --execute \
  --output artifacts/chain-performance-20261017/terminal-stream-light-owned-result.json
```

## Correct-scope attempt: real compilation resource ceiling

The separately scheduled corrected wrapper started at 15:29:47.921 UTC,
owned shell 54072 / launcher 54073 / Go 54100, session 5053. It terminated
with exit 1 after 3,094 ms on the unchanged 400 MiB owned/control RSS cap.
Peak sampled RSS was **468,533,248 bytes**: launcher 57,556,992, Go 45,383,680,
owned child 54120 at 322,912,256, children 54130/54131 at 15,761,408/23,347,200,
and native sampler/fork reserve 3,571,712. This time no shared ancestor was
included. Fresh free memory was 1,389,199,360 bytes and native fork checks passed.

Go was killed with SIGKILL and exited before producing test output. This is
**not a Go assertion failure or a test PASS**. The original group was gone;
at 15:30:08.571 UTC all 13 observed owned/sampler PIDs independently returned
ESRCH. [Original correct-scope receipt, cleanup and byte hashes](evidence/terminal-stream-light-owned-cap-20261017.json)
are preserved. The slot was returned to Root before any further compilation;
no retry or network run occurred.

For the next separately scheduled attempt the source wrapper prepares
`GOGC=50 GOMEMLIMIT=160MiB`, inherited by Go tool children, while keeping vet,
GOMAXPROCS=1, Go -p1, the exact test target, 45 s deadline plus 15 s cleanup,
and the actual 400 MiB aggregate monitor. The per-process Go memory setting is
a soft runtime target, **not** a substitute for actual aggregate measurement.
The available evidence only shows the earlier compilation crossed the cap after
three seconds; it cannot prove a cold compilation fits 45 seconds. A new
attempt must stop at that original deadline, with no automatic time/cap increase.
This changed environment has been syntax/prepare-only checked, not executed.

Latest source connects optional -reuse-result-slots and cumulative bounded interval
statistics; see [slot reporting](READY_RESULT_SLOTS_20261017.md). Default retention
remains unchanged. Go execution is still pending, so earlier implementation-stage
notes above are not new validation evidence.
