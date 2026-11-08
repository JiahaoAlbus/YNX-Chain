package commerce

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// PUBLIC mapping/lifetime controls. This fixture supplies neither Root/Source
// nor an Auth signature. The normal accepted-v2 entry is separately tested.
func publicShopSessionFixture(t *testing.T, role string) (*Store, *verifiedBusinessRequest, context.Context, string) {
	t.Helper()
	s, e := Open(filepath.Join(t.TempDir(), "state.json"))
	if e != nil {
		t.Fatal(e)
	}
	_, merchant := actor(t, 9)
	_, actor := actor(t, 7)
	native, e := accountaddress.Encode(actor)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.CreateStore(merchant, CreateStoreInput{Name: "Verified goods", Policy: "30 day return policy", IdempotencyKey: "store-key-0001"}); e != nil {
		t.Fatal(e)
	}
	s.shopSessionDomain = &originalShopSessionDomain{realm: ChainName, tenant: merchant, current: func(context.Context) error { return nil }}
	v := &verifiedBusinessRequest{shopSessionIssuer: &verifiedShopSessionIssuer{effectDigest("PUBLIC-original-Auth-session")}, walletAccount: native, principal: Principal{Account: actor, Role: role, SessionBinding: strings.Repeat("a", 43), ExpiresAt: time.Now().Add(time.Hour).UTC()}, fence: func() error { return nil }, revalidate: func(context.Context) error { return nil }}
	return s, v, context.WithValue(context.Background(), businessRequestContextKey{}, v), actor
}
func observeCaptureShopSession(t *testing.T, s *Store, v *verifiedBusinessRequest, ctx context.Context) *OriginalShopSession {
	t.Helper()
	if e := s.observeOriginalShopSession(ctx, v); e != nil {
		t.Fatal(e)
	}
	h, e := s.CaptureOriginalShopSession(ctx)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = h.Close() })
	return h
}
func TestShopSessionInventoryOriginalColdRevokeAndNoResurrection(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	d, e := h.DATA(ctx)
	if e != nil || d.Generation != 1 || d.Realm != ChainName || d.Account != v.walletAccount {
		t.Fatal(d, e)
	}
	if e = s.observeOriginalShopSession(ctx, v); e != nil || s.s.ShopSessionGeneration != 1 {
		t.Fatal("same session renews generation", e)
	}
	if _, e = s.CaptureOriginalShopSession(context.Background()); e == nil {
		t.Fatal("detached context became authority")
	}
	old := v.principal.ExpiresAt
	v.principal.ExpiresAt = old.Add(time.Minute)
	if e = s.observeOriginalShopSession(ctx, v); e == nil {
		t.Fatal("original expiry renewed")
	}
	v.principal.ExpiresAt = old
	if e = s.RevokeOriginalShopSession(ctx); e != nil || h.CurrentLocal() == nil {
		t.Fatal("local retirement not synchronous", e)
	}
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	cold.shopSessionDomain = s.shopSessionDomain
	if e = cold.observeOriginalShopSession(ctx, v); e == nil {
		t.Fatal("cold original resurrected")
	}
	if _, e = cold.CaptureOriginalShopSession(ctx); e == nil {
		t.Fatal("cold revoked capture")
	}
	if e = cold.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "old.json"), 18); e == nil {
		t.Fatal("rollback erased inventory tombstones")
	}
}
func TestShopSessionInventoryActualOrderAndSellerMembership(t *testing.T) {
	for _, role := range []string{"buyer", "seller"} {
		t.Run(role, func(t *testing.T) {
			s, v, ctx, a := publicShopSessionFixture(t, role)
			_, owner := actor(t, 9)
			st, p := setupCatalog(t, s, owner, 4)
			if role == "seller" {
				if e := s.observeOriginalShopSession(ctx, v); e != nil || len(s.s.ShopSessions) != 0 {
					t.Fatal("Seller onboarding denied or identity became membership", e)
				}
				if _, e := s.CaptureOriginalShopSession(ctx); e == nil {
					t.Fatal("no-member seller captured")
				}
				s.s.SellerRoles[st.ID][a] = SellerRoleFinance
			}
			buyer := a
			if role == "seller" {
				_, buyer = actor(t, 11)
			}
			o, e := s.CreateOrder(buyer, orderInput(st, p, "PUBLIC-session-order"))
			if e != nil {
				t.Fatal(e)
			}
			h := observeCaptureShopSession(t, s, v, ctx)
			if e = h.CurrentOrder(ctx, "shop.order", o.ID); e != nil {
				t.Fatal(e)
			}
			if e = h.CurrentOrder(ctx, "different.product", o.ID); e == nil {
				t.Fatal("foreign product accepted")
			}
			_, foreign := actor(t, 12)
			foreignOrder, e := s.CreateOrder(foreign, orderInput(st, p, "PUBLIC-foreign-order"))
			if e != nil {
				t.Fatal(e)
			}
			if role == "buyer" && h.CurrentOrder(ctx, "shop.order", foreignOrder.ID) == nil {
				t.Fatal("foreign buyer order accepted")
			}
			if role == "seller" {
				if _, _, e = s.RevokeSellerRole(owner, st.ID, a, "PUBLIC original role removal"); e != nil {
					t.Fatal(e)
				}
				if h.CurrentLocal() == nil {
					t.Fatal("revoked seller local handle live")
				}
				cold, e := Open(s.path)
				if e != nil {
					t.Fatal(e)
				}
				cold.shopSessionDomain = s.shopSessionDomain
				cold.s.SellerRoles[st.ID][a] = SellerRoleFinance
				if e = cold.observeOriginalShopSession(ctx, v); e == nil {
					t.Fatal("regrant restored old session")
				}
			}
		})
	}
}
func TestShopSessionInventoryExpiryAndFailedPersistence(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	original := s.path
	s.path = filepath.Join("/dev/null", "refused-state")
	if e := s.RevokeOriginalShopSession(ctx); e == nil {
		t.Fatal("invalid persistence succeeded")
	}
	s.path = original
	if e := h.CurrentLocal(); e != nil {
		t.Fatal("failed revocation retired committed live hold", e)
	}
	s.now = func() time.Time { return v.principal.ExpiresAt.Add(time.Second) }
	if e := h.Current(ctx); e == nil {
		t.Fatal("expired session current")
	}
}
func TestShopSessionInventoryRetireDuringAwaitAndPhysicalDebt(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	v.revalidate = func(context.Context) error { close(entered); <-release; return nil }
	go func() { done <- h.Current(ctx) }()
	<-entered
	h.Retire()
	if !errors.Is(h.Close(), ErrConflict) || h.PhysicalClosed() {
		t.Fatal("live await freed parent")
	}
	if h.CurrentLocal() == nil {
		t.Fatal("retirement did not synchronously revoke")
	}
	close(release)
	if e := <-done; e == nil {
		t.Fatal("late successful await published current")
	}
	_ = h.Close()
	if !h.PhysicalClosed() {
		t.Fatal("completed operation did not close while preserving first error")
	}
}
func TestShopSessionInventoryPrivacyAndOldBackup(t *testing.T) {
	s, v, ctx, a := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	old, e := os.ReadFile(s.path)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DeleteBuyerData(a); e != nil {
		t.Fatal(e)
	}
	if h.CurrentLocal() == nil {
		t.Fatal("privacy delete retained local session")
	}
	if e = os.WriteFile(s.path+".bak", old, 0600); e != nil {
		t.Fatal(e)
	}
	if e = RestoreCommerceBackup(s.path, nil); e == nil {
		t.Fatal("old backup resurrected revoked inventory")
	}
}
func TestShopSessionInventoryRejectsMalformedAndOldSchema(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	_ = observeCaptureShopSession(t, s, v, ctx)
	for _, kind := range []string{"schema", "counter", "digest", "role"} {
		t.Run(kind, func(t *testing.T) {
			snap, e := cloneSnapshot(s.s)
			if e != nil {
				t.Fatal(e)
			}
			for id, r := range snap.ShopSessions {
				switch kind {
				case "schema":
					snap.Version = 18
				case "counter":
					snap.ShopSessionGeneration = 0
				case "digest":
					r.ActorDigest = "not-a-digest"
				case "role":
					r.Role = "owner"
				}
				snap.ShopSessions[id] = r
				break
			}
			path := filepath.Join(t.TempDir(), "state")
			raw, e := encodePersisted(snap, nil)
			if e != nil {
				t.Fatal(e)
			}
			if e = os.WriteFile(path, raw, 0600); e != nil {
				t.Fatal(e)
			}
			if _, e = Open(path); e == nil {
				t.Fatal("malformed inventory admitted")
			}
		})
	}
}

