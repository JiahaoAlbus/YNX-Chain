# Private synchronous Go Auth gate for P08

Owner: original Auth child `/root/auth_grant_effect`; parent original Auth
`019ffb08-3344-70b1-9d1a-33f8535a302e`. Sole V5 coordinator is
`01a19136-8605-7773-9d79-99c6f91c3a36`. Product core/API first; no Web write set.
The frozen JS source/H5993 remains byte-identical and is not replaced by this
Go supplier. This package contains no database, signing primitive, public WIRE,
HTTP endpoint, provider registry or mutable process-global authority setter.

## Actual local API

```go
check, err := authgrant.OpenTaskGrantAtEffect(ctx,
    originalProtectedVerifier, actualBinding, originalGrantProof, originalHolderProof)
if check != nil { defer check.Close() } // retain partial even when err != nil
if err != nil { return err }

// The following callback is constructed inside the original Go resource
// process. It is NEVER serialized, received as JSON or passed from JavaScript.
receipt, err := store.commitTaskReadAtEffectFence(ctx, originalExpectation, func() error {
    decision, err := check.CheckTaskGrantAtEffect(ctx)
    if err != nil { return err }
    // Retain/report decision.Scope separately from the local resource receipt.
    authScope = decision.Scope
    return nil
})
// Guard remains held until the actual read AND receipt commit have finished.
```

`CheckTaskGrantAtEffect(ctx, *TaskGrantCheck)` is also exported as a function
form. A Decision is in-process policy DATA, **not** a token or effect receipt.
The real method inspected in P08 is:

`/Users/huangjiahao/Desktop/YNX Final Worktrees/14-ai/internal/aiproduct/task_executor.go`

`func (s *Store) commitTaskReadAtEffectFence(ctx context.Context, expected taskReadExpectation, finalSnapshotCheck func() error) (taskReadReceipt,error)`

That original method holds `Store.mu`, validates account/task revision/gen/
holder/action/input digest/selected fields, and calls the final checker directly
before its real conversation read. The registered tool is
`ai.conversation.read` version `1`, not `shop.order.read`. This supplier never
writes P08's tree or claims its full package/integration tests were executed.

## Mapping the private P08 expectation

- `Account`, `TaskID`, `StepID`, `Holder`: preserve exact existing IDs.
- Task revision/generation: convert actual unsigned values with
  `strconv.FormatUint`, not floats or ad-hoc strings.
- Input `Bytes`: check the original integer is non-negative before converting
  to decimal; retain both actual SHA3-512/SHA-512 digests without re-encoding.
- Fields are exact `conversation`/`messages` selectors from the original
  authoritative action, not arbitrary caller field names.
- Actual conversation resource Ref/version and Source labels come from the
  original task/conversation adapter. Missing/unknown labels are not fabricated.
- Realm/tenant/holder identity epoch/session/channel/grant revision, trusted
  registered tool catalog/schema and ownership come from the original protected
  Source/verifier, not `approved_not_executed`, model text or a login session.
- Exact target and original granted resources/derived Source set are bound by
  the shared signed contract. A new target/tool/input cannot reuse an old grant.

New OPEN identities and proof payload encoding remain owned by the SDK. This
package does not convert a Wallet/device/product proof into an Agent grant.

## Required original interfaces

`OriginalTaskGrantVerifier.OpenTaskGrantSource(ctx, binding, grantProof,
holderProof)` must verify both original PQ branches, the complete shared
canonical payload and correct typed purposes against genuinely current
registered identities and roles. It then returns the original `HeldTaskGrantSource`.
A non-nil guard with an error is adopted into a partial `TaskGrantCheck` before
the error is returned, so the caller can drain it. Nil or typed-nil verifier/
guard is `UNAVAILABLE`; there is no caller `verified=true` path.

The held Source supplies `Snapshot`, `AssertCurrent(selectedVersion)`, immutable
`FenceScope`, and `Retire/Join/Close`. Current snapshot types in task_grant.go
are PRIVATE typed DATA, not a new public schema. The actual adapter must source
them from the original authority, not trust fields decoded from a request.

The gate captures the exact approved binding and proof bytes, checks current
issuer/holder/identity epochs, grant rev/nondelegable/time, task rev/gen/holder,
session/channel, trusted tool schema/purpose/risk, exact resource ownership,
source versions/labels, budget and independent disclosure. It rejects asset
actions and `wallet.approve` under ordinary task grants. It compares source/
policy versions to the selected original and rechecks retirement, cancellation
and time after Source calls and at the final return boundary. A later snapshot
cannot extend the earliest selected Source/grant/disclosure deadline.

`Retire` and `Close` are once-selected. First close error is returned unchanged
on later Close calls; partial Source custody is not silently lost or retried.

## Fence semantics and remaining production gap

`SameAuthorityResourceFence` is allowed only if the **actual original** Source/
resource authority fences Auth revocation and the final resource effect for the
entire held interval. P08's local Go mutex is not sufficient to assert that for
an independently committing Auth DB or remote service. It must not be promoted
by setting an enum in request DATA.

An original verified/held Source with only local read/egress enforcement returns
`EgressOnlyReadFence`. The gate then rejects writes and explicitly reports only
that weaker read/egress scope. Without any genuine held Source guard it rejects
all operations. A remote HTTP snapshot plus a local mutex is not a source lease
or a global revocation fence. These original production adapters are NOT_SUPPLIED.

The local resource receipt may truthfully say its read/receipt update was
same-resource atomic; that is separate from the Auth scope. Keep both facts.

Budget projects OTHER slots' spent/reserved totals plus this slot's original
requested amount exactly once; it compares signed grant cap/singleMax and uses
overflow-safe U64 addition. This module makes no reservation or global-budget
claim. Slot derives from realm/tenant/account/task/gen/step/operation. A known
UNKNOWN/COMMITTED/pending original operation never becomes a new effect here:
it returns `ORIGINAL_OPERATION_ONLY` and its original reference when supplied.
An authorized original-receipt read/recovery callee is separate; callers must
not create a new operation/nonce or replay this gate to guess completion.

Ordinary private read does not authorize model/external output. Egress requires
an independently authenticated exact current disclosure permit, including the
actual outgoing bytes and all derived sources/target. A conversation read that
does not yet know output bytes cannot fabricate that permit; AUTH09/10 remains
an additional owning dependency for later external/model dispatch.

## Evidence

Local tool: Go1.25.7 darwin/arm64, GOTOOLCHAIN=local, GOWORK=off, GOPROXY=off,
GOMAXPROCS=1. New isolated module only; no parent/whole-repository tests, network,
native/App build or old JS rerun. Final `go test -json -count=1 ./...` exited0,
package pass0.283s. Thirteen top-level tests include matrix subtests for current
versions, cross-tenant/holder/tool/target/input mutation, late retirement/expiry,
original Source partial/close, labels/disclosure, budget overflow, weak-scope
write refusal and UNKNOWN no replay. PUBLIC fixture Source/opaque proof bytes
are NOT actual signatures, Root admission, a running service or a real DB.
The positive local callback uses a counter under a fixture mutex; it is not a
claim that P08's real executor or a cross-service transaction ran.

The terminal JSON tool output was truncated by its display budget; the terminal
exit and final package-pass event were directly observed and retained as such
in evidence/TERMINAL.json. No missing raw lines are reconstructed or labelled
complete, and no extra test is run solely to manufacture a nicer handoff.
