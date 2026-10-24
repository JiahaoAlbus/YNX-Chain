package developerauthority

import (
	"context"
	"testing"
	"time"
)

func TestOriginalCatalogAuthorityActualSameSourceAndHTTPPrincipal(t *testing.T) {
	source, dbState, _, _, _ := newControlRuntimeFixture(t, "")
	principal, httpState := principalHTTPFixture(t)
	factory := &OriginalDeveloperSourceFactory{principal: principal, control: source}
	p, e := principal.CurrentExistingPrincipal(context.Background(), actualPrincipalRequest())
	if e != nil {
		t.Fatal(e)
	}
	if e = factory.AssertCatalogAuthorityCurrent(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	dbState.mu.Lock()
	writes := dbState.writes
	dbState.mu.Unlock()
	if writes != 0 {
		t.Fatal("catalog liveness minted a control approval")
	}
	httpState.mu.Lock()
	httpState.change = true
	httpState.mu.Unlock()
	if e = factory.AssertCatalogAuthorityCurrent(context.Background(), p); e == nil {
		t.Fatal("changed original principal accepted")
	}
	expired := p
	expired.ExpiresMS = time.Now().UnixMilli()
	if e = factory.AssertCatalogAuthorityCurrent(context.Background(), expired); e == nil {
		t.Fatal("expired principal accepted")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if e = factory.AssertCatalogAuthorityCurrent(cancelled, p); e == nil {
		t.Fatal("cancelled context accepted")
	}
	if e = factory.AssertCatalogAuthorityCurrent(nil, p); e == nil {
		t.Fatal("nil context accepted")
	}
	if e = source.Close(); e != nil {
		t.Fatal(e)
	}
	if e = factory.AssertCatalogAuthorityCurrent(context.Background(), p); e == nil {
		t.Fatal("closed original Source accepted")
	}
}

func TestOriginalCatalogAuthorityNoAbsentOrPartialFactoryFallback(t *testing.T) {
	var absent *OriginalDeveloperSourceFactory
	p := Principal{Account: "PUBLIC", DeviceID: "PUBLIC", SessionRef: "PUBLIC", CurrentRef: "PUBLIC", AccountGeneration: 1, SessionGeneration: 1, ExpiresMS: time.Now().Add(time.Second).UnixMilli()}
	if absent.AssertCatalogAuthorityCurrent(context.Background(), p) == nil {
		t.Fatal("absent owner accepted")
	}
	for _, o := range []*OriginalDeveloperSourceFactory{{}, {firstCause: ErrUnknown}, {closeSelected: true}} {
		if o.AssertCatalogAuthorityCurrent(context.Background(), p) == nil {
			t.Fatal("partial owner accepted")
		}
	}
}
