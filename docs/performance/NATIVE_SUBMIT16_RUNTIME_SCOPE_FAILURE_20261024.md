# Submit16 original run failure and scope repair

Originalrun40085358438/sourcec8b7a2f6b14034acbf4a4e801a3260b86a659368 completedFAILURE. Before8 internal terminal qualifiedtrue/null at41674ms with receiptSHA2f9bf26e43ba04cf38bd04b564a16f4f5efd6a6836d0f4e3a461e1c7fd82954e. Pair terminal qualifiedfalse at80977ms, firstCause post-fsync stream scope differs, pairSHA df43b7e1e93fb452f72af364b337e5413829d376c3c4d84cf53ff7e1a566be57. No after16 post-fsync terminal exists. Both final pair scans show only launcher39665/startTicks46659, so the slot is returned. Independent invalid reader actually reports nativePairQualifiedfalse/slotReturnedtrue/sustainedfalse, preserving original failure. No retry or second dispatch occurred.

Original recovered after16 receipt reveals the earlier firstCause native verifier: stream worker scope differs; client exited0 and cleanup completed, but verifier did not produce success. The runtime fold validator had validated submitter inventory using its implicit8 default, despite the enclosing report/plan selecting16. A second omitted forwarding at post-fsync profile comparison also defaulted to8, raised before its exception boundary and masked the verifier firstCause at pair level.

Repair: pass the explicitly selected worker count from the full stream producer expectation through runtime-fold worker validation. Compare post-fsync scope against the explicitly selected profile. Keep the scope check inside the existing post-fsync failure handler, so malformed scope stays failed and original firstCause is retained. Defaults stay8; no worker count is inferred to grant authority from arbitrary report data. Caps, signatures, nonce, balances, full stream proof, two checker passes, persistence and double cleanup checks remain required.

Two genuine RED cases are retained: valid16 full stream source route rejected by the nested runtime validator; valid16 post-fsync route rejected against8. New coverage checks full16 producer/plan/report/inventory/fold/queue/callback bindings, invalid worker markers, incomplete8192 coverage, cleanup failure, and firstCause preservation. Full controller90PASS11.208s and pair32PASS0.133s after repair. Existing original CI already selects both files; no unrelated old node run or Go test is repeated.

Diagnostic client observations from original individually recovered public ZIP members (not qualified pair results):

| Metric | Before8 | After16 |
|---|---:|---:|
| Actual offered rate/s |282.064|289.014|
| Self-reported final rate/s |262.177|275.730|
| Mean active submit callbacks |6.226|10.636|
| Mean callback wall ms |23.749|38.575|
| Mean queue wait ms |92.556|39.776|
| Peak queue wait ms |1061.855|481.490|
| CPU percent of one core |77.506|77.158|

The client self-reports8192 finals and no unknown/execution-failure/timeouts on both sides, but after verifier/post-fsync admission is absent. Do not count these metrics as a successful same-condition improvement or1000/s. More workers shortened the queue while offer barely increased and callback wall grew; further work should identify client verification/node RPC costs rather than extrapolate concurrency. Complete original artifact recovery remains ongoing; all cache/partials/raw/failed outputs are retained on WD. Any new run needs new source CI/frozen proof and a fresh exact Root window.
