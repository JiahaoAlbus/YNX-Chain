# Original task action outcomes

`TaskStoreSource` now owns actual product-local execution and original outcome
readback. This does not install native V6 authentication or an Auth/Grant Source.
Original Auth must verify registration, identity, session, current policy,
revocation and its original once slot before calling the normal server entry:

```
Server.ExecuteOriginalLocalTaskAction(ctx, heldTaskSnapshot, TaskActionCall)
```

`TaskActionCall` contains the original operation ID, original Auth request ref,
sole-SDK E5 request digest, sole-SDK SHA256 raw-body digest, exact method/path,
action and original body bytes. The executor freezes the body and checks its
hash. It does not implement E5 encoding or authenticate N1 signatures. The
shared SDK's normal Go/CLI bridge remains the only request digest producer.

The closed local actions are `create-task`, `prepare-task`, `propose-tool-step`,
`cancel-task` and `complete-task`. They use the existing Store methods and
normal production JSON response writer. No caller-supplied state, response
body, receipt status, HTTP 200, callback or current snapshot can create a
committed outcome. Proposal is still NEEDS_APPROVAL; cancel closes future
scheduling without undoing remote work; complete still requires verified
results and refuses PENDING/SENT/UNKNOWN/unreconciled effects.

The original PENDING slot is persisted first. Only then does the Store run the
local transition under its mutex on a working copy, stage its ordinary saves,
serialize the real response through the production writer, and persist the
resource state, audit, original operation binding and sealed body together.
The final file is synced, renamed and its directory synced. The full metadata
and exact body bytes are authenticated together by the existing Store AEAD.
Persistence failure restores the previous product state and keeps the original
reservation query-only. A lost ACK after commit is recovered by original lookup;
it never repeats the CAS or creates another operation. Cross-Auth-SQLite/Store
work remains separate phases; it is not one database transaction.

The Source-owned opaque receipt provides exact `Body()`, `View()`, `Current()`
and `Release()/Close()`. The narrow original Auth lookup ABI is:

```
TaskStoreActionOriginalLookup{Principal, OperationID, RequestDigest, Action}
TaskStoreSource.CaptureOriginalActionOutcome(ctx, lookup)
  -> (*TaskStoreActionOutcome, error)
TaskStoreActionOutcome.Current() error
TaskStoreActionOutcome.View() (TaskStoreActionOutcomeView, error)
TaskStoreActionOutcome.Release()/Close() error
```

The narrow view contains OperationID, RequestDigest, Action, OriginalRef,
State, Status, BodyDigest and BodyBytes. OriginalRef is the real product slot
key; it is distinct from Auth's RequestRef. COMMITTED is produced only after
actual local business commit and exact response serialization. A durable
PENDING projects UNKNOWN with no fabricated response digest/status. Returned
partial values must be collected before errors. SHA256 response digest/length
come from the actual writer bytes, not the Store's separate SHA3/SHA512 binding.
A normal network ACK is not a prerequisite to recover an already sealed durable
business result; delivery failure does not undo that result.

`Current()` checks a private immutable atomic index of actual persisted records,
context, retirement and release, with no IO or mutex acquisition. It is usable
inside the Store lock. Later task epochs do not invalidate an immutable original
outcome. Deleted/foreign conversation ACLs and replaced records invalidate its
index entry. This proves only the original outcome remains available; it grants
no current-holder write rights. Auth must independently AND current identity,
Root/revocation/policy and response expiry/monotonic fences. Writer task snapshots
still become stale after commit; original readback does not renew them.

Public semantics follow the coordinator's single V6 decision: Auth once/nonce
admission is internal AUTH_ADMITTED, never public COMMITTED. Async actions need
a separate genuine ACCEPTED business receipt. This local executor refuses
external dispatch/model and handoff operations. It cannot create an ACCEPTED
receipt from transport status. Handoff stays UNREGISTERED pending original
inactive Grant, actual CAS receipt, activation and old-holder revocation; a
metadata CAS alone cannot prove the complete handoff.

## Read observations and approval boundary

Root's final closed decisions are COMMITTED, ACCEPTED, OBSERVED, DENIED and
UNKNOWN. Actual read/list/result/query/run-read is OBSERVED with scope
READ_ONLY_OBSERVATION. `TaskStoreSource.ObserveOriginalTaskRead` calls only the
fixed existing GET handlers with the real verified actor. Its opaque
`TaskStoreObservation` provides Current/View/Body/Release/Close. Exact body
SHA256/length come from that production writer; any concurrent Store change
across a snapshot read refuses its observation. Old-holder history is limited
to original records; task discovery filters before pagination and cannot reveal
unrelated new-holder tasks through an account-wide list.

`ObserveOriginalTaskOutcome` reads only the original opaque business result:
its payload can show the original action's COMMITTED/UNKNOWN evidence, while
this read remains OBSERVED and performs no new CAS, nonce or approval.
`ObserveOriginalTaskQuery` calls the existing original-effect reconciliation
path, never dispatch. When reconciliation actually recovers/persists an original
result it verifies exact writer bytes against a new locked readback, so the
old pre-recovery epoch does not permanently reject successful observation.
Current holders may read their permitted result; old holders get only original
minimal recovery metadata. Missing original history for an uncertain operation
cannot produce OBSERVED. An already verified stored result can be read without
reactivating the original effect producer. Auth still independently checks
identity, Root, current policy/revocation and the decoded action/route schema.

Task approval has a different scope, TASK_APPROVAL_COMMIT_ONLY. The existing
`commitTaskApprovalAtFence` remains behind the original protected verifier.
The old generic grant/current interface is not a new SameHeldReview UI proof.
No public V6 approval COMMITTED receipt is inferred from a stored approved flag
or ordinary current callback. The actual Auth-owned SameHeldReview/activation
callee must be supplied and consumed before that producer is activated. Read
observation of an old approval flag does not grant a new approval or effect.

## Normal private runtime adapter hooks

`Server.OpenTaskStoreSource()` is the sole no-argument source getter for the
running Server's real Store. It refuses nil/uninitialized servers, accepts no
external Store/path and neither registers authority nor starts a listener. Its
returned source owner belongs to the original Auth/LINK composition and must
be retired/closed there. No synonymous getter is introduced.

The private runtime follows the original Go HTTP handler's still-live request
and context into Node Auth. Finite typed business callbacks use that same
HTTP/SCM lifetime; an intermediate capture response must not prematurely retire
the held product objects. A detached context, a JSON lease selector or a Node
boolean cannot extend the lifetime or replace Go at-CAS Current. Original LINK
owns transport custody/current; Auth owns the Node kernel/issuer and Go endpoint.
P08 owns only its actual Server/Store producer and necessary normal hooks.

The sole SDK 97e8f2e0 V6 body bound is 1,048,576 bytes. Observation production
uses that signed-body bound even though private transport can carry 32 MiB.
An oversized actual normal writer body returns
`AI_TASK_V6_OBSERVATION_BODY_LIMIT`, produces no OBSERVED object and leaves the
original stored result intact. Bytes and digest are never truncated/reused.

A V6 proof header reaching the legacy authorizer is rejected with
`AI_TASK_V6_RUNTIME_REQUIRED`, including an explicitly empty V6 header. The
normal original V6 forwarder must handle the request before the legacy product
handler; it cannot fall back to V2 or fixture credentials after V6 admission.
