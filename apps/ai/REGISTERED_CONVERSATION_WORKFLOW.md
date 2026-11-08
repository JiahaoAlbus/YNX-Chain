# Original registered conversation tool workflow

The normal task runtime now sends `ai.conversation.read` through the SAME
original Auth authority broker used for registered effects. Shop keeps its own
selector/decoder. Broker readiness is not approval: original signed tool/target,
proof, Source, same-ticket reservation and receiver final claim still determine
whether execution is permitted. A native local signature gate without the
original broker still cannot activate production effects.

The existing model executor -> dispatchApprovedStep -> original broker sends
actual Grant/holder/input and leaves the NEW authority operation empty. Auth
assigns its operation. No Go code derives that operation from the product step
or Go semantic slot. The receiver is still the sole original resource executor:
genuine LocalCaller/private continuation + original Auth reserved policy -> one
Store.mu claim/read/encrypted result/operation save.

A resource-local COMMITTED is not an Auth-settled outcome. The broker preserves
partial original operation/state before interpreting late errors, but metadata
alone never admits model feedback. Acceptance requires the original broker's
verified COMMITTED result, exact authority operation/full selected source/input/
tool/fields, and byte-exact resource receipt matching the already durable local
result. Optional resource evidence must match both hashes and exact source bytes.
Only then is the original receipt encrypted in existing ResultWire fields and
atomically associated with the original step/Auth state. Save failure restores
the prior record/events/audit; it never reexecutes the resource.

Model feedback reads and checks that encrypted original wire. It sends the exact
stored bytes, not a reconstructed JSON receipt. Missing/changed scope, terminal
metadata without wire, different receipt bytes (including whitespace), changed
source/input/op or corrupt ciphertext cannot downgrade to a legacy local success.
External model disclosure remains independently authorized on the complete
outgoing provider body. No receipt grants model egress on its own.

Lost ACK can leave Action.Status=COMPLETED for the true local resource fact while
AuthorityReferenceState=UNKNOWN and the model run is UNKNOWN. New work/task
completion and feedback remain blocked. Reconcile now queries the original Auth
operation even in that local-COMPLETED state; it never reserves, reads input or
dispatches again. Original query material/proofs come from the independent
history source. Cold recovery reads the same encrypted image and exact original
receipt, then persists its verified wire before resuming the original model
checkpoint. An unconfirmed model response still cannot be resent under a new run.

The model run -> product step link is persisted with the original proposal in
one Store save BEFORE any effect or model-result return. This uses the existing
product-local step identity, not an Auth operation hash. A cold image already
contains both records if the process ends before persistTaskModelResult. Failed
proposal persistence rolls back run/step/task/events/audit together. Recovering
an older unlinked existing step records that same ID without creating a step or
changing its dispatch state. Holder/session/generation/runtime/run fences apply.

Concentrated controls use actual local HTTP model protocol, Unix LINK receiver,
sole typed policy and encrypted Store. Source/Grant verification, Auth result
verification and original private capability are explicitly PUBLIC seams; they
are not real SQLite reservation, Native C/D/F, Source or user admission. Tests
cover exact feedback, no replay, lost ACK/cold query, changed original rejection,
wire save rollback, pre-return atomic run/step recovery and missing-scope refusal.
Affected Shop, binding, dispatch, completion and resource regressions are included.

Authenticated user tool-result GET now uses the same settled-receipt gate as
model feedback. A local completed resource with Auth UNKNOWN returns 409 and
no private result, including after reopening the encrypted Store. After the
original query settles the same operation, GET returns the exact persisted
original JSON bytes, without reconstructing the receipt. Missing/corrupt wire,
missing scope, invalid operation, unknown Auth state and changed wire hashes
refuse; foreign accounts, holders and tasks remain 404. Reads are no-store and
do not mutate the durable image or call an executor, query or model. The private
resource original-query path remains independently available for settlement.

Cancellation uses the same unresolved-effect gate as scheduling and completion.
Thus a locally completed conversation with Auth UNKNOWN keeps the cancelled task
RECONCILING and its cancelled run UNKNOWN, preserving its first cause and exact
original step/operation. Cold recovery may query that original operation and
read its settled receipt. It cannot dispatch again or resume the cancelled
model. The cancellation record does not claim a remote rollback or rewrite the
resource-local completion fact.

The normal Go service consumes LINK eb311's real continuation inventory, the
original Auth strict decoder/reservation adapter, and the original owner's real
receiver registration/current methods. The byte-exact receiver intake is pinned
in ORIGINAL_AUTH_RECEIVER_CONSUMER_INTAKE.json. Its receiver-purpose Source
permission/current contract remains NOT_SUPPLIED; real Root registration and
provider qualification are separate gates. Missing receiver selection returns
no config, opens no listener and preserves the original grant Source first cause.
The latest LINK a9d7163 two-leaf JS successor and its qualified CI handoff are
explicitly selected only for subsequent normal consumer inputs; existing Go
production remains eb311. No installed/in-flight image is hot-swapped. Do not
promote HTTP DATA to a capability or claim installed/business/Root acceptance.

Normal service shutdown runs original V6 cleanup, original receiver/LINK drain
and resource closure, then the borrowed task runtime parent in one guarded
sequence. Any child cleanup error stops before its parents. The original
closures/owners and first error stay held; repeated cleanup cannot replay a
physical close or cross that debt. Failed startup runtime partials use the same
retention guard. This is cleanup custody, never evidence of Source admission.
