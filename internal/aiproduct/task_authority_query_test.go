package aiproduct

import (
	"context"
	"errors"
	"testing"
)

type p08AuthorityQueryFixture struct {
	*p08RuntimeAuthorityFixture
	reference originalTaskOperationReference
	err       error
	calls     int
}

func (f *p08AuthorityQueryFixture) queryOriginalTaskOperation(_ context.Context, request OriginalTaskAuthorizationRequest) (originalTaskOperationReference, error) {
	f.calls++
	if !request.QueryOriginal || request.OriginalOperationID != request.Step.ID {
		return originalTaskOperationReference{}, errToolConflict
	}
	return f.reference, f.err
}

func p08UnknownAuthorityQuery(t *testing.T) (*p08ShopFixture, *p08AuthorityQueryFixture) {
	t.Helper()
	f := newP08ShopFixture(t, true)
	f.approve(t)
	f.caller.callErr = errors.New("PUBLIC response lost")
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("fixture did not retain UNKNOWN")
	}
	source := &p08AuthorityQueryFixture{p08RuntimeAuthorityFixture: f.authority, reference: originalTaskOperationReference{State: "UNKNOWN", OperationID: "original-node-authority-operation"}}
	f.prepared.authority = source
	return f, source
}

func TestP08OriginalAuthorityReferenceIsNeverReceipt(t *testing.T) {
	for _, state := range []string{"UNKNOWN", "COMMITTED", "FAILED"} {
		t.Run(state, func(t *testing.T) {
			f, source := p08UnknownAuthorityQuery(t)
			source.reference.State = state
			resolves := f.authority.resolveCalls
			receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
			if err == nil || receipt.State == "COMMITTED" {
				t.Fatal("authority reference became a resource receipt")
			}
			f.store.mu.Lock()
			step := f.store.state.Actions[f.step.ID]
			f.store.mu.Unlock()
			if source.calls != 1 || f.authority.resolveCalls != resolves || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 0 || step.Status != "UNKNOWN" || step.ToolStep.ResultCipher != "" || step.ToolStep.AuthorityOperationID != source.reference.OperationID || step.ToolStep.AuthorityReferenceState != state || step.ToolStep.RemoteRef != "shop-original-ref" {
				t.Fatal("query replayed effect, lost original refs or fabricated result")
			}
		})
	}
}

func TestP08OriginalAuthorityQueryPartialReferenceAndConflict(t *testing.T) {
	f, source := p08UnknownAuthorityQuery(t)
	source.err = errors.New("PUBLIC late Source expiry")
	_, _ = f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	f.store.mu.Lock()
	before := *f.store.state.Actions[f.step.ID].ToolStep
	f.store.mu.Unlock()
	if before.AuthorityOperationID != source.reference.OperationID {
		t.Fatal("nonzero partial reference lost with late error")
	}
	source.err = nil
	source.reference.OperationID = "unrelated-operation"
	_, _ = f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	f.store.mu.Lock()
	after := f.store.state.Actions[f.step.ID]
	f.store.mu.Unlock()
	if after.ToolStep.AuthorityOperationID != before.AuthorityOperationID || after.ToolStep.EffectFirstCause != before.EffectFirstCause || after.Status != "UNKNOWN" {
		t.Fatal("conflicting reference replaced original or first cause")
	}
}

func TestP08OriginalAuthorityReferenceSaveFailureRollsBack(t *testing.T) {
	f, source := p08UnknownAuthorityQuery(t)
	originalPath := f.store.path
	f.store.path = originalPath + "/not-a-file"
	_, _ = f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	f.store.mu.Lock()
	step := f.store.state.Actions[f.step.ID]
	f.store.mu.Unlock()
	if step.ToolStep.AuthorityOperationID != "" || step.Status != "UNKNOWN" {
		t.Fatal("failed save changed authority reference/status in memory")
	}
	f.store.path = originalPath
	_, _ = f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	f.store.mu.Lock()
	step = f.store.state.Actions[f.step.ID]
	f.store.mu.Unlock()
	if step.ToolStep.AuthorityOperationID != source.reference.OperationID || f.caller.calls.Load() != 1 {
		t.Fatal("original reference recovery dispatched a new effect")
	}
}
