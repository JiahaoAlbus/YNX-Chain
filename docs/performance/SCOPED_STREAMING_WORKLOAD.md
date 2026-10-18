# Explicit bounded streaming workload

The existing performance client now accepts `-streaming-workload` together with
`-evidence-byte-budget`. This profile requires ready-pool, block-scan, four
affine observers, slot reuse, segmented signed intents, terminal streaming and a
new exclusive output. It changes no public endpoint or chain-state format.

The default mode retains its 2048 transaction, 32-cycle and 30-second limits.
The explicit profile has intersecting ceilings of 2048 sender slots, 4096 cycles,
1,000,000 records and 15 minutes. A pool's nonce ceiling is its actual selected
cycle count. Funding must cover two YNXT per cycle per newly generated sender;
existing manifest/key/chain bindings and nonce-zero requirements remain in force.

For planning only, 2048 disposable accounts times 293 cycles yield 600064 signed
inputs. At an offered rate of 1000/s, the minimum continuous offering span is
600.063 seconds. This arithmetic is neither measured throughput nor a scheduled
run. The existing short four-node launcher keeps its original workload, duration
and resource caps and cannot silently execute this larger profile.

Each sender owns one slot and one in-flight nonce. Only that account's complete
qualified prior result permits signing its successor. Unknown/rejected/failed
accounts remain quarantined. Signing and nonce advancement never run in a worker.
A signed wave is persisted before dispatch; failed/uncertain I/O poisons its writer.

The explicit combined encoded-evidence budget is positive and at most 2GiB.
Signed and terminal writers share it, charging before I/O without refund/retry.
Each stream also has a 1GiB ceiling. Allocated blocks, metadata, chain databases,
logs and the report/plan are separately charged to the externally scheduled disk
window; encoded bytes are not an estimate of total disk consumption.

An exclusive public plan is file-synced and directory-synced before dispatch. It
binds manifest/genesis/migration, initial signed hashes, counts, required funding,
evidence budget and timeout. It contains no private keys. The original exclusive
fixture claim survives all errors; a plan does not authorize recovery submissions.
Client report schema14 is used only for this explicit profile. Chain state remains
V13 and no published integration contract is changed. Legacy schema12/13 complete
array readers continue rejecting this report format.

Completed evidence is checked without a lifetime array: a verified signed-intent
producer is joined to terminal rows with at most sender-count plus one wave of
pending identities. Both complete inventories/hash chains, signatures/nonces,
exact signed bytes and last-account slots must match. Counts alone never suffice.
The two inventory byte totals must match the shared writer's charged budget; the
public plan hash must still match. Any failure leaves EvidenceVerified=false.
This is retained observation verification, not independent BFT/state replay.

A 102-input application test crosses 34 cycles using three fixed slots, performs
real CheckTx/Finalize/Commit and verifies restart state and nonce replay refusal.
Its quorum observations are synthetic inputs to the controller interface, not
network evidence. Other controls cover funding, old/new scope separation,
UNKNOWN, partial writes, stream identity substitution and plan exclusivity.

Default durable reads remain limited to 16MiB. The explicit streaming profile can
select `-durable-store-byte-limit` from 16 to 512MiB, coupled with an explicit
`-durable-cache-byte-budget` up to 2GiB. The cache budget counts the actual input
bytes represented by retained validated states, not physical RSS. Large-mode
capture/decode is serialized. LRU eviction clears the old state and fee/nonce
indexes; every later use still hashes the current file and runs the original
decoder, state validation and transaction checks. A failed current read cannot
return an evicted or older cached result. The selected limits enter the durable
public plan and the reader reports its encoded-input occupancy and evictions.

Raw capture, reconstructed state, indexes and decoder temporaries can coexist in
RAM. An input-byte budget is not a heap/RSS ceiling; the externally scheduled
window must still enforce its separate observed RSS and allocated-disk budgets.
This does not change the storage backends' own frame/payload limits.

The large-reader source controls use a valid V2 checkpoint around one real
executed transfer, enlarged with synthetic JSON whitespace. They test the byte
boundary and eviction logic, not actual large-history throughput. A matching
client binary, gradual four-node trials, real history and fresh Root resource
coverage are still required. Steady-state TPS is not automatically asserted by
selecting the profile or completing a record count.

### Explicit lossless terminal storage

`-terminal-gzip` is default off and requires the complete explicit streaming
profile. The durable public plan binds `terminalEncoding=gzip` before dispatch;
the terminal receipt records actual encoding and cumulative compression wall
time. Original JSON header, every full result field/signed input/status/error,
footer and row hash-chain inputs remain unchanged. Each sealed segment is one
gzip member at BestSpeed. File names/inventory, exclusive creation, Sync and
failure poisoning remain in the original writer.

