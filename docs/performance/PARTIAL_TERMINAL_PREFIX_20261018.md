# Partial terminal history recovery

The stopped failed-window reconciler now accepts schema 12 latest-per-account reports. It reads contiguous sealed terminal segments bound to the verified fixture and signed intent journal, validates the entire segment before publishing any rows, and stops at a missing, damaged or unbound tail. Original files are never repaired or resubmitted.

Explicit latest-slot observations can supplement the validated prefix. Duplicate observations must match exactly. A non-confirmed original observation prevents a later observation for that sender from being merged, including when the later nonce appears only in the latest slot. Missing observations remain intent-only with unknown outcome; a missing terminal directory does not prove that a transaction was never submitted. SubmissionRecorded distinguishes absent observations from an explicit no-submission observation.

A sealed segment is only original client observation evidence. The existing independent signed-block quorum, state replay, fees and nonce checks still determine actual durable node effects. Offline reconciliation does not invent ACKs, latency, throughput or permission to retry UNKNOWN identities.

Bounds remain 2,048 intents, 32 cycles, at most 16 MiB captured terminal data and one segment captured at a time. Hard directory/inventory errors are retained separately without erasing independently recoverable signed intents or node state. A valid prefix stops before the first invalid segment. The merged row set remains bounded by the plan.

Added regression source covers damaged tail, missing first segment, invalid signed-intent binding, quarantine progression, missing directory, conflicting duplicate status, cross-source UNKNOWN successor and valid complete segmented history. gofmt and git diff --check passed. These new Go tests have **not run**; no new Go compiler/test process is authorized while Root reserves the next heavy window for IDE. The earlier focused slot test PASS predates this patch.

Future focused selector: TestTerminalStreamPrefix. Existing controller selector TestTerminalStream also includes these cases. The full failed-window diagnostic still requires transactions-result.json; recovery when that report itself is absent remains future work. This source change does not increase the current bounded workload limit or establish the ten-minute target.
