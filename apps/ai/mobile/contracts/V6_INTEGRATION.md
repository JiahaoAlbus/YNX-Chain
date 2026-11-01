# Original V6 mobile consumer integration

`src/taskV6.ts` consumes the sole SDK's `OriginalAITaskActionV6Client`
interface. `sdk047/*.d.ts` are byte-exact, type-only declarations from published
0475514dd461a3adf0ea316b941888a4677a3a19; hashes are in PROVENANCE.json.
No executable codec, canonicalizer, verifier, signer or Source is copied.

Normal product path: `Session.taskCredentials.v6` -> `createTaskAPI` ->
`createTaskV6API` -> SDK `prepare/prove/send`; `prove` owns SAME-held-review
production. The original bridge/SDK custodian must supply a freshly owned client
for this workspace, `nativeTaskV6Persistence`, and an operation-ID generator.
Workspace disposal aborts local requests and closes the original client;
`whenClosed()` exposes the original close completion/error to its parent.
P08 never creates a Native client from received JSON, an unsigned proof or a
public Source setter. A missing genuine client refuses new tasks before legacy
proof acquisition/network. Existing V2 reads and original reconcile remain V2.

The published 047 runtime export `original-ai-task-action-v6-client` is Node-only
(`browser:null`, `default:null`, imports node:util/Buffer). It cannot be imported
as an Expo/Hermes implementation. This product consumes its frozen types only.
The remaining minimum sole-SDK delta is an actual React Native compatible,
zero-input original client opener with this same finite interface, connected to
the original P01/Auth Native Source acquisition. Its own implementation must
preserve SAME held review, current/original bytes, outcome and query custody.
Do not turn the Source declaration into a product-side getter or fake bridge.
Auth/P01 must independently implement `acquireOriginalAITaskActionClientV6Source`,
review/produce/outcome/lookup and held-signing open_v3; no admission is implied.

V6 journal entries persist BEFORE SDK preparation/proof/send and retain only
version, original operation ID, action/task/binding/state and allowlisted cause.
No prompt, proof/member, Grant reference, model answer or private result is saved.
The V6 SecureStore namespace ends in `.v6`; V2 data is never copied/migrated.
UNKNOWN/PENDING blocks replacement effect/run IDs. Cold recovery uses retained
`lookupOriginal` only, returns opaque evidence DATA, and does not mark an operation
complete. Old V2 task/delivery metadata is query-only even under V6 credentials;
`recoverLegacyRun` uses the retained original V2 query transport without changing
that metadata. `task.handoff` remains unregistered by the sole SDK.

The PUBLIC client seams in consumer tests prove orchestration/failure handling,
not cryptography or Native/Source qualification. Actual installed-client approval,
server release registration and real tools remain separate acceptance gates.
Existing mobile CI already runs src/*.test.ts, typecheck and native builds.

## Original result and recovery consumption

`taskResults.ts` checks the normal Go product JSON after SDK verification. It
rejects cross-task/run/step results, unsafe integer revisions, stale generations,
wrong conversation/CAS holder, cancellation rollback claims and noncommitted tool
receipts. Go nil run steps normalize to an empty list. The unavailable-runtime
Go query's zero version fields are allowed only in recovery-only metadata; an
answer is never accepted in recovery/cancelled/blocked/UNKNOWN states.

Before a new run/result read the controller clears the formerly visible result;
a failed current check cannot leave an earlier answer presented as current. The
cache keeps independent task copies. Falsy corrupt V6 journals do not become new
empty journals. Retained original operation metadata is available through
`retainedOriginalOperations`; `recoverOriginalOperation` remains opaque DATA and
does not unblock UNKNOWN automatically. The present SDK `readRecovery` supplies
opaque evidence, not a terminal business-outcome contract: any future unlocking
requires a sole-SDK/Auth typed original-operation outcome with its normal custody
checks, never product-side parsing/assumption of COMMITTED.

The frozen PUBLIC Go-generated fixture/provenance under src/testdata was emitted
from the original local tool/model implementation. Client flow tests use an
explicit PUBLIC SDK seam to consume those actual result bodies; they do not
claim a real installed Native signing/source factory.

## Bounded event reconnect on existing contracts

Normal `TaskWorkspaceController.readRun` now uses `OriginalRunReconnect` when
constructed with `nativeRunCursorPersistence` (the existing native component
provides it). It uses only existing `task.read?afterCursor=N`, `task.run-read`
and `task.step-result` routes. The page is the original task sequence qualified
by one explicit run ID and its immutable record ID; no public event schema or
Auth action is added. The fixed SDK requires `?afterCursor=0` even for first read.

One request consumes at most one original 100-event page and at most 64 same-run
receipt reads. It filters delivered events to that run/its steps/task lifecycle.
After actual current run/result reads and consumer delivery succeed, the cursor
is persisted under a separate hashed identity/task/run key. Failure before cursor
save retains the previous cursor. Cold reconnect rereads original run/results
without starting/resuming a model or dispatching a tool. Local cancellation
aborts and joins reads before closing their original SDK client. A cancelled or
historical run may supply metadata from an older revision, never answer content.

Delta pages merge earlier unresolved steps; at 256 unresolved cached steps the
consumer refuses rather than silently dropping them. Only unrelated terminal
step metadata may be discarded to bound this in-memory cache. V6 request journal
compaction similarly retains every effect, PENDING and UNKNOWN; only terminal
read observations older than the latest 32 may be compacted. `task.reconcile` is
an original query and remains available while a prior effect is UNKNOWN. No
opaque original-operation evidence is treated as terminal business success.

## Original WebDAV result references

A model-run WebDAV step is the original WebDAV operation ID, not an Action-table
step. The existing `task.step-result` route now reads that same stored,
authenticated WebDAV receipt verbatim when no Action shares the ID. The original
Store snapshot captures its operation/holder/revision/generation metadata; the
outer Auth response remains a read-only OBSERVED response. No shared V6 field,
operation, Source factory or codec is added. Current-holder, account, original ID,
AEAD receipt integrity and ambiguity checks still reject invalid reads.

Mobile result/reconnect consumers preserve `CONTENT_PRESENT`,
`scope:external-content-observation-only` and `authorshipProven:false` in the
user-facing result. They do not relabel it COMMITTED, assert who wrote the object,
or infer current remote presence from a historical receipt. Reading this local
original result never sends a PUT or a new remote GET; UNKNOWN remains UNKNOWN
and requires the separately authorized original query path.
