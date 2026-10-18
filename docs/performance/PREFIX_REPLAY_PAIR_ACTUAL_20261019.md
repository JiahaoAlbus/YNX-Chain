# Actual same-VM shared versus prefix replay:39175142936

The granted pair completed safely, but joint performance acceptance failed.
All2048 original business transactions on each side were effective and qualified
finals, with zero UNKNOWN/timeouts/notSubmitted/execution failures/rejections.
The final finite rate increased1.585%, while queue-inclusive final P95 remained
3.927s. This does not qualify sustained1000 valid business TPS or default activation.
Transient observer error occurrences12611/14090 are retained, not relabeled zero.

## Fixed source, physical execution and cleanup

Run39175142936/job117816146190 completed SUCCESS, attempt1, frozen tag
codex/chain-prefix-pair-b938174df at b938174df08bf480df541ace43a5484d7511da47.
Normal source CI39174632901 had succeeded at that exact commit. One original job
built four identical ELF binaries once, then executed shared→prefix sequentially.
Actual host was runnervm8k3b6, native Linux6.17.0-1022-azure,4 logical CPUs,
INTEL XEON PLATINUM8573C; bootID df404f62-32f3-4b64-a8b5-687c1d11b1d4.
Both cases matched source/internal tree/compiler/ELFs/environment/host CPU identity.
GOMAXPROCS1/GOGC100/GOMEMLIMIT off, grpc/relative, four submitters/four observers,
2048 fresh signed nonce1 inputs per side, configured1000 offers/s. Fresh random
fixture identities, startup and block scheduling differ. The older332TPS run on
another CPU is not the baseline for this pair.

Per-case post-fsync windows were10032/10216ms; aggregate20809ms including closures
and fsync. Aggregate retained94041683B<128MiB; per-case peaks46435607/46592288B
including own receipts, RSS728760320/764370944B<1GiB, threads64, build118981979B.
Original native admission/floors and128MiB initial aggregate reserve passed.
Both case and pair post-fsync verdicts were qualified. Each case and both pair
closure groups preserved two empty scans: only launcher34344/startTicks34637.
Slot returned; no rerun/fallback/new grant consumed.

## Original4096 rows and actual user-visible latency

All original client/fixture bytes were reread, hashes and every envelope/index/
nonce/endpoint/business/quorum/published-state/durable result bound to receipts.
Eight original ABCI logs exactly reproduced their saved aggregates. These are
independent inclusion/quorum checks plus client-observed qualified completion;
internal two-thirds vote timestamp is not separately measured.

| Metric | Shared | Prefix |
|---|---:|---:|
| Client measurement window s |5.782065011|5.691840140|
| Actual offered interarrival/s |997.678647|992.558444|
| Actual submission interarrival/s |494.622006|513.439559|
| Full-window effective included/qualified final TPS |354.198716|359.813338|
| Offer→inclusion P50/P95/P99 ms |1709.207/3632.010/3769.909|1761.106/3529.511/3647.323|
| Offer→qualified final P50/P95/P99 ms |2202.096/4053.863/4173.583|2089.631/3926.894/4095.176|
| Submission queue P50/P95/P99 ms |364.741/2189.094/2254.218|405.076/2087.156/2139.769|
| CheckTx callback P50/P95/P99 ms |1.549/40.342/114.510|1.670/41.305/84.933|
| Offered waiting for submission peak |782|856|
| Accepted waiting for observation peak |1041|953|

Negative queue median/peak and CheckTx median/P95 are explicit. Final P95 remains
above3s; finiteJointImprovementObserved=false and sustainedTPSQualified=false.
Each side has only one complete active-offer interior block interval (584.859/
628.577TPS); this is not a steady-state measurement.

## Real Commit encoding, writes and validation

Each side has32 actual completed Commit samples across4 nodes (heights2..9,
including empty blocks), with no success-interval selection. These local node
wall times include scheduling/lock effects and are not BFT final latency.