The original1GiB per-stream and2GiB combined evidence budgets charge actual
encoded bytes before persistence, without refund or retry. Readback retains the
original segment expansion limit, rejects CRC failure, truncation, trailing
bytes/multiple members and unknown encodings, then runs the original transactional
decoder and signed-intent join. Legacy schema12/13 complete-window restoration
refuses compressed receipts. Legacy partial readers remain fail closed on
unsupported compressed data; compression does not authorize re-submission or
upgrade UNKNOWN after a crash.

The [source evidence](evidence/terminal-gzip-source-local-actual.json) records
ordinary and gzip102-transfer/34-cycle real CheckTx/Finalize/Commit, fee/nonce
readback/restart tests (unit quorum flags are synthetic). Separate controls retain
identical unknown rows/hash chains and check corruption, expansion, budget and
partial-write failures. These are source controls, not network capacity.

An explicit offline measurement fed existing pinned1024 public result rows from
run39154351784 through the real Go writer/Sync/decoder:2631664 plain bytes versus
546903 gzip bytes,16 segments, identical row chain and all result fields.
Compression timers totaled16066917ns. This used an encoding-only binding and
retained index order, not original unrecorded hand-back order. It performs no new
business execution and gives no future600k-row, state/history, allocated-disk or
peak-RSS upper bound. Compression/Sync remain inside terminal-sink and full
workload timing. A larger or long network profile still needs actual resource
qualification and Root scheduling.

### Opt-in durable readback phase timings

The explicit coupled store/cache profile reports `phaseTotalsNs`: cumulative
monotonic wall time for fresh-file hashing, capture (including the second hash
and writer-lease release), complete decode/validation/replay, index construction
and publication, and transaction signature/fee/nonce checks. `loadNs` includes
file and lease checks plus hashing/capture/decode/index; do not add it to its
child phases. Timings exclude the outer profile/slot mutex wait. Failed attempts
retain time in the active phase without producing valid transaction evidence.
Legacy readers leave this optional field absent and do not take phase clocks.
These diagnostics measure the observer's costs, not inclusion or BFT finality.

The opt-in profile also retains up to 2,048 successfully verified native signed
inputs, with a separate 2 MiB retained-string ceiling and FIFO eviction. Facts
bind the chain ID, SHA-256 and exact input bytes; returned transaction values
contain immutable strings. Invalid signatures are never retained. Cache hits
reuse cryptographic facts only: every observation still hashes the current file,
validates a changed generation, and checks current fee membership and nonce.
`signatureFacts` reports actual crypto checks and reuse independently from
`transactionVerifications`, which counts cryptographically valid target checks.
A later fee/nonce rejection still contributes, so this counter is not a count
of business successes.
The default legacy reader does not enable this cache. This candidate does not
change the frozen four-node comparison binaries or the internal consensus tree.

The actual-history measurement now compares two independent explicit-profile
readers on the same store and last signed batch. Each reader has identical
32 MiB file/cache bounds (64 MiB combined encoded-input cache budget). Only the
test baseline disables signature-fact reuse; there is no new production CLI
switch. Both cold observations must agree on store/state/AppHash, then warm
batches run uncached/cached/cached/uncached. Every mode must perform three fresh
full-file hashes, one complete state validation and three batch fee/nonce checks.
The warm target observations repeat existing transactions, and do not increase
the business-transaction count. Cold ordering and individual samples remain in
the report. The existing 210-second context, 240-second test, transaction cap,
real-history stop condition and default-disabled macro selection remain intact.

### Remaining full-state validation CPU cost

The existing workflow has a separate default-false `profile_state_validation`
input. It only acts inside an explicitly selected real-history measurement;
normal CI does not perform that macro. After the unchanged actual-history and
state/account/fee assertions, the test can sample calls to the original public
`CommittedState.Validate` on that exact decoded state. It schedules at most 32
calls and stops scheduling after two seconds or the parent deadline. A running
validation finishes before the next deadline check; CPU-profile stop/drain time
is recorded too. The original 210/240-second enclosing limits remain intact.
The profile writer rejects output beyond 1 MiB, preserves any partial file and
propagates original validation/output errors. Output is a CPU stack profile,
not a heap dump; no temporary keys/seeds or transaction arguments are captured.
This diagnostic does not replace any validation or alter the internal tree.
A controlled real-state light test checks original failure propagation, state
immutability, readable compressed output and exclusive evidence creation.

Selected CPU diagnostics additionally upload a small dedicated artifact with
only the bounded CPU profile, rendered top stacks and public result JSON. The
complete actual-history artifact is retained separately. This avoids requiring
a full history download when the artifact service does not support ZIP ranges.
The top-stack renderer runs only after successful selected measurement, with
one Go process and a 128 MiB Go memory target; incomplete profiles/results are
still retained by the always-run small upload step. Normal runs skip both steps.
