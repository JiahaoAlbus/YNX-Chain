# Actual native private-copy comparison: 39973570392

The single Root-granted four-node pair completed with both cases safety qualified.
Independent reread of all4096 original business rows, both signed input fixtures
and all8 original node logs reproduced the original receipts. Finite final TPS
increased0.801%, and queue-inclusive final P95 decreased5.176%; median final
latency, submission rate, accepted queue peak, observer errors and RSS worsened.
This is one finite pair, not sustained1000TPS qualification or default promotion.

## Exact source and physical conditions

Run [39973570392](https://github.com/JiahaoAlbus/YNX-Chain/actions/runs/39973570392),
job120482264042, attempt1, source f59c8765752c11e658d1ff6bc77d0b3a3e41b5b0,
frozen tag codex/chain-native-f59c87657. Exact normal CI39971365053 succeeded first.
Root's new grant was consumed once; there was no repeated dispatch or fallback.
Actual host was AMD EPYC9V45,4 logical CPUs, native Linux. Both cases matched
source, compiler, four ELF binaries built once, VM identity and environment.
The older EPYC7763 run is not a controlled baseline for this host.

Configuration: grpc,2048 independent nonce1 senders per side,64-byte data,
configured1000 offers/s, relative pacing, four submitters/four observers,
GOMAXPROCS1/GOGC100/GOMEMLIMIT off, phase timing enabled. Prefix replay ran on
both sides; only the second case selected private native copying. Fresh fixture
identities and block scheduling differ. All signature, fee, nonce, state,
inclusion, quorum, published-state and durability checks remained enabled.

Post-fsync case windows8282/8293ms; complete pair17066ms. Pair retained93334540B
below128MiB. Both case and pair original double-empty scans matched launcher
and startTicks. Final post-fsync verdicts were qualified with null firstCause.
The slot returned. Each side's 2048 transactions were accepted, effectively
included and qualified final, with zero rejection, UNKNOWN, timeout, execution
failure, observation failure or not-submitted outcomes. Transient observer error
occurrences remain14429/15711; they are not relabeled zero errors.

## All original user-visible results

| Metric | Prefix JSON control | Native private copy |
|---|---:|---:|
| Measurement window s |4.492295989|4.456585590|
| Actual offered interarrival/s |998.736851|996.557845|
| Actual submission interarrival/s |646.460080|639.461083|
| Full-window effective included/qualified final TPS |455.891599|459.544635|
| Offer→inclusion P50/P95/P99 ms |1294.275/2395.606/2502.699|1369.883/2309.916/2426.981|
| Offer→qualified final P50/P95/P99 ms |1593.111/2632.306/2755.661|1683.260/2496.061/2619.799|
| Submission queue P50/P95/P99 ms |41.992/1172.564/1246.183|4.369/1204.160/1247.234|
| CheckTx callback P50/P95/P99 ms |0.749/37.917/76.279|0.790/32.692/68.701|
| Offered waiting queue peak |443|372|
| Accepted observation queue peak |1309|1430|
| Sampled owned RSS peak bytes |708784128|757452800|
| Threads peak |66|64|
| Case private data/evidence peak bytes |45855199|46460676|

Qualified final is client-observed completion after original independent quorum,
inclusion and durable/published business checks; an internal two-thirds-vote
timestamp is not separately measured. Each case has only one complete active-offer
interior interval,681.122/583.911TPS. These intervals and this short burst are not
steady-state evidence. finiteJointImprovementObserved=true because the defined
finite criteria passed; sustainedTPSQualified=false and the full Goal remains open.

## Actual copying work, CPU and tradeoffs

Both cases made20 decoder calls:1 full replay,19 prefix reuses,6 replayed blocks,
2048 replayed inputs and2048 original mathematical native signature verifications.
All attempted decoder phase error counts were zero.

| Prefix phase | Calls control/copy | Cumulative ms control/copy |
|---|---:|---:|
| Gate wait |20/20|1546.489/1585.961|
| Prefix check |20/20|12.441/12.533|
| Private JSON reconstruction |19/0|483.760/0|
| Private native copying |0/19|0/31.955|
| Full private Validate |19/19|275.238/173.421|
| Full replay |1/1|102.427/146.113|
| Suffix setup |4/4|86.280/110.765|
| Suffix replay |4/4|405.899/433.200|
| Suffix encoding |4/4|57.812/41.620|
| Canonical copy |15/15|4.896/4.398|
| Certificate publication |5/5|6.997/103.194|

Extra publication JSON/copy cost is included, not omitted from the comparison.
Native cached inventory at completion:2610335 canonical bytes,height7,2056
accounts,2048 complete fee events and6144 Lots entries. These counts are not
decoded heap/RSS estimates. The sampled RSS increase cannot be attributed wholly
to this cache; allocator/runtime, node processes and block scheduling contribute.

Client RUSAGE_SELF CPU2.903498→2.660170s,64.633→59.691% of one core. It excludes
node/CometBFT CPU and does not prove CPU saturation or pure network waiting.
Callback busy wall time10.376237→10.145885s overlaps across workers and is not
additive finality. Both sides started/returned2048 callbacks, peak active4, end0.
Reader decode cumulative wall2.982534→2.643442s; transaction verification
0.502258→0.727769s and index publication0.037682→0.162746s worsened. Nested and
parallel durations include scheduling and must not be summed as end-to-end delay.

## All real Commit samples, including empty blocks

Each side has24 samples across4 nodes. Quantiles use nearest rank without
successful-interval selection. The writer code did not change; differing
partitions/scheduling and storage noise prevent causal attribution of write/fsync
differences to private reader copying.

| Commit phase | Control mean/P95 ms | Copy mean/P95 ms |
|---|---:|---:|
| Whole Commit |10.929/22.275|10.497/22.470|
| Full Validate |9.191/13.837|8.981/19.587|
| Semantic child |3.889/6.812|3.776/6.981|
| AppHash child |5.189/8.726|5.113/10.780|
| Delta encoding |0.312/1.388|0.255/0.474|
| Write |0.176/0.327|0.173/0.370|
| File sync |1.097/4.439|0.868/1.499|

ABCI CheckTx calls13164/12882, aggregate handler wall2.124444/2.277113s with zero
failed responses. These include node rechecks/gossip and are not new business TPS.
Original client first-byte P95 waits22.931/19.944ms and response-tail P95
10.936/4.789ms. The HTTP timings include transport/server/client scheduling;
neither they nor ABCI aggregate wall time isolates CometBFT or node CPU.

## Evidence and next step

[Full machine evidence](evidence/native-copy-pair-ci-39973570392-actual.json)
contains exact original file hashes,4096-row recomputation,8-log aggregates and
all Commit distributions, CPU/queue/cache facts, terminal guards and closures.
Size1007951B; SHA256
913c802859d072df47323ef66556bb7586c6817b18155c60d2386cc394154155.
Original raw files remain under
artifacts/chain-performance-20261017/native-clone-pair-39973570392/.
Recovery used only bounded cached ranges; original60s alarm142 records remain.
Completed members were reused after CRC/size/SHA checks. No whole-ZIP digest is
claimed for artifact12510706445 (23406191B).

Next source experiment should address the measured supply deficit: actual submit
rate639/s remains below the configured1000/s despite native reconstruction savings.
Prepare a separately selected4→8 submitter comparison with the same2048 native
inputs, offered rate, four observers, queue capacity and original resource gates.
Keep all existing modes/defaults, UNKNOWN handling and cryptographic/business
checks. This is a testable hypothesis about submission/observation overlap, not
a proven server or CPU cause. Another network window needs a new Root grant.
Longer-duration/history capacity must subsequently be measured before ten-minute
1000TPS acceptance; this finite result is not a substitute.
