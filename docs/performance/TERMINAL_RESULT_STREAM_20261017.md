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
