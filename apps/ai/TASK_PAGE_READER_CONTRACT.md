# P08 required original Browser/Auth callee — not a supplied/qualified Source

Current P08 normal consumer is `nativeTaskRuntimeAuthority.ReadOriginalTaskPages`
in `internal/aiproduct/task_page_native_reader.go`. It uses the original retained
`*grantruntime.Runtime`, whose original e56 dependency prefix predates this optional callee. Original Auth
has now supplied the complete reader r2 module in
`/Volumes/西部数据/YNX-large-work/auth-owned-r258/browser-page-runtime-successor-r2/HANDOFF.json`
(SHA256 c445b19653864c26369919125afed36f32be31fac0b388ec8f2b957e285840ac).
The isolated normal consumer composition verifies and uses that actual method;
it does not claim the unmodified live dependency prefix was hot-updated. The
independent genuine Browser capture/Source factory remains unconnected. Missing
method CODE is `AI_BROWSER_PROTECTED_PAGE_READER_NOT_SUPPLIED`; nil/unavailable
original Source is separately `AI_BROWSER_PROTECTED_SOURCE_NOT_SUPPLIED` (503),
with the original supplier cause retained. Neither implies model availability.

Required original Auth/SDK Runtime method (supplier owns implementation):

```go
func (r *Runtime) ReadOriginalBrowserPageReadout(
    ctx context.Context, requestDATA []byte,
) (originalP05BatchDATA []byte, err error)
```

The normal original Runtime already owns `Current(context.Context) error` and
retire/drain/close. No new public setter, `setProvider`, ENV socket, bearer-token
fallback, source-as-JSON qualification, or grant codec is requested. The product
uses a structural optional interface, so the supplier does not import aiproduct.
The original Auth Native/SDK owner must freeze the whole matching module and
portablecodec/E5 changes before intake; P08 will not copy individual grant leaves.

P08-owned product-selection DATA schema is `YNX_AI_BROWSER_PAGE_READ_REQUEST_V1`:
`schema`, `runId` (the original public run ID, including return rechecks), `session{id,account,deviceId,productClientId?,bundleId?,sessionBinding?}`,
`task{exact original TaskRecord}`, `references[{selectionId,version}]`,
`queryOriginal`, `authorizationRef?`. Exact code struct is
`originalTaskPageReadRequest`. Session token hashes, bearer/session secrets,
caller-supplied URLs, source bytes, provider/model overrides and approval booleans
are absent. These fields are selection DATA, never verified authority. Initial
reads require the original authorizationRef; original-return read checks are
queryOriginal=true and must reacquire only the exact retained snapshot scope.

Supplier implementation must acquire original resource/read authorization,
validate actual account/session/holder/task revision/generation and selected
versions/profile, retain the actual Browser IPC/Native Source, and bind its
unchanged preparationID to that task. Browser-local preparation is NOT itself
a task Grant; mapping is accepted only from this qualified original Source,
not request data. Fresh actual-task snapshots and explicit authorized retained
mapping both preserve the complete original bytes. No snapshot relabel/rehash.

IPC must invoke original P05 `readSelectedPageBatch`/normal Native giver through
its protected registered endpoint/current lifetime. No guessed URL, unsigned
local HTTP page reader, public file, scalar `qualified:true`, raw200, or LocalCaller
transport identity alone supplies resource or disclosure authorization. Original
Browser/Auth owns fixed registration, peer selection, private IPC and capture.
P08 never substitutes a native Swift or Auth implementation.

Return the exact existing P05 schema `YNX_BROWSER_SELECTED_PAGE_READOUT_V1`:
`schema,preparationID,profileID,pages[]` with original `snapshotUTF8` (not base64),
full-envelope hashes/byte length and AVAILABLE/STALE/UNAVAILABLE. Bound whole raw
response <=262144B; failure/partial must not release bytes. Original current must
cover actual DOM/source/task/profile scope, late-result/cancel/retire/drain. P08
separately rechecks Runtime.Current and full original batch metadata/hashes, and
then the existing original `CheckTaskModelDisclosure` admits each full outgoing
request plus final return. That check is NOT supplied by this method or by P05.

