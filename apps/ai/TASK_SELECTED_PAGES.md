# Selected Browser pages in the original AI task loop

The P08 consumer uses the existing task service, fixed model gateway, encrypted
Store, model disclosure admission, original handoff CAS, attachment API and
WebDAV delivery journal. It adds no panel, issuer, Grant codec, Browser fetcher
or remote-write authority. Ordinary browsing does not need this integration.

## Normal composition and request

The original in-process `OriginalTaskRuntimeAuthority` composition may also
implement `OriginalTaskPagesAuthority.ReadOriginalTaskPages`. Installation in
`PreparedOriginalTaskRuntime.install` captures that exact operand; a request,
environment flag or model cannot install one. The method must borrow original
Browser/resource authority, check account, actual task/revision/generation,
ordinary profile and current document, and return detached snapshots after
releasing its borrows. It must not fetch a caller URL. The normal Native adapter now implements this consumer and invokes the optional
`ReadOriginalBrowserPageReadout(context.Context, []byte) ([]byte,error)` method on
the SAME original Auth Runtime. The original dependency prefix predates the callee; original Auth has now
supplied complete reader r2 for isolated normal composition. A missing API is
reported separately from the existing API with an unavailable genuine Source
(`AI_BROWSER_PROTECTED_SOURCE_NOT_SUPPLIED`, HTTP503), retaining original causes
and never invoking a provider on either failure. The required exact signature/selection
DATA schema is documented in `TASK_PAGE_READER_CONTRACT.md`. This is a concrete
supplier CODE gap; no PUBLIC/file/socket fallback can fill it.

The existing `POST /api/tasks/{id}/runs` / CLI `run-start` or `run-resume` body
accepts optional `selectedPages`:

```json
{
  "runId": "original-run-id",
  "taskRevision": 2,
  "generation": 1,
  "prompt": "Compare the approved pages and state missing evidence.",
  "authorizationRef": "original-protected-reference",
  "selectedPages": [
    {"selectionId": "original-browser-selection-id", "version": "128-lowercase-hex-original-SHA512"}
  ]
}
```

IDs/digests select snapshots; they are not approval. The original model service
configuration fixes provider and model. `CheckTaskModelDisclosure` must admit
the entire actual request (including decoded selected fields and every tool
result), separately from page/resource approval. No provider credentials, page
bytes, recipient, URL override, private-tab flag or approval is accepted in the
request. Existing SDK/Auth NativeV6 action schema/qualification remains the
original owner's responsibility; this field does not register a new action.

`TaskPageSnapshot` copies the P05 selection metadata and original snapshot
bytes. `Content []byte` is base64 only in the in-process JSON persistence
projection. It is the exact P05 `YNX_BROWSER_SELECTED_PAGE_V1` JSON bytes,
including schema/tabID/profileID/generation-as-string/origin/taskID/fields/content.
The consumer uses standard-library SHA3-512 and SHA-512 and byte length against
the original bindings and compares all payload metadata; it never reserializes
the original bytes to create a replacement version. Only a separate model
projection decodes its selected fields. Local preparation IDs cannot be relabeled or rehashed. `preparationId` retains
the original envelope identity, separately from the outer actual AI `taskId`.
Only the qualified original Source may bind that unchanged preparation to the
actual task/revision/generation/holder; HTTP/model input cannot supply that map.
The Browser may also create fresh individual snapshots after choosing an actual
task reference. SourceClass SELECTED_BROWSER_PAGE and ContentTrust UNTRUSTED
are fixed consumer classifications, not resource/disclosure authority. Legacy
encrypted snapshots and canonical report fields remain unchanged on upgrade.
This is product input validation, not a new cryptographic verifier.

`AVAILABLE` includes only the selected url/title/text fields. `STALE` and
`UNAVAILABLE` contain no content; those original missing-page labels are sent
explicitly. At most sixteen references and a 256KiB serialized snapshot set
are accepted. Snapshots are encrypted/authenticated in the existing run record.
Every provider admission and final answer return checks the original snapshots
again, before and after disclosure authorization. Navigation, content/version
change, source loss, task handoff or revision change blocks the corresponding
send/return. These are observed consumer checks, not an atomic remote resource
fence. Already verified historical results are read-only observations.

## Human continuation, report and delivery

Use the original authorized task handoff (`POST /open/v1/tasks/{id}/handoffs`)
for human takeover. Its CAS changes the holder/revision/generation and retains
original operations. The new holder submits revised instructions as a new run
of that same task under new original approval; old holder/late results cannot
resume work. Model text is not approval. No replacement task or panel is created.

