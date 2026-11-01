# Native task workspace

The existing React Native application now mounts `TaskWorkspace` from its Tasks
tab and from the signed-out screen. It uses native components, the original
daemon task routes and its existing encrypted Store; it does not embed or
modify the historical Web UI.

The screen discovers owned tasks, pages results, selects the actual task
revision/generation/holder, creates a task for the selected conversation,
prepares a draft, submits an original authorization reference, reads committed
results, requests/resumes an original model run and queries an UNKNOWN original
step. Manual takeover means cancelling future scheduling. The confirmation
shows the actual task ID/revision/generation/holder and does not transfer a
holder, issue a Grant or promise remote rollback.

Cancellation remains available while a model request is in flight. Only a
successful original cancellation stops local waiting; a rejected cancellation
keeps the original request alive. Late model responses cannot overwrite the
cancelled screen state. Closing or changing the native session cancels local
requests and discards late view callbacks, while pending/unknown delivery
metadata remains in session-specific native secure storage.

The bounded delivery journal stores only original lookup IDs, revision,
generation, action and delivery status. It never stores model prompt/answer,
tool result, authorization reference or Wallet proof. Before any mutation it
persists PENDING; persistence failure prevents network dispatch. A lost response
becomes UNKNOWN, not success. An ambiguous original model delivery blocks a new
replacement run. Readback of that exact original run can mark metadata
ORIGINAL_OBSERVED; only then can the original resume path continue. Explicit
queries use the existing step/run, never another effect. The daemon's run read
route accepts the scoped original public run ID as well as its existing
internal key, preserving compatibility without replaying the provider.

`TaskCredentials.proof(scope, request)` is a transport operand supplied by the original
native Wallet/session owner. The legacy `Session.token` is **not** used for task
requests, and proofs are not cached or persisted. Every request selects a fixed
server route/scope and awaits a fresh proof. No method in this module generates
or verifies a Wallet proof, installs an authority, or silently swaps mobile to a
Web identity. The current legacy native login has no such normal getter yet;
its task workspace accurately renders authorization unavailable, preserves data
and disables private actions. Root/SDK/Auth own the actual mobile registration,
key custody and getter contract. No invented NativeModules hook is shipped.

Auth's 2026-11-01 clarification makes the compatibility gate explicit: native
V4 currently supplies session-read only. It cannot authorize task create,
approval, model disclosure or tool effects. The existing daemon's Web/V2 route
is not a native action contract; fresh P256/V2 support in historical fixtures is
not production authority. The IDE-specific V5 deployment path cannot be reused
for AI. The fixed V2 request adapter here is therefore inactive until the sole
SDK and Auth/Wallet owners supply a single matching AI native action contract
and the daemon consumes it. Do not attach a V4 read getter to `TaskCredentials`
or promote session-read into mutations. No matching native action callee is
claimed by this source, its tests or the exported bundles.

The original Auth local adapter is separately imported byte-for-byte at
`internal/authtasklocal`; normal composition retains its effect/history partial
owners and first errors, uses its verifier only in the conversation-read branch
and drains it before release. It does not enable local execution without the
original acquisition producer, same-SQL accounting or separate model disclosure.
It does not add a file tool or route Shop through local custody.

New controller tests exercise proof scopes, original request fields, failed
storage, response loss/restart, current-version confirmation, cancellation,
late callbacks, UNKNOWN original-query and run readback. Identity/result seams
are explicitly PUBLIC controls, not real task admission. iOS/Android Metro
exports are runnable JS/Hermes candidates for this native shell, not installed
or signed applications. Visual/runtime acceptance awaits the shared GUI window
and a real registered native session; build/export success is not that proof.

## Original approved tool execution

The native workspace now calls the existing dispatch route only for a current
`approved_not_executed` step whose task, revision, generation and holder match
the current projection and the reviewed step. Confirmation shows the tool, step,
input digest and approved fields. The server still checks the original Grant,
resource authority and effect fence. Submission is journaled before the request;
response loss survives restart and cannot cause another dispatch. Query and
committed-result read use the original step. A UI confirmation is not a Grant.

New model runs can select conversation plus `shop.order.read`. Resume sends no
replacement tool selection and retains the server checkpoint tool set. This is
order reading, not order creation, payment or approval of a purchase. Request
method, fixed route and JSON body bytes are captured before awaiting the signer,
then the exact body bytes are sent. The matching SDK owns canonicalization,
proof grammar and version; the inactive historical adapter is not V6 support.

The new snapshot and dispatch regressions are PUBLIC transport/controller
controls. Matching SDK/Auth native action authorization, actual protected Source
and real order lifecycle remain required before business acceptance.
