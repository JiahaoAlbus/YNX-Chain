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
