package productreadsource

import (
	"context"
	"testing"
	"time"
)

func TestSemanticObservationRefreshDoesNotRevokeOrRenewChild(t *testing.T) {
	a := publicAuthority("/PUBLIC/none")
	old := a.state.Load()
	now := time.Now()
	a.adoptOriginalObservation(old.scope, old.resource, "same", now, now.Add(time.Second))
	held := a.state.Load()
	a.adoptOriginalObservation(old.scope, old.resource, "same", now, now.Add(time.Hour))
	if e := a.atomicCurrent(context.Background(), held); e != nil {
		t.Fatal("same verified observation revoked legal child", e)
	}
	held.until = now.Add(-time.Second)
	if a.atomicCurrent(context.Background(), held) == nil {
		t.Fatal("parent refresh renewed expired child")
	}
}
func TestSemanticEpochABAAndCaptureCopies(t *testing.T) {
	a := publicAuthority("/PUBLIC/none")
	s := a.state.Load()
	now := time.Now()
	a.adoptOriginalObservation(s.scope, s.resource, "A", now, now.Add(time.Second))
	held := a.state.Load()
	data, e := a.captureObservedDATA(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	data.Scope.Operations[0] = "sign"
	data.Scope.Products[0].SourceOrder = "wrong-order"
	data.Profile.Orders[0] = "wrong-order"
	data.Selections[0].Actor = "wrong-owner"
	again, e := a.captureObservedDATA(context.Background())
	if e != nil || again.Scope.Operations[0] != "readOriginalInvoiceIntent" || again.Scope.Products[0].SourceOrder != "order-001" || again.Profile.Orders[0] != "order-001" || again.Selections[0].Actor != "actor-001" {
		t.Fatal("DATA copy changed original")
	}
	a.adoptOriginalObservation(s.scope, s.resource, "B", now, now.Add(time.Second))
	a.adoptOriginalObservation(s.scope, s.resource, "A", now, now.Add(time.Second))
	if a.atomicCurrent(context.Background(), held) == nil {
		t.Fatal("ABA revived original")
	}
	a.Retire()
	if _, e := a.captureObservedDATA(context.Background()); e == nil {
		t.Fatal("retired capture")
	}
}
