package productreadsource

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// PUBLIC test-only Root snapshot. No production release is inserted, no Source
// original is signed and the zero normal factory must continue to refuse.
func publicAuthority(socket string) *Authority {
	ctx := context.Background()
	s := ScopeDATA{Version: 1, NetworkID: strings.Repeat("a", 64), Account: "0x" + strings.Repeat("b", 40), ProtectedResourceRef: "public.reader", Operations: []string{"readOriginalInvoiceIntent"}, Products: []ProductReference{{"shop.order", "order-001"}}}
	resource := resourceOriginal{Version: 1, ProtectedResourceRef: s.ProtectedResourceRef, NetworkID: s.NetworkID, Account: s.Account, Realm: "public.realm", Tenant: "public.tenant", Epoch: 1, Socket: socket, Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Orders: []string{"order-001"}, Bindings: []resourceOrder{{"shop.order", "order-001", "actor-001", "buyer", "store-001"}}}
	a := &Authority{parent: ctx, changed: make(chan struct{}, 1)}
	a.state.Store(&epoch{observation: &semanticObservation{1}, until: time.Now().Add(time.Second), wallStart: time.Now().UnixMilli(), scope: s, resource: resource})
	return a
}
func TestNormalRoot0AndScope(t *testing.T) {
	if a, e := OpenOriginalProductReadAuthority(context.Background()); a != nil || !errors.Is(e, ErrNotSupplied) {
		t.Fatal(a, e)
	}
	if a, e := OpenOriginalProductReadAuthority(nil); a != nil || e == nil {
		t.Fatal(a, e)
	}
	s := publicAuthority("/public/none").state.Load().scope
	if validateScope(s) != nil {
		t.Fatal("scope")
	}
	for _, edit := range []func(*ScopeDATA){func(s *ScopeDATA) { s.Operations = []string{"readOriginalInvoiceIntent", "readOriginalInvoiceIntent"} }, func(s *ScopeDATA) { s.Products = append(s.Products, s.Products[0]) }, func(s *ScopeDATA) { s.Products[0].ProductID = "arbitrary" }, func(s *ScopeDATA) { s.NetworkID = strings.Repeat("A", 64) }, func(s *ScopeDATA) { s.Operations = []string{"sign"} }, func(s *ScopeDATA) { s.Products = nil }} {
		x := publicAuthority("/public/none").state.Load().scope
		edit(&x)
		if validateScope(x) == nil {
			t.Fatal("accepted invalid")
		}
	}
	var dst ScopeDATA
	if decode([]byte(`{"version":1,"version":1}`), &dst) == nil {
		t.Fatal("duplicate")
	}
	if decode([]byte(`{"unknown":true}`), &dst) == nil {
		t.Fatal("unknown")
	}
}
func TestProtectedOriginalsAndPartial(t *testing.T) {
	dir := ownedProtectedFixture(t)
	p := filepath.Join(dir, "original")
	raw := []byte("PUBLIC original not Root")
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])
	if e := os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
	f := originalFiles{uid: uint32(os.Geteuid())}
	b, e := f.hold(p, digest, 1024)
	if e != nil || string(b) != string(raw) {
		t.Fatal(e)
	}
	if e = f.current(); e != nil {
		t.Fatal(e)
	}
	if e = os.Rename(p, filepath.Join(dir, "saved")); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(p, raw, 0600); e != nil {
		t.Fatal(e)
	}
	if f.current() == nil {
		t.Fatal("same bytes inode substitution")
	}
	if f.close() == nil {
		t.Fatal("lost first cause")
	}
	if e = f.close(); e == nil {
		t.Fatal("close first cause")
	}
	bad := originalFiles{uid: uint32(os.Geteuid())}
	if _, e = bad.hold(p, strings.Repeat("0", 64), 1024); e == nil || len(bad.files) != 1 {
		t.Fatal("partial not adopted")
	}
	if e = bad.close(); e != nil {
		t.Fatal(e)
	}
	alias := filepath.Join(dir, "alias")
	if e = os.Symlink(p, alias); e != nil {
		t.Fatal(e)
	}
	if _, e = (&originalFiles{uid: uint32(os.Geteuid())}).hold(alias, digest, 1024); e == nil {
		t.Fatal("symlink")
	}
}
func TestRealUnixRequestPureFenceDebt(t *testing.T) {
	dir := ownedProtectedFixture(t)
	socket := filepath.Join(dir, "sock")
	a := publicAuthority(socket)
	originalPath := filepath.Join(dir, "original")
	originalBytes := []byte("PUBLIC resource original")
	sum := sha256.Sum256(originalBytes)
	if e := os.WriteFile(originalPath, originalBytes, 0600); e != nil {
		t.Fatal(e)
	}
	a.files.uid = uint32(os.Geteuid())
	if _, e := a.files.hold(originalPath, hex.EncodeToString(sum[:]), 1024); e != nil {
		t.Fatal(e)
	}
	routes := []securelink.LocalCallerRoute{{Method: "GET", Path: shopPath("order-001"), MaxBodyBytes: 1, Timeout: time.Second}}
	done := make(chan error, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h, e := a.openShopReadAtCurrent(r.Context(), r, "shop.order", "order-001")
		if e != nil {
			done <- e
			w.WriteHeader(500)
			return
		}
		defer h.Close()
		scope, e := h.ScopeDATA()
		if e != nil || scope.Actor != "actor-001" || scope.StoreID != "store-001" {
			done <- ErrDenied
			w.WriteHeader(500)
			return
		}
		clone := r.Clone(r.Context())
		if _, e := a.openShopReadAtCurrent(clone.Context(), clone, "shop.order", "order-001"); e == nil {
			done <- errors.New("clone admitted")
			return
		}
		var lock sync.Mutex
		lock.Lock()
		e = h.Current(r.Context())
		lock.Unlock()
		if e != nil {
			done <- e
			return
		}
		// The no-I/O fence cannot discover an external filesystem replacement.
		// The mandatory outside-Store full Current must reject before returning
		// the collected DATA, lowering the observed epoch for this same child.
		if e = os.Rename(originalPath, filepath.Join(dir, "saved")); e != nil {
			done <- e
			return
		}
		if e = os.WriteFile(originalPath, originalBytes, 0600); e != nil {
			done <- e
			return
		}
		if e = h.Current(r.Context()); e != nil {
			done <- e
			return
		}
		if e = a.Current(r.Context()); e == nil {
			done <- errors.New("post-read full current accepted substitution")
			return
		}
		if h.Current(r.Context()) == nil {
			done <- errors.New("failed observation did not retire child")
			return
		}
		if e = a.Close(); !errors.Is(e, ErrPending) {
			done <- errors.New("early close lost debt")
			return
		}
		if h.Current(r.Context()) == nil {
			done <- errors.New("early close did not revoke")
			return
		}
		_ = h.Close()
		if e = a.Join(r.Context()); e != nil {
			done <- e
			return
		}
		first := a.Close()
		if first == nil || a.Close() != first {
			done <- errors.New("lost sticky first observation cause")
			return
		}
		done <- nil
		_, _ = w.Write([]byte("PUBLIC"))
	})
	server, e := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: routes, Handler: handler})
	if e != nil {
		t.Fatal(e)
	}
	listener, e := securelink.ListenPrivate(socket, uint32(os.Geteuid()))
	if e != nil {
		t.Fatal(e)
	}
	go server.Serve(listener)
	defer server.Close()
	client, e := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: socket, Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: routes, Timeout: time.Second})
	if e != nil {
		t.Fatal(e)
	}
	// Actual LocalCallerClient is a registered immutable per-Call transport,
	// not a closeable service owner. Server retains its own listener custody.
	response, e := client.Call(context.Background(), "GET", shopPath("order-001"), "", nil)
	if e != nil || response.StatusCode != 200 || string(response.Body) != "PUBLIC" {
		t.Fatal(e, response.StatusCode)
	}
	if e = <-done; e != nil {
		t.Fatal(e)
	}
}
