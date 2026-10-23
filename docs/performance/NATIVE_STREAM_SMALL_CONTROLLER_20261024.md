# Native stream small-history controller, 2026-10-24

Code: `dfd4569d4cc633538f5f82cff6794637b680df1e`, journal-byte binding follow-up `b0617596aa7d1cef9c34fa3499fb1b2388d01f38`. This wires the original Supply launcher to the existing native-prefix streaming client. No network load was dispatched and no throughput improvement is claimed.

## Explicit finite profile

`supply-native-stream-2048x4`: 2048 ephemeral accounts, four sequential nonce cycles,8192 planned signed transfers,1000 configured offers/s,8submitters/4observers, original suffix setup, native private copy, original signature facts and full current-state checks. The original finite/native-submit8 profiles and defaults remain.

| Budget | Explicit new profile |
|---|---:|
| Active/cleanup/total |45s/15s/60s|
| Owned processes/children |10/9|
| Owned RSS/threads |1GiB/320|
| Private allocated evidence/data |256MiB|
| Encoded signed+terminal evidence |64MiB|
| Per-store input/canonical limit |32MiB|
| Retained input cache budget |64MiB|
| Client timeout |30s|

The256MiB override requires the exact named profile in the original native resource monitor; unnamed256MiB calls still refuse. No default cap or automatic retry is changed. Existing file-count, free-disk, MemAvailable, build and log caps remain. A budget is not evidence that this workload fits it. Private sender keys remain in the isolated fixture for nonce signing and are excluded from the original CI network artifact upload.

Recipe only, launches nothing:

```sh
python3 -B scripts/loadtest/supply-linux-window.py   --native-stream8 --profile supply-native-stream-2048x4   --transport grpc --observer-phases --prefix-replay   --prefix-native-clone --observer-native-facts
```

The original workflow offers this explicit profile and forwards the same mode flags. Actual execution still requires normal source CI, complete bounded segmented artifact recovery and a fresh exact Root resource grant. Existing consumed grants cannot authorize it.

## Actual verification path

The existing launcher now calls the separate stream validator after client exit. It binds the original immutable plan, fixture hash, all initial signed inputs, all intent and gzip terminal members, latest slots, all8192 cumulative stage counts and original signing/evidence counters. Missing/UNKNOWN/failure/replaced inputs refuse qualification. Its complete readback is inside the active case and charged to original resource sampling. Cleanup, immutable receipt fsync, fresh double native process closure and post-fsync budgets are required before the distinct `YNX_NATIVE_STREAM_TERMINAL` success verdict.

The reader folds complete original records into fixed arrays: six histograms matching Go exactly plus two stage gaps and offer-to-inclusion. Storage is9×60001 uint64 buckets, independent of record count. Quantiles are closed nearest-rank intervals in ns, with original Go half-away rounding, actual extrema and the>=60s overflow bucket. Per-row queue+inclusion and queue+final are computed before quantiles. Stage gaps are CheckTx-to-observed-inclusion and observed-inclusion-to-qualified-final; none is an internal BFT vote timer. CPU/callback and prefix child phases are retained separately; overlapping times are not added.

A source inspection found that the Go entry point replaces summary/count rates with its outer client wall, while the monotonic time-series window remains the shorter ready-controller wall. The validator binds CPU and summary to the outer wall and separately verifies the complete inner bins, errors and backlog. It does not rewrite timestamps or equate the two scopes.

## Evidence and limitations

The original Go producer executed102 signed application transactions through nonce34, Commit, native state readback, restart and replay rejection; race test PASS4.605s. Quorum flags are synthetic unit gates. The Python17 tests read those exact public segments: all six Go latency histograms agree, and original counters cover99successors/102terminal writes. Complete intent/terminal identity and corruption tests remain active.

The controller suite passed87tests in10.987s before the final display/window binding delta; final five new controller tests passed0.322s after that correction. Their resource/runtime/network facts are deliberately synthetic source counterexamples, not measured Linux admission. The original closure repair CI40018205634 at exact345d91fdd completed SUCCESS/attempt1; raw603760B SHA256 `cc2457b535d80adbeb6b7c26a69c7458a0c08761ee7af73d0002b911129979b1` is retained. Final source gate17cases PASS0fail0skip in11.737s, including the newly pinned native resource profile implementation. Final journal-byte binding regression PASS0.291s and original Go phase-counter readback PASS0.025s. Current controller source CI is pending.

[Original local evidence and file hashes](evidence/native-stream-small-controller-local-20261024-actual.json).

The next missing delivery is bounded recovery of all segmented public members from the original network artifact, followed by exact source/CI/resource binding with Root for the first8192-input Linux case. No native Linux resource admission, actual8192 network business finals, matched performance improvement,600-second stability or sustained1000TPS is established by this change.