| Commit phase | Shared mean/P95 ms | Prefix mean/P95 ms |
|---|---:|---:|
| Whole Commit |14.560/23.415|15.965/26.817|
| Full validate |13.211/20.662|14.166/25.021|
| Semantic validation child |5.644/11.628|5.517/9.009|
| AppHash validation child |7.489/12.152|8.578/17.430|
| Delta encoding |0.180/0.410|0.192/0.442|
| Write |0.173/0.338|0.184/0.373|
| File sync |0.872/1.945|1.295/4.011|
| Prepare file |0.030/0.040|0.034/0.049|
| Close file |0.011/0.022|0.011/0.019|
| Journal maintenance |0.073/0.104|0.072/0.094|

Validation children are nested inside full validate; do not add them again.
In this pair encoding/fsync were small compared with validation and seconds of
queue/client observation. Prefix only changes the reader; its worse Commit/AppHash/
fsync samples are retained as actual variation, not attributed to reader speedup.

## Real reader work and remaining submission wait

Shared24 validations:6 full producers/17 joins/1 hit/0 failures,27 blocks and7281
input visits. Prefix24 calls:1 full replay/23 successful prefix reuses/0 failures,
7 blocks and2048 input visits. Both actually performed2048 original signature
mathematical verifications; no signature/nonce/fee/authority shortcut was taken.

Cumulative original reader stages (parallel/nested, not additive final latency):

| Stage | Shared ms | Prefix ms |
|---|---:|---:|
| Load parent |7520.690|5833.497|
| Whole-file hash |118.099|24.813|
| Capture |330.785|278.123|
| Decode |6947.562|5465.924|
| Index publication |122.332|62.773|
| Transaction verification |1245.929|830.189|

Shared measured producer6 calls1716.728ms, canonical byte copy24 calls11.009ms
(45395848B), private JSON18 calls1104.923ms, full private Validate18 calls541.703ms,
shared wait3572.752ms. Prefix total decode5465.852ms includes its serialized gate
wait and work, which are not separately instrumented yet. Different block/input
histories affect hash/read amounts; work counts do not imply an equivalent CPU gain.

Original HTTP hook P95 acquire connection0.005490→0.005614ms,
write→first byte23.868836→24.987763ms, first byte→callback return18.131616→17.799748ms.
All2048 original callbacks per side had one write/first-byte hook and zero write
errors;2039/2036 connections were reused. Aggregate callback durations15298.616/
14653.913ms across four parallel workers (not summed into wall latency); per-endpoint
mean7.439/8.187/6.870/7.384ms versus6.838/7.239/7.186/7.358ms.

The measured next constraint is substantial submission queueing at roughly495–513
submissions/s despite~1000 offered/s, alongside seconds of reader decode/wait.
HTTP hook first-byte time includes server/transport/scheduling; this evidence does
not isolate pure network/server CPU or prefix gate CPU. Next source instrumentation
must separate prefix gate wait from actual decode/private validation work and
measure process CPU before assigning the remaining gap. No new heavy run is implied.

## Evidence integrity

Formal evidence: evidence/prefix-pair-ci-39175142936-actual.json,1035651B,
SHA2566f566c77cceb298c71aca692e0b134464feb5df3265a62a8ecc646d72f8dc117.
It preserves original summaries, all phase totals,32×2 Commit samples, compiler/
ELFs/source/host/runtime identities, negative outcomes, raw sizes/SHA and closure.
Pair receipt SHA05405abb1396b00dc9978e43af4c206042fd60cec98cf7ecaa52f111d9f9c34b.
Artifact12153669841 ZIP23703794B: selected original members verified exact numeric
206 Content-Range/length, member CRC/size/SHA; no whole ZIP digest is claimed.
All previous API/client negative CPU/wall samples remain unchanged in the original
prefix client report. One local read process EAGAIN and bounded normal recovery
were preserved; no hook, helper, model or platform limits were bypassed.
