# Prefix gate work, client process CPU and submit occupancy

Source5388bf28a4ddfe0c970c21196d60d072ba8b5920 implements the next measurement
needed after actual pair39175142936. No remote run or improvement is claimed for
this new source. The completed pair and all its negative tails remain unchanged.

The separate read-only API DecodeWithPhaseTiming returns private per-call phase
counters even on failure/cancellation: gateWait, prefixCheck, privateJSON,
privateValidate, fullReplay, suffixSetup, suffixReplay, suffixEncode, canonicalCopy
and certificatePublish. Each reports actual calls/errors/durationNs. The old Decode
API performs no phase clock reads and returns no timing object. Snapshot bytes,
full signature/fee/nonce/state validation, original first errors, rotation and
cancellation semantics stay on the same paths. An exact input still reconstructs
private state and fully validates; no validation is skipped for telemetry.

The explicit prefix client now aggregates those phases by value. Counts include
attempted/failed work separately from successful full/prefix outputs and completed
replayed block/input counts. Held-gate cancellation must report gateWait error
without pretending a decode occurred. Caller mutation cannot change retained
phase counters. Sequential child wall times fit within their parent; concurrent
call totals still cannot be added into finality.

Timed paced rounds also collect two real RUSAGE_SELF samples around the original
client measurement: user/system/total CPU nanoseconds, measurement wall, wider
sample bracket wall/overhead and percent of one CPU core. CPU covers the whole
client process including HTTP/observer/decoder/runtime/GC, excluding separate
nodes and other processes. A qualified pair has2 samples; unsupported/failed or
regressing samples remain explicitly unavailable/error, without successful zero
CPU. Default reports omit this opt-in object. Short local CPU observations can
exceed100% of one core due parallel/runtime/sample effects and are not clamped or
interpreted as stable CPU usage.

The original submit workers measure callback starts/returns, actual active/peak
callbacks, cumulative busy wall nanoseconds, queue wait sample count/total/max
and the same measurement wall. No extra HTTP calls or submission attempts occur.
Queue intervals use the original offered and returned submit-start monotonic
values, and bind the existing per-row QueueDelayMs values. Busy wall times overlap
across workers and are not pure network/server/CPU. Default untimed workers add no
measurement clock reads. No account/signer/UNKNOWN/consensus/durable write path or
resource cap changes.

Controller preserves historical reports without these optional fields. New online
data64 execution and pair readback require available valid CPU/occupancy; fresh
prefix execution additionally requires complete phase inventory. Typed counters,
parent/child bounds, actual phase-branch relationships, sample bracket, all original
row queue/callback intervals and both receipts must agree. Unknown or fabricated
CPU, zero CPU for the completed2048 workload, impossible callback counts, extra
concurrency and inconsistent intervals are refused. Historical4096 pair readout
was reread and remains exactly equal, without invented CPU/child fields.

The existing workflow runs the new API cancellation/byte-equivalence tests and
runtime CPU/occupancy tests. Source qualification binds the entire current client
and internal trees plus exact controller/workflow/test files, with tracked/missing/
untracked mutations refused. Original frozen diagnostic/anchor suites remain.
Local checks: core prefix safety PASS0.981s; prefix/runtime plus original shared/
observer/client checks PASS1.061s; controller67PASS4.269s; source11top-levelPASS11.257s.

Bounded local real signed journals exercise cold, identical, suffix and failed
private decode; their actual timers are retained. The short CPU hash probe and
12 controlled callbacks test actual native counter/interval consistency, not
business TPS. Both local groups, including the higher CPU sample, remain in
`evidence/prefix-runtime-source-local-actual.json`. These Darwin samples do not
replace a newly granted exact-source Linux measurement. Any future window needs
its own fixed ref, successful normal CI and fresh unchanged resource admission;
this source does not reuse the completed pair grant.
