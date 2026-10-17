# Ready controller: bounded per-account result slots

The controller now has an internal opt-in `reuseResultSlots` branch. Existing
CLI runs retain their full-history arrays; no CLI switch exposes the slot branch
before cumulative summaries and stream-backed reporting are connected. This is
implemented controller groundwork, not a ten-minute driver or measured memory
improvement yet. Go regressions have not run because scheduled admissions stopped
before tests; do not treat the following test sources as passing evidence.

The branch uses exactly one transaction/result slot per sender. Jobs, accepted
queues and terminal channels are bounded by that slot count, instead of total
lifetime inputs. Signed envelope identity remains a global transaction index
and nonce cycle. A separate storage-index mapping permits reuse without changing
signed identities. Completion records carry the generation captured at handoff;
the controller checks ownership/generation before consuming the slot. Workers
must relinquish all references after terminal handoff, as in the existing API.

The old terminal result is sent to the configured evidence sink before the
controller may sign a successor or reset the slot. Missing sink is rejected
before journal creation or worker dispatch; a sink error stops successor signing.
The sink may buffer at most 64 terminal rows, as previously documented; signed
intent Sync remains the authority for read-only recovery after a crash. This is
not an automatic resubmission queue. Slot reset clears the previous timing,
errors and proof fields while retaining the fixed node endpoint.

UNKNOWN/rejected/unverified/timed-out senders remain quarantined. A successful
peer may continue without waiting for that account. Signatures, original
fee/nonce/finality gate, pre-dispatch signed journal Sync, per-account one-in-flight
rule and no catch-up bursts remain. Round-completion counters use the minimum
successfully completed nonce cycle over all senders, so they need no lifetime
result slices. Total workload is still <=2,048, cycles <=32, and nonce <=32.

Pending focused Go coverage, under the existing `TestReadySender` target:

- 96 real signed identities across 32 cycles using only three slots (finality
  flags are explicit synthetic unit inputs, not network consensus evidence);
- missing terminal sink fails before dispatch/journal creation;
- UNKNOWN only quarantines that account while peers reach the next cycle;
- the prior real signature/execution/persistence/restart test now exercises both
  full-history and slot reuse, requiring six sealed terminal rows and exact
  expected balances/nonces/fees in each mode.

Remaining integration: cumulative verified stage counts and fixed-memory latency
statistics, streamed raw-result report references, bounded signed-intent segment
rotation and long-history durability readback. Current CLI summary still depends
on lifetime arrays; it is deliberately not replaced with a summary of only the
last slot generation. Ten-minute acceptance and stable 1,000 final business TPS
remain unproven.
