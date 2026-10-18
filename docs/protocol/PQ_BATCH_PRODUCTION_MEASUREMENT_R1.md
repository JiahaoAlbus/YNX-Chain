# PQ batch production-path measurements, revision 1

`Devnet.SubmitPQBatchMeasured(originalWhole)` returns the existing `PQBatchResult`,
a call-local `PQBatchMeasurement`, and the same error as `SubmitPQBatch`.
Version: `ynx-pq-batch-measurement-v1`. Both APIs call one private executor and
the same snapshot, checkpoint, streaming writer, Sync and rename functions.
There is no second executor, global collector, external callback or admission
capability. The original API disables clock/counter collection.

This is source instrumentation. It is not a new benchmark result, network
transport, public deployment, proof of consensus inclusion, TPS or latency
claim. The separately owned performance client must consume the API and retain
its existing weighted Commit, transaction Merkle proof and business readback
gates. The previous single N=1 trial is not repeated for this change.

## Binding and result semantics

- `wireHash` is SHA-256 of the private clone of the actual original Whole wire.
  On admitted/replayed calls it is the actual `result.batchHash`.
- `executionHeight` is the actual next execution height under the ledger lock,
  or the preserved original height for replay. It is a decimal JSON string.
- `result` independently copies the actual returned batch status, original
  member indices, application hashes and partial outcomes. It does not alias
  the returned result or authoritative stored proof.
- `memberAdmitted` and `memberRejected` count this call's business evaluations.
  Admission is not persistence: a later rollback/UNKNOWN still retains these
  evaluation counts and the actual `result.status`/error. Exact replay has zero
  new member evaluations and zero new signature checks.
- `verifierSignatureChecks` comes from the actual verifier's Stats, including
  unsuccessful dual-signature authentication. It is not inferred from N.
- Malformed or unauthenticated calls can retain a wire hash and attempted
  height without returning an authenticated batch identity/result. Empty or
  oversize inputs are rejected before clone/hash/lock.

## Phases

Every phase has `attempts`, `completed`, `errors` and decimal-string
`durationNs`. Durations use `time.Now`/`time.Since` monotonic components, include
failed attempts, and sum actual call durations when a phase repeats. Completed
means that this phase returned nil. An all rejected batch can have a completed
API call while containing zero admitted business and zero persistence attempts.
There are no estimated rates or synthetic finality fields.

`total` includes the whole measured call and independent result copy.
`inputCloneHash` copies and hashes the original input. `lockWait` observes the
actual ledger-lock acquisition. `policyValidation` validates the current trusted
policy; `wireDecode` decodes Whole and encodes its certificate;
`wholeAuthentication` creates the existing verifier, verifies both signatures
and complete trees once, and resolves effective owner policy. `memberExecution`
wraps each actual per-index trust refresh, transfer decode, business validation
and tentative application. Rejected members count as phase errors. `replay`
wraps only the existing original-proof/result reconciliation path.

These phases are inclusive and nested: `total` contains authentication,
execution and persistence; persistence contains file totals. Do not add parent
and child durations together as independent work. Wall time includes scheduler,
filesystem and lock waits; it is not CPU time or a hardware capacity estimate.

## Persistence boundaries

`persistence.total` starts only when the existing disk snapshot path is used.
Memory mode, exact covered replay and all rejected batches have zero attempts.

The measurement separates actual `snapshotBuild`, `integritySeal`,
`checkpointBuild`, `persistenceLockWait` and `mkdir`. `candidateIntegrity` is the
actual sealed candidate's integrity; it is never proof of publication.

`snapshotFile` and `markerFile` each separately observe:

1. Temporary-file open.
2. JSON encoding/streamed writes (or actual marker write).
3. File Sync.
4. Explicit successful-path file close.
5. Rename.
6. Containing-directory Sync.

`writeCalls` and `bytesWritten` count actual `os.File.Write` calls and returned
bytes, including partial/failed writes. The streaming JSON format, indentation
and omitted final newline are unchanged. Error cleanup closes/removes temp
files as before; cleanup is included in file total, not reported as a completed
durability boundary. Measurements do not change locks, rollback order, file
mode, serialization, integrity checks, checkpoint retention or error wrapping.

`published` appears only after snapshot and marker have both completed their
durable replacements and the actual final atomic checkpoint Store. Its
`version`, height, hash and snapshot integrity come from that checkpoint.
It attests local durability only. A successful snapshot FileSync, Rename or even
DirectorySync followed by a failed marker still has persistence completed=0,
no published checkpoint and the original UNKNOWN status.

An explicit retry of the identical UNKNOWN may run the existing checkpoint
reconfirmation and report that real I/O. It preserves the original wire, member
hashes/results, fees and nonce, with zero new member/signature work. No timer
causes an automatic retry, alternate nonce or replacement intent.

## Validation source

Four focused tests use genuine dual-signature batches and actual temporary
disk checkpoints. They cover partial admission, exact/cold replay, independent
result slices, both individual signature corruptions, all rejected/memory
boundaries, blocked temp-file failures before/after snapshot rename, explicit
UNKNOWN reconfirmation and once-only balances/nonces. A separate writer case
injects the existing directory-Sync failure hook and compares actual file bytes
with canonical `json.MarshalIndent` bytes and observed write counters.

These new tests have been formatted and statically inspected. No local Go
compiler/test or node was run. Their actual remote CI outcome will be recorded
separately for the exact candidate commit.
