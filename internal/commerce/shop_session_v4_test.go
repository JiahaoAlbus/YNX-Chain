package commerce

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type publicLegacyShopVerifierTrap struct{ calls int }

func (v *publicLegacyShopVerifierTrap) verifyOriginalShopSessionRead(*http.Request, string) (*verifiedBusinessRequest, error) {
	v.calls++
	return nil, ErrUnauthorized
}

func TestShopSessionInventoryV4HeaderSelectionNeverFallsBack(t *testing.T) {
	for _, test := range []struct {
		name       string
		header     http.Header
		v4, denied bool
	}{
		{"legacy", http.Header{"X-YNX-Product-Session-Proof-V2": {"PUBLIC"}}, false, false},
		{"v4", http.Header{"X-YNX-Product-Session-Proof-V4": {"PUBLIC"}}, true, false},
		{"mixed", http.Header{"X-YNX-Product-Session-Proof-V4": {"PUBLIC"}, "X-YNX-Product-Session-Proof-V2": {"PUBLIC"}}, true, true},
		{"case-alias", http.Header{"X-YNX-Product-Session-Proof-V4": {"PUBLIC"}, "x-ynx-product-session-proof-v4": {"OTHER"}}, true, true},
		{"multiple", http.Header{"X-YNX-Product-Session-Proof-V4": {"PUBLIC", "OTHER"}}, true, true},
		{"empty", http.Header{"X-YNX-Product-Session-Proof-V4": {""}}, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", OriginalShopInvoiceReadPath+"PUBLIC-order", nil)
			r.Header = test.header
			selected, err := originalShopV4Request(r)
			if selected != test.v4 || (err != nil) != test.denied {
				t.Fatal(selected, err)
			}
			s, _, ctx, actor := publicShopSessionFixture(t, "buyer")
			trap := &publicLegacyShopVerifierTrap{}
			s.registerOriginalShopSessionVerifier(trap)
			_, err = s.captureOriginalShopSessionForSourceRead(ctx, r, originalShopInvoiceReadScope{actor: actor, role: "buyer"}, nil)
			if err == nil {
				t.Fatal("PUBLIC header alone became a session")
			}
			if test.v4 && trap.calls != 0 {
				t.Fatal("V4 attempt fell through legacy verification")
			}
			if !test.v4 && trap.calls != 1 {
				t.Fatal("legacy verifier stopped receiving its original branch")
			}
			if len(s.s.ShopSessions) != 0 {
				t.Fatal("unverified header populated durable session inventory")
			}
		})
	}
}

func TestShopSessionInventoryV4ForeignPermissionCannotMint(t *testing.T) {
	s, _, ctx, _ := publicShopSessionFixture(t, "buyer")
	source := &publicShopProductSource{store: s}
	h := &originalShopProductReadHold{authority: &originalShopProductReadAuthority{source: source}, permission: &publicShopProductPermission{source: source}, request: ctx}
	if v, e := h.verifyOriginalShopSessionV4(ctx); v != nil || e == nil {
		t.Fatal("arbitrary Source permission became an original Auth V4 owner")
	}
	var zero *originalShopProductReadHold
	if v, e := zero.verifyOriginalShopSessionV4(ctx); v != nil || e == nil {
		t.Fatal("nil Source hold gained V4 authority")
	}
}

// PUBLIC close mechanics only. These objects supply no Source, signature,
// Auth issuer or Root; the real supplier's process/FD witnesses are separate.
type publicFinishedShopPermission struct {
	done          atomic.Bool
	finishOnClose bool
	calls         atomic.Int32
	first         error
}

func (p *publicFinishedShopPermission) current(ctx context.Context) error { return ctx.Err() }
func (p *publicFinishedShopPermission) close() error {
	p.calls.Add(1)
	if p.finishOnClose {
		p.done.Store(true)
	}
	return p.first
}
func (p *publicFinishedShopPermission) assertOriginalClosed() error {
	if !p.done.Load() {
		return ErrConflict
	}
	return nil
}

func TestShopSessionInventoryV4CloseFirstErrorAndPhysicalDoneIndependent(t *testing.T) {
	for _, immediate := range []bool{true, false} {
		name := "pending-finishes"
		if immediate {
			name = "done-with-first"
		}
		t.Run(name, func(t *testing.T) {
			first := errors.New("PUBLIC original request failure")
			p := &publicFinishedShopPermission{first: first, finishOnClose: immediate}
			h := &originalShopProductReadHold{permission: p}
			a := &publicInvoiceReadAuthority{}
			svc := &OriginalShopInvoiceReadService{authority: a, children: map[uint64]originalShopInvoiceReadHold{1: h}}
			if e := svc.release(1, h); e != first {
				t.Fatal("first cause lost", e)
			}
			if immediate {
				if len(svc.children) != 0 || svc.retired.Load() {
					t.Fatal("completed request retired unrelated service or leaked child")
				}
			} else {
				if len(svc.children) != 1 || !svc.retired.Load() {
					t.Fatal("pending child debt was dropped")
				}
				p.done.Store(true) // Original owned work completed; no new close selected.
			}
			if e := svc.Close(t.Context()); !errors.Is(e, first) || !svc.PhysicalClosed() {
				t.Fatal("first and physical completion conflated", e)
			}
			if p.calls.Load() != 1 || a.closed.Load() != 1 || len(svc.children) != 0 {
				t.Fatal("completed original was closed twice or parent released incorrectly")
			}
			_ = svc.Close(t.Context())
			if p.calls.Load() != 1 || a.closed.Load() != 1 {
				t.Fatal("repeat service close replayed physical cleanup")
			}
		})
	}
}
