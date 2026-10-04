//go:build commerce_v2

package commerce

import (
	"context"
	"errors"
	v2 "github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOriginalShopRevokedSourceStopsPrivateHandler(t *testing.T) {
	p := &PreparedOriginalShop{current: func(context.Context) error { return errors.New("source revoked") }}
	calls := 0
	r := httptest.NewRecorder()
	p.GuardedOriginalHandler(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls++ })).ServeHTTP(r, httptest.NewRequest("POST", "/api/orders/original/transition-intent-lookup", nil))
	if r.Code != 503 || calls != 0 {
		t.Fatalf("status %d calls %d", r.Code, calls)
	}
}
func TestOriginalShopSourceChangedInsideActorFenceStopsCommit(t *testing.T) {
	revoked := false
	p := &PreparedOriginalShop{current: func(context.Context) error {
		if revoked {
			return errors.New("source revoked")
		}
		return nil
	}}
	binder := p.bindCurrent(func(*http.Request, v2.Session, v2.BrowserGrant, string) (func() error, error) {
		return func() error { revoked = true; return nil }, nil
	})
	f, err := binder(httptest.NewRequest("POST", "/api/orders/original/transition-intent-lookup", nil), v2.Session{}, v2.BrowserGrant{}, "original-operation")
	if err != nil {
		t.Fatal(err)
	}
	if f() == nil {
		t.Fatal("late source change accepted by commit fence")
	}
}