func TestShopSessionInventoryOwnRevokeAfterActorRetirement(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	v.fence = func() error { return ErrUnauthorized }
	if e := h.Revoke(ctx); e != nil {
		t.Fatal(e)
	}
	cold, e := Open(s.path)
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range cold.s.ShopSessions {
		if !r.Revoked {
			t.Fatal("logout failed to persist exact owned retirement")
		}
	}
	if h.CurrentLocal() == nil {
		t.Fatal("logout did not retire local copy")
	}
}
func TestShopSessionInventoryDomainDrainDoesNotBlockOrdinaryAPI(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	h := observeCaptureShopSession(t, s, v, ctx)
	d := s.shopSessionDomain
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	v.revalidate = func(context.Context) error { close(entered); <-release; return nil }
	go func() { done <- h.Current(ctx) }()
	<-entered
	s.retireOriginalShopSessionDomain(d)
	if _, closed := s.closeOriginalShopSessionDomain(d); closed {
		t.Fatal("domain closed live operation")
	}
	// Only capture is held closed, not unrelated already authorized operations.
	if e := s.observeOriginalShopSession(ctx, v); e != nil {
		t.Fatal("private read retirement blocked ordinary business", e)
	}
	close(release)
	<-done
	if _, closed := s.closeOriginalShopSessionDomain(d); !closed {
		t.Fatal("physical debt did not drain")
	}
	s.releaseOriginalShopSessionDomain(d)
	if s.shopSessionDomain != nil {
		t.Fatal("closed domain retained")
	}
}
func TestShopSessionInventoryZeroHoldsAndUnboundCaptureDenied(t *testing.T) {
	var h OriginalShopSession
	if h.CurrentLocal() == nil || h.Current(context.Background()) == nil || h.Close() == nil {
		t.Fatal("zero object gained authority")
	}
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	s.shopSessionDomain = nil
	if e := s.observeOriginalShopSession(ctx, v); e != nil {
		t.Fatal(e)
	}
	if len(s.s.ShopSessions) != 0 {
		t.Fatal("unqualified deployment populated inventory")
	}
	if _, e := s.CaptureOriginalShopSession(ctx); e == nil {
		t.Fatal("unbound capture")
	}
}

