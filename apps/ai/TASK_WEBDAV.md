# Fixed WebDAV task delivery

The task service can deliver an existing encrypted attachment to a locally
selected origin/user/collection/object. Models select only `resourceId` and
`destinationId`; they cannot provide bytes, URLs, credentials or destination
paths. The fixed profile is copied by the normal in-process composition.

`PrepareOriginalTaskRuntimeWithWebDAV` attaches the adapter to the existing
task runtime. Its `OriginalTaskWebDAVAuthority` must borrow the original
registered **external WRITE/egress** loan for exact task, holder, original
operation, resource bytes and destination. The existing read-only TaskGrant
fence is not permission to PUT. Normal production has no supplied WebDAV WRITE
Source or runtime registration; a product session alone returns unavailable.
PUBLIC tests explicitly substitute only this authorization boundary with
synthetic owned attachments. They do not qualify Root, Native or real tenants.

Before sending, the original Store durably reserves UNKNOWN with the original
object and encrypted expected bytes. The complete record/receipt is AEAD
authenticated using the existing Store key. The operation never repeats its
PUT, including after lost acknowledgment, concurrent requests, persistence
failure, backup rejection or process restart. Recovery uses only GET of the
original object. An independently authorized original query can recover after
task cancellation/handoff without acquiring the new holder's authority.
Current is checked before each new request and after network waits. These
client checks cannot provide atomic revocation at the remote server.

Only an independent exact byte comparison returns `CONTENT_PRESENT`.
`authorshipProven` remains false; HTTP success, ETag and equal bytes do not
prove authorship. Absent, changed or partial content remains UNKNOWN and never
enables another PUT. The original observation, digest, ETag and remote ID are
persisted and returned to the model and owning user's result endpoint. Historical
receipts are not assertions that the remote content still exists now.

Normal service routes (canonical session plus independent Source required):

- `POST /api/tasks/{id}/webdav`: `operationId`, `resourceId`, `destinationId`,
  `taskRevision`, `generation`, `authorizationRef`.
- `POST /api/tasks/{id}/webdav/{originalOperationId}/query`:
  `authorizationRef`; selectors come from the retained original record.
- `GET /api/tasks/{id}/webdav/{originalOperationId}`: exact original receipt.

The normal `ynx-ai-task` CLI exposes `webdav-deliver`, `webdav-query` and
`webdav-result`; use `-task`, and `-step` for the original remote operation.
Use private `-proof-file` and `-data-file`, and the existing durable `-journal`
and distinct local `-operation` delivery ID for POSTs. Credentials never appear
in arguments or tool/model input. A new CLI delivery ID does not create a new
remote operation or make UNKNOWN retryable.

`ynx_webdav_deliver_v1` is opt-in in the existing task tool selection. Its
result returns the actual observation through the existing provider tool loop
and disclosure gate; framework tool completion is not remote authorship or
whole-task completion. Legacy default tool selection stays conversation-only.

The isolated upstream verification scripts and fixed official package/license
provenance are in [webdav-interop-README.md](scripts/webdav-interop-README.md).
WsgiDAV was actually exercised; Nextcloud namespace validation is implemented
but an actual Nextcloud deployment was not accepted. The official upstream
exhibited concurrent conditional-write and interrupted-upload limitations.
Never describe ordinary WebDAV as a target-side strong fence.

The isolated official-server launcher maps Ctrl-C to SIGTERM of its own child
and waits for that child. Only an explicitly requested shutdown is normalized
to success; unexpected upstream failure retains its original exit status. This
was checked against the original resumed object using GET only, without PUT.

Keep `webdavDeliveries`, original audit history and UNKNOWN across upgrades and
rollback. An older binary must not writable-open a Store containing these new
records. No production migration, deployment or rollback was performed.
