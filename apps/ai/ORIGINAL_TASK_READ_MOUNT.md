# Original private task-read receiver mount

`apps/ai/main.go` now calls `OpenOriginalTaskReadReceiver(ctx, SAME server)`
after original runtime installation. This private Unix listener is separate
from public/V6 HTTP routing. No ENV/CLI/request can select its path, peer or
Source. Missing original registration returns an owned unavailable partial;
existing public service startup continues. Shutdown drains V6, then the receiver,
then its borrowed original runtime/Source owners.

The normal factory obtains only the SAME installed concrete
`nativeTaskRuntimeAuthority.localOwner`. The original Auth owner must supply
these private composition methods on that object (body not supplied by P08):

```go
ReadOriginalTaskReadReceiverRegistration(context.Context) (string, securelink.LocalCallerServerConfig, error)
AssertOriginalTaskReadReceiverCurrent(context.Context) error
```

The string is the original Source-selected Unix path; config carries original
registered peer UID/PID, service and routes. Handler must be nil: P08 supplies
its original resource Handler, preserving exact request identity. Config is
registration DATA, never a Grant or reservation capability. No setter or public
profile constructor is added. The factory accepts only service
`ynx-ai-original-task-read-v1`, exactly the three original POST paths, no duplicate
or alternate route, each with a positive bound <=1MiB. LINK validates the OS
identity, original private directory/socket and time/header bounds. The directory
must already exist; the receiver creates no authority file, directory, row or
new operation. It never removes/replaces a pre-existing socket.

Registration Current is checked before acquisition, around binding the listener
and before each original handler. Resource proof/capability checks still run in
the original resource. Source registration remains borrowed. Query history and
new-effect availability are distinct: a valid original history/current can keep
a receiver available for original queries when new effects are unavailable.
`NewEffectsUnavailable` is diagnostic only. Actual ReadInput/Execute still refuse
new effects through their own original policy/Source checks.

Retire cancels held calls and retires ingress/listener. Join waits actual LINK
handlers and serving work. Close refuses pending handler/claim or retained Source
cleanup debt and never closes the borrowed Source/Store. Original socket identity
remains for the owning operator to reconcile. A partial acquisition is retained
and follows the same bounded normal shutdown helper.

PUBLIC controls exercise the real Unix listener, genuine LocalCaller request,
actual receiver/Store/input/claim/receipt/query and shutdown. Registration and
capability/proof Source are PUBLIC fixtures. This proves no Root admission,
normal Native capability, real account/approval or complete Auth SQL settlement.
The real original registration producer and reservation getter remain Auth-owned
CODE. Exact Auth/LINK calling gaps are in P08's matching coordination function
cards; existing transport CI is not a replacement for those bodies.

## Matching Go continuation constructor

The normal mount now uses sole LINK
`NewOriginalTaskReadContinuationServer`, byte-exact from commit
`eb311202d8d0227a2a968b19d8fd751f58eade25`, including its same-commit
LocalCallerResponse DATA prerequisite. Input/query retain plain P; execute
requires R plus exactly one SCM_RIGHTS descriptor. A native local verifier's
execution also requires `OriginalTaskReadContinuationFromContext` from the
original LocalCaller private inventory. A JSON operation/binding/proof or copied
context cannot construct that transport object. The object is transport-only;
Auth must still verify its detached D against the entire signed binding and
same Source/private reservation. P08 does not parse a second Auth DATA schema.
The original Auth final claim selects synchronous bounded F under Store.mu;
there is no P08 direct F bypass or pre-dispatch claim.

Go-only intake is pinned in `ORIGINAL_TASK_CONTINUATION_INTAKE.json`. No old R2
physical/flat6 Node/NAPI image is loaded or patched by this intake. SDK consumes
the new continuation Native getter/module code closure as one matching cohort.
A missing original registration or Auth strong callee stays unavailable.

Mounted controls include real SCM_RIGHTS, the real LocalCaller inventory and
C/F control roundtrips at the actual resource mutex, plus plain-execute refusal
and active-claim drain. Their control peer and Auth proof/reservation decisions
are explicitly PUBLIC fixtures: not a Node WeakMap ticket, genuine Source,
strict Auth D decoder, real user permission or complete business admission.