func TestShopSessionInventoryFiniteProofLoanDoesNotRenewIssuer(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	if e := s.observeOriginalShopSession(ctx, v); e != nil {
		t.Fatal(e)
	}
	v.shopSessionCaptureUntil = time.Now().Add(250 * time.Millisecond)
	h, e := s.CaptureOriginalShopSession(ctx)
	if h != nil {
		t.Cleanup(func() { _ = h.Close() })
	}
	if e != nil {
		t.Fatal(e)
	}
	for _, r := range s.s.ShopSessions {
		if !r.ExpiresAt.Equal(v.principal.ExpiresAt) {
			t.Fatal("finite loan rewrote original issuer expiry")
		}
	}
	time.Sleep(time.Until(v.shopSessionCaptureUntil) + time.Millisecond)
	if h.CurrentLocal() == nil {
		t.Fatal("original finite proof loan extended")
	}
}

func TestShopSessionInventoryActualNamespaceBoundaries(t *testing.T) {
	for _, role := range []string{"buyer", "seller"} {
		t.Run(role, func(t *testing.T) {
			s, v, ctx, subject := publicShopSessionFixture(t, role)
			_, owner := actor(t, 9)
			st, p := setupCatalog(t, s, owner, 4)
			_, otherOwner := actor(t, 12)
			otherStore, otherProduct := setupCatalog(t, s, otherOwner, 4)
			if role == "seller" {
				s.s.SellerRoles[st.ID][subject] = SellerRoleFinance
				s.s.SellerRoles[otherStore.ID][subject] = SellerRoleFinance
			}
			order, e := s.CreateOrder(subject, orderInput(st, p, "PUBLIC-own-namespace"))
			if e != nil {
				t.Fatal(e)
			}
			foreign, e := s.CreateOrder(subject, orderInput(otherStore, otherProduct, "PUBLIC-other-namespace"))
			if e != nil {
				t.Fatal(e)
			}
			h := observeCaptureShopSession(t, s, v, ctx)
			if e = h.CurrentOrder(ctx, "shop.order", order.ID); e != nil {
				t.Fatal(e)
			}
			if h.CurrentOrder(ctx, "shop.order", foreign.ID) == nil {
				t.Fatal("same actor owned order escaped held merchant tenant")
			}
			if role == "seller" {
				if _, _, e = s.RevokeSellerRole(otherOwner, otherStore.ID, subject, "PUBLIC foreign tenant revocation"); e != nil {
					t.Fatal(e)
				}
				if h.CurrentLocal() != nil || h.Current(ctx) != nil {
					t.Fatal("foreign tenant membership change retired unrelated original tenant")
				}
			}
		})
	}
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	s.shopSessionDomain.tenant = "PUBLIC-unmapped-owner"
	if e := s.observeOriginalShopSession(ctx, v); e != nil {
		t.Fatal("unmapped private domain blocked ordinary API", e)
	}
	if len(s.s.ShopSessions) != 0 {
		t.Fatal("Source profile invented Shop business namespace")
	}
	if h, e := s.CaptureOriginalShopSession(ctx); h != nil || e == nil {
		t.Fatal("unmapped domain captured", e)
	}
}