The original run result now includes task revision/generation, exact admitted
provider/model and source labels (without page bytes). These are provenance
labels, not proof that the model's prose or citations are true. `GET
/api/tasks/{id}/runs/{originalRunId}` / CLI `run-show` reopens the retained result
without contacting Browser, model or DAV; existing handoff/history restrictions
continue to apply.

To store the exact verified current report, use the existing attachment route:

```http
POST /api/conversations/{conversationId}/attachments
Content-Type: application/json

{"taskId":"original-task-id","runId":"original-run-id"}
```

Do not mix this with name/mimeType/contentBase64. The handler uses the original
current session/task/run and creates an encrypted `application/json` attachment
from the canonical original result projection. Same-result retries return the
same authenticated attachment; a changed holder/revision, blocked/UNKNOWN model
run or another conversation cannot materialize a report. This is local storage,
not human report approval. Existing bounded file attachment behavior remains.

Now pass that attachment ID and its exact SHA256/length to the original protected
review/WRITE Source. Use existing `webdav-deliver` with that resourceId, original
operationId, current task revision/generation and the preconfigured destinationId.
The Source independently binds the exact report bytes and fixed private directory;
there is no target/path override. CONTENT_PRESENT requires independent exact GET,
not authorship or business finality. Query UNKNOWN under its original operation
and object only. `webdav-result` reads the original durable receipt without PUT.
See `TASK_WEBDAV.md` for original-replay and remote-fence limits.

## Verification boundary

`TestP08Pages*` is part of the original runtime CI. The official-WebDAV job also
runs `TestP08PagesOfficialExactReportDelivery` against the pinned unmodified
WsgiDAV server. Tests cover original byte encodings, versions/missing pages,
normal prepared-server consumption, human handoff/revision, late page and model
results, quota429/no fabricated report, report materialization, exact destination
receipt and read-only reopen. These use explicitly PUBLIC synthetic page,
provider and approval operands. Only the isolated official DAV network effect
is a real upstream observation. They do not qualify real Browser page consent,
paid model quota, Native approval, production Source, installed UI or deployment.

Task completion now consumes authenticated original WebDAV tool observations as
well as existing tool receipts. It requires a returned/decryptable current model
answer and exact run task revision/generation/holder. Task-level UNKNOWN or a
tampered external record blocks new scheduling/closure, even if a different
ordinary tool completed. Only original query recovery proceeds; an observation
can close local orchestration without becoming authorship or remote finality.

## Source read cancellation and cold recovery

The first selected-page read now joins the original task's cancellation boundary
before any model run exists. Each admitted read has its own private handle,
including concurrent calls for the same original run. Registration precedes a
fresh Store fence; cancellation either finds that read or the Store fence rejects
it. The original task cancellation handler interrupts its Source context. Foreign
accounts cannot cancel it. Read contexts are bounded to 30 seconds and retain any earlier
caller deadline; the supplier must honor cancellation. A final task/revision/generation/holder/configuration fence
rejects late bytes after handoff, cancellation or a changed task, even if a
producer did not respect its cancelled context. The original protected supplier
must honor that context and release its original IPC/native borrow.

Loading an encrypted page checkpoint rechecks its bounded closed JSON shape,
original task/preparation, selected references, both hashes, byte counts, field
scope, trust labels and duplicate identity. Unknown fields, missing ciphertext
with a retained binding and malformed nonces fail without returning partial page
DATA. A generic encrypted Store read now rejects malformed nonce lengths before
AEAD.Open instead of allowing a panic. Existing valid encrypted formats and
legacy labels are retained.

A final answer blocked only because the original Source is temporarily unavailable
remains encrypted under the original run. Cold recovery rechecks those original
snapshots and the original disclosure, then releases that same answer. It does
not call the model, replace the prompt/snapshot, or turn a blocked answer into a
new run. Read-only history remains independent from a new Source/model call.
These lifecycle changes do not widen the frozen seven-key NativeV6 record, add
an E5 action, or supply the missing protected Source/Native approval.

The sole SDK finite selectedPages successor is now source-supplied and consumed
in the matching isolated prefix. Its exact7/exact8 raw-body contract and original
E5 remain unchanged. Product reference validation preserves valid UTF8 bytes,
including multi-byte IDs at the128-byte bound, without normalization. The PUBLIC
SDK vector is checked by the actual product decoder in existing runtime CI;
matching complete CLI build selection additionally exercises the original Go
Bridge. A digest projection is DATA only, not PQ/Root/Source/human approval.
