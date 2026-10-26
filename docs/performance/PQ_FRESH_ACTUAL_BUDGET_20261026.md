# Static budget from actual run 40261635920

This analysis uses only the retained failed 7a run: 45 complete progress spans,
one unfinished Host-context span, and the original guard receipt. No test,
CI watcher, artifact download or node was started for this analysis.

The observed before-arm setup before business intent preparation is
56.979981514 seconds on the original Go parent-process clock. Four observed PQ
constructors together consume 1.662968017 seconds. Their nested custody/recovery
spans consume 1.220560927 seconds inside those constructors and must not be
added again. PQ start/activation is 16.442773895 seconds; initial-account
execution/activation is 17.910717782 seconds. Stage names do not isolate CPU,
crypto, disk or waiting inside those inclusive calls.

Sixteen offer-call durations sum to 55.976071496 seconds, but their observed
time-axis union is only 16.470334571 seconds because calls overlap. All complete
spans together sum to 117.179224429 seconds; their union is 76.452926577 seconds.
Neither sum is total runtime or an effective business rate. The final complete
stage ends at process offset 76.532253185 seconds; the unaccounted interval
includes the unfinished Host context and small instrumentation gaps. It must
not be assigned to persistence, CPU or BFT finality without further evidence.

The guard independently records 77707 ms elapsed and an unchanged 105000 ms
active cap. Its nominal unused active budget at failure is 27293 ms; the once
grant is nevertheless consumed. These launcher timestamps and the Go test's
origin have no measured exact alignment. Cross-subtracting their offsets to
invent stage latency or exact control overhead is invalid.

If a hypothetical second setup had exactly the measured first setup cost, two
setups would total 113.959963028 seconds. This is explicitly a planning scenario,
not an observed after arm, causal performance claim or permission to extend
the cap. The next complete source must be measured within unchanged limits,
with enough budget for both independent proof sets and normal cleanup.

The actual functional stop was the stable Host checkpoint predicate, before
the first independent readback. No finalized-business count, finality quantile,
paired speedup or encoding/fsync quantile can be recovered from these call
spans. Actual per-block persistence rows were not exported in this failed run.
The original terminal H and UNKNOWN/failure scope remain unchanged.

Machine-readable accounting is `evidence/pq-fresh-7a260-static-budget.json` and
the WD `pq-fresh-7a260-whole-once/STATIC_BUDGET_ANALYSIS.json`.
`evidence/pq-fresh-successor-window-requirements.json` prepares the complete next
tuple requirements without inventing a final candidate, normal run or ELF pin.
Checkpoint repair 34ed and its reported CI are references only: the original
owner is still combining the final setup changes and performing normal checks.
No CI result has been polled here; standalone 34ed and old 7a binaries are not
new performance inputs. Final source, whole-green matching supply and a new
Root exact once grant are required before any next window.
