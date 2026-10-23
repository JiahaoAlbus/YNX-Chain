# Actual runtime pair39957093049: failed shutdown timing, source repaired

Run39957093049/job120425528150 at frozen sourceccff55fd79893e6c1357e8d522b3b465b9e78b70
completed FAILURE, attempt1. Only the shared first case ran; prefix was not admitted.
The grant is consumed. No retry/fallback or performance acceptance is claimed.

## Actual first cause and strict refusal

The original node1 log ends at sequence8 with reason shutdown,valid=false,inFlight1;
its7 prior Commit frames are valid. The unchanged node-phase-timing reader rejects
this with `incomplete or invalid node timing session`. The other3 original node
logs pass. This is a real incomplete diagnostic session, not a CPU/nonce/quorum
checker failure; the failed frame remains invalid after the source repair.

Original main stopped the ABCI transport then immediately emitted shutdown timing.
Pinned Comet v0.38.23 GRPCServer.OnStop invokes grpc.Server.Stop(), which does not
necessarily wait for an already admitted application handler to finish. The frame
was sealed while that actual handler remained in flight. All reader rules remain.

The first case post-fsync window was9948ms; aggregate9976ms,retained46001157B.
Case cleanupComplete=true; its final2 original owned scans and post-fsync task set
contain only the same launcher/startTicks. The pair-level double-closure routine
was not reached after first-case refusal; do not claim it executed. Original pair
receipt hash08b68eb1b0d989436503d3fd5516cc4fe896985a1f8271465d63244c4b97d5ee,
case hash347afd8343dca208d6d421cb305342fa9c424c2710702195ee87a9137b30ae8d.
The original case closure, pair final guard/hash and completed job prove slot
return while preserving caseQualified=false and pairQualified=false.

## Diagnostic first-case observations, not a qualified comparison

All2048 original input envelopes and client rows were recovered and bound by
original fixture/result hashes, all original fee/nonce/endpoint/business/quorum/
published-state/durable flags and actual2048 native math successes. This does not
repair the invalid node terminal or qualify the failed pair. Hardware:4 logical
CPUs, Intel(R) Xeon(R) 6973P-C; source/compiler/ELFs/environment/host are preserved in evidence.

Raw client measurement window5.740301205s,finalSubmitted2048,UNKNOWN0; raw finite
rate356.775703/s is diagnostic only. Offer→inclusion P50/P95/P99 ms:
1768.745317/3417.249125/3546.610120; offer→qualified final:
2170.038062/3851.757211/3969.158149. This is client-qualified completion,
not a separately timestamped internal two-thirds vote instant.

RUSAGE_SELF user3593049000ns + system168121000ns =3761170000ns; two-sample bracket
5740309055ns,overhead7850ns,65.5220819% of one core. CPU covers client HTTP/observer/
decoder/runtime/GC, excluding separate node processes. It neither proves continuous
single-core saturation nor isolates network/server waits or CPU quota effects.

Original submit callbacks2048 started/returned,activeAtEnd0,peak4,cumulative busy
15050851586ns (parallel/overlapping). Queue intervals2048,total1743589641221ns,
max2237757354ns. These were recomputed from raw row intervals by the unchanged
runtime validator. Prefix CPU/child phases do not exist because no prefix case ran.

## Owning source repair and causal regression

Repair commita2a0fbc084598fed891f6e60d897386f426856e3 changes only4 own cmd/ynx-abci
files. A focused held-handler test reproduces the old stop behavior: transport
Stop returns,shutdown is emitted with validfalse/inFlight1 while the handler is
still held. A cancelled drain was also incorrectly treated as success by the old
factored path. Original RED is retained (0.518s), including its exact frame.

The timed shutdown path now stops transport, closes admission to new measured
handlers, and waits for admitted delegates using a1s context within the existing
15s cleanup/60s case/120s pair budgets. The parent cleanup/escalation caps remain;
this is not an extension. Completed Commit counters and their final sample form
one recorder transition before drain completion. No late request is forwarded as
successful work. Cancellation/deadline or failed transport Stop keeps evidence
invalid. The ordinary untimed stop path, signatures/state/fee/nonce/durable writes
and all consensus checks stay unchanged. There is no deployment/activation claim.

All phase tests PASS0.575s, new lifecycle cases repeated10 times PASS0.820s,
whole ABCI package including real signed byte-identical durable state and both
transports PASS0.431s. The source gate adds the whole diagnostic node tree to the
existing client/internal/controller binding and rejects modified/missing/untracked
node inputs;14 top-level tests PASS15.307s including all original frozen suites.
These local checks do not prove the repaired network case; it needs successful
normal CI and a separately granted fixed-source window.

Artifact12503925140 ZIP11559768B was recovered by bounded exact206 selected-member
reads, memberCRC/size/SHA and original receipt/result/fixture hashes. Original60s
recovery alarms142 are retained. Completed numeric ranges were cached with their
own SHA/length so only missing chunks were continued on the same immutable artifact;
no workflow rerun, larger member/time cap or whole ZIP download was used.

Formal evidence: evidence/runtime-pair-ci-39957093049-failure-actual.json.
The latest qualified pair remains39175142936 (finite359.81TPS/finalP953.927s).
Sustained1000 valid business TPS and ten-minute stability remain unproven.