Existing P05 exact batch source/fixture pins:
`owners/P05/BROWSER-COMPARE-CURRENT.json` and
`owners/P05/P08-AUTH-MINIMUM-CONTRACT.md`. Public fixtures copied byte-exact to P08
`internal/aiproduct/testdata/browser-readout` are compatibility tests ONLY. The
new P08 tests perform actual LINK Unix/UID/PID roundtrips with PUBLIC synthetic
source/provider controls; they do not qualify the missing production Source.

Original Native approved report WRITE remains separate: the original report
attachment SHA256/length + task/rev/gen + configured destination is approved by
original Auth/Native, then the existing `AcquireOriginalWebDAVTask` loan guards
conditional PUT and independent GET. No read-only fence becomes WRITE authority.

## Exact frozen predecessor / current operation

377a736b187ffcd7726e97eb01ba62be8e98a87b source is the original
`/Users/huangjiahao/Desktop/YNX Final Worktrees/14-ai` branch `codex/final-ai`.
Exact nine-file source pins/build/normal-entry proof are
`owners/P08/golden-journey-20261101/DELIVERY.json` (SHA256 5aa9f931518b646e6afa077c37813195d797c879f28803c88c982d7cd7f73bb4).
New reader source is in that same worktree (no duplicate server/client thread).

Selected page references are inside the existing TaskNativeV6 actions
`task.run-start` / `task.run-resume` on `POST /api/tasks/{id}/runs`;
read-only history is `task.run-read` / `GET /api/tasks/{id}/runs/{runId}`.
There is currently NO separately registered selected-pages E5 action and P08
has not invented one. The original E5 BodyOriginal/request digest must cover
all original signed request bytes, including selectedPages and authorizationRef,
not a reserialized subset. Existing sole SDK projection CLI operation remains
`task-action-v6-request-digest-projection`; P08 does not copy its codec.

Original server factory is `openOriginalAITaskV6NodeServer()` from Auth
`normal-composition-r1`; source availability of that SERVER does not supply
client/review/sign Native getters, original Browser reader registration or
external-WRITE loan. Those remain independent CODE/qualification resources.
The product-selection DATA above is a downstream resource read request, not a
replacement E5 proof or a new verifier. The original Auth supplier must bind it
to its actual approved E5 action/session and same running TaskStoreSource.

## Caller lifetime delta (same method and DATA schema)

P08 registers each Source read in the original task cancellation boundary before
checking the current Store scope, including the initial capture before a model
run is persisted. All calls receive a context bounded to at most 30 seconds,
never beyond the original caller deadline. The supplier must honor cancellation
and release the exact original protected IPC/Native borrow; it must not create
replacement scopes or replay model/tool actions. A late response after task
handoff/cancellation is discarded. No new shared method, JSON key, signature
purpose, codec or admission row is required for this caller-only delta.

## Selected-pages finite SDK successor intake

The original sole SDK has supplied a complete candidate prefix rooted at
534c810569112a7f8f73b430ae3217be95bb180d plus its frozen 12-leaf delta:
`/Volumes/西部数据/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-task-v6-selected-pages-successor-20261101/HANDOFF.json`
(SHA256 e03a00459dfc16ed5b95450184ca036b0d115f3a29add9e3913828833ccb4850).
It retains exact7 legacy run bodies and permits exact8 only by adding
selectedPages (0..16 exact selectionId/version records, ordered, unique,
well-formed UTF8 ID1..128bytes and lowercase SHA512hex128). Original35-field E5
and raw body binding are unchanged; no selected-pages action/signing domain is
invented. P08 verifies the original PUBLIC vector through its real Go decoder
and original installed-CLI Bridge in the isolated matching prefix. The Go
request-digest projection remains dataOnly=true/signatureVerified=false and
SourceAdmission=false; actual PQ verification/genuine Source/Native review remain
in the original layers. Changing refs under the unchanged proof is rejected.
The full copied candidate, official780-file closure and retained original normal
module wrappers/query leaves are pinned separately; this is not a published
package, Auth-frozen union, Root admission or live SDK overwrite.
