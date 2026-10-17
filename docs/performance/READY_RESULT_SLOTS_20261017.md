# Ready controller: bounded per-account result slots

The controller now exposes opt-in `-reuse-result-slots`, requiring ready-pool
mode and `-terminal-stream`. Default CLI runs retain full-history arrays. Slot
mode has cumulative counts and bounded interval latency statistics connected to
the terminal handoff; it does not summarize only the latest slot generation.
This is source implementation, not a ten-minute driver or measured memory
improvement yet. Go regressions have not run because scheduled admissions stopped
before tests; do not treat test sources as passing evidence.

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

Remaining integration: bounded signed-intent segment rotation, safely extended
cycle/duration/funding limits and long-history durability readback, followed by
measured comparisons and abnormal-exit recovery for slot reports. Ten-minute
acceptance and stable 1,000 final business TPS remain unproven.

## Cumulative CLI reporting (Go execution pending)

Schema12 labels retentionMode as latest_per_account_slots: transactions contains
only the most recently prepared/observed per-account slots, while every terminal
handoff is written to the bounded segmented stream. Prepared but never offered
identities remain in the original signed-intent journal; no resubmission or
resumption is introduced. Input remains the full planned count, not slot count.

Counts accumulate once per controller completion, before reuse. Raw ACK, code0
proof and quorum observations stay distinct from actual effective business
inclusion and finality. The latter require a hash binding to that slot's exact
raw transaction, existing durable fee/nonce/publication gates, and for finality
the confirmed status and identity-bound successful CheckTx. Unknown, timeout,
failed execution and unsubmitted counts remain explicit. Future/unoffered inputs
are counted as unsubmitted, not dropped from the denominator.

Six fixed histograms cover queue, CheckTx, authenticated inclusion, effective
business inclusion, qualified finality and offer-to-final. The last adds each
transaction's saved queue and final spans before histogram aggregation. Their
closed nanosecond intervals are in readySenders.boundedSummary.latencyIntervalsNs.
Old exact point-percentile fields remain null; callers must not present interval
estimates as exact quantiles. A threshold crossed by an interval needs exact
offline sorting of raw terminal evidence. Steady/interior TPS remains withheld.

Invalid latency excludes the entire row from histograms and fails the run, but
preserves actual stage counts and increments invalidLatencyRecords. It must not
relabel a known actual submission as unsubmitted. Missing monotonic event times
withhold interarrival rate rather than subtracting UTC clocks. Overall rates use
the complete workload including terminal segment close/Sync, as with signing and
intent Sync. This does not count report-file serialization as business execution.

Pending counterexamples compare cumulative counts against full-history results
after out-of-order terminal handoffs; reject business promotion with missing or
unbound evidence; preserve counts on bad latency while avoiding partial histogram
updates; enforce input bounds; and reject slot CLI without durable terminal output.
The 96-input/3-slot controller test additionally asserts all 96 cumulative counts.
All existing 2,048 input / 32-cycle / 30s CLI caps remain unchanged.
