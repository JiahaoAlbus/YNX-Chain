package commerce

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

type publicUnknownShopListener struct {
	closes int
	first  error
}

func (l *publicUnknownShopListener) Accept() (net.Conn, error) { return nil, l.first }
func (l *publicUnknownShopListener) Close() error              { l.closes++; return l.first }
func (l *publicUnknownShopListener) Addr() net.Addr {
	return &net.UnixAddr{Name: "PUBLIC", Net: "unix"}
}

func TestShopSessionInventoryV4ServicePreservesUnknownListenerClose(t *testing.T) {
	first := errors.New("PUBLIC listener close unknown")
	listener := &publicUnknownShopListener{first: first}
	authority := &publicInvoiceReadAuthority{}
	service := &OriginalShopInvoiceReadService{listener: listener, authority: authority}
	if err := service.Close(nil); !errors.Is(err, ErrInvalidState) || listener.closes != 0 {
		t.Fatal("nil context touched original listener", err)
	}
	if err := service.Close(context.Background()); !errors.Is(err, first) {
		t.Fatal("missing original listener failure", err)
	}
	if err := service.Close(context.Background()); !errors.Is(err, first) {
		t.Fatal("lost original listener failure", err)
	}
	if listener.closes != 1 || authority.closed.Load() != 0 || service.PhysicalClosed() {
		t.Fatal("unknown original listener was retried or parent released")
	}
}

func TestShopSessionInventoryV4RejectsUnqualifiedListenerBeforeLINKRetire(t *testing.T) {
	first := errors.New("PUBLIC first listener close unknown")
	listener := &publicUnknownShopListener{first: first}
	authority := &publicInvoiceReadAuthority{}
	link, err := securelink.NewProductSessionProofV4LocalCallerServer(securelink.LocalCallerServerConfig{
		Service: "shop-v4-public", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(),
		Routes:  []securelink.LocalCallerRoute{{Method: "GET", Path: "/original", Timeout: time.Second}},
		Handler: http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}), RequireOriginalV4ResponseOwner: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	service := &OriginalShopInvoiceReadService{sessionRequired: true, listener: listener, authority: authority, link: link}
	if err := service.Close(context.Background()); !errors.Is(err, securelink.ErrDenied) {
		t.Fatalf("unqualified listener was accepted: %v", err)
	}
	if err := service.Close(context.Background()); !errors.Is(err, securelink.ErrDenied) {
		t.Fatalf("unqualified listener was accepted on recovery: %v", err)
	}
	if listener.closes != 0 || authority.closed.Load() != 0 || service.PhysicalClosed() {
		t.Fatal("unqualified listener was closed or parent released")
	}
	if !errors.Is(link.Join(context.Background()), securelink.ErrDenied) {
		t.Fatal("LINK retired after unknown original listener close")
	}
}

// Controlled ownership mechanics only; this is not an Auth or socket witness.
func TestShopSessionInventoryV4ResponseOwnerRetainsOriginalsUntilDrain(t *testing.T) {
	s, v, ctx, _ := publicShopSessionFixture(t, "buyer")
	session := observeCaptureShopSession(t, s, v, ctx)
	first := errors.New("PUBLIC close pending")
	permission := &publicFinishedShopPermission{first: first}
	held := &originalShopProductReadHold{permission: permission}
	service := &OriginalShopInvoiceReadService{children: map[uint64]originalShopInvoiceReadHold{1: held}}
	req := httptest.NewRequest("GET", "/", nil)
	owner := &shopV4ResponseOwner{service: service, request: req, childID: 1, held: held, session: session, product: "shop.order", order: "PUBLIC-order"}
	if owner.PhysicalClosed() || owner.Drain(context.Background()) == nil {
		t.Fatal("untransferred owner was drained")
	}
	if err := owner.Close(); !errors.Is(err, first) {
		t.Fatalf("first close: %v", err)
	}
	if owner.PhysicalClosed() || session.PhysicalClosed() || len(service.children) != 1 {
		t.Fatal("pending source released its session or child")
	}
	permission.done.Store(true)
	if err := owner.Drain(context.Background()); !errors.Is(err, first) {
		t.Fatalf("lost first error: %v", err)
	}
	if !owner.PhysicalClosed() || !session.PhysicalClosed() || len(service.children) != 0 {
		t.Fatal("original holders did not drain")
	}
	if permission.calls.Load() != 1 {
		t.Fatalf("completed original was closed again: %d", permission.calls.Load())
	}
}

// Exercises the actual LINK Unix connection with controlled Shop holders;
// it does not supply production Auth, a merchant, or a payment.
func TestShopSessionInventoryV4ResponseOwnerRealUnixConnection(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		name := "success"
		if revoked {
			name = "revoked-first-error"
		}
		t.Run(name, func(t *testing.T) { checkShopV4ResponseOwnerRealUnixConnection(t, revoked) })
	}
}

func checkShopV4ResponseOwnerRealUnixConnection(t *testing.T, revoked bool) {
	s, v, ctx, buyer := publicShopSessionFixture(t, "buyer")
	_, merchant := actor(t, 9)
	store, product := setupCatalog(t, s, merchant, 4)
	order, err := s.CreateOrder(buyer, orderInput(store, product, "PUBLIC-v4-unix-order"))
	if err != nil {
		t.Fatal(err)
	}
	session := observeCaptureShopSession(t, s, v, ctx)
	authority := &publicInvoiceReadAuthority{}
	held := &publicInvoiceReadHold{owner: authority}
	service := &OriginalShopInvoiceReadService{sessionRequired: true, authority: authority, children: map[uint64]originalShopInvoiceReadHold{1: held}}
	dir, err := os.MkdirTemp("/tmp", "shop-v4-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "s")
	listener, err := securelink.ListenPrivateWithCloseWitness(socket, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	ownerCh := make(chan *shopV4ResponseOwner, 1)
	server, err := securelink.NewProductSessionProofV4LocalCallerServer(securelink.LocalCallerServerConfig{
		Service: "shop-v4-public", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), RequireOriginalV4ResponseOwner: true,
		Routes: []securelink.LocalCallerRoute{{Method: "GET", Path: "/original", Timeout: 3 * time.Second}},
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			caller, e := securelink.LocalCallerFromRequest(r)
			if e != nil {
				t.Error(e)
				return
			}
			owner := &shopV4ResponseOwner{service: service, request: r, childID: 1, held: held, session: session, product: "shop.order", order: order.ID}
			lease, e := caller.AdoptOriginalV4ResponseOwner(r, owner)
			if e != nil {
				t.Error(e)
				return
			}
			service.stateMu.Lock()
			service.v4Leases = map[*securelink.OriginalV4ResponseLease]struct{}{lease: {}}
			service.stateMu.Unlock()
			if session.PhysicalClosed() || held.closes.Load() != 0 {
				t.Error("owner released before first response")
			}
			ownerCh <- owner
			if revoked {
				if e := s.RevokeOriginalShopSession(ctx); e != nil {
					t.Error(e)
					return
				}
			}
			_, _ = w.Write([]byte("original"))
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	service.link = server
	service.listener = listener
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	peer, err := net.DialTimeout("unix", socket, 3*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	_ = peer.SetDeadline(time.Now().Add(5 * time.Second))
	_, err = fmt.Fprintf(peer, "GET /original HTTP/1.1\r\nHost: shop-v4-public\r\n%s: Aa\r\nConnection: close\r\n\r\n", securelink.ProductSessionProofV4Header)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(bufio.NewReader(peer), &http.Request{Method: "GET"})
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || (!revoked && (response.StatusCode != 200 || string(body) != "original")) || (revoked && response.StatusCode != 403) {
		t.Fatalf("response %d %q: %v", response.StatusCode, body, err)
	}
	owner := <-ownerCh
	deadline := time.Now().Add(3 * time.Second)
	for !owner.PhysicalClosed() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !owner.PhysicalClosed() || held.closes.Load() != 1 {
		t.Fatal("same original holders did not close after Unix connection")
	}
	if !revoked {
		cancelled, cancel := context.WithCancel(context.Background())
		cancel()
		if err := service.Close(cancelled); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled close: %v", err)
		}
		if service.PhysicalClosed() || authority.closed.Load() != 0 {
			t.Fatal("cancelled close released parent")
		}
	}
	closeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	closeErr := service.Close(closeCtx)
	if (!revoked && closeErr != nil) || (revoked && closeErr == nil) {
		t.Fatalf("original close error: %v", closeErr)
	}
	if !service.PhysicalClosed() || authority.closed.Load() != 1 {
		t.Fatal("drained LINK did not release original parent")
	}
	select {
	case <-done:
	case <-closeCtx.Done():
		t.Fatal("service did not drain")
	}
}

func TestShopSessionInventoryV4ResponseOwnerFencesExactRequestAndOrder(t *testing.T) {
	s, v, ctx, buyer := publicShopSessionFixture(t, "buyer")
	_, merchant := actor(t, 9)
	store, product := setupCatalog(t, s, merchant, 4)
	order, err := s.CreateOrder(buyer, orderInput(store, product, "PUBLIC-v4-owner-order"))
	if err != nil {
		t.Fatal(err)
	}
	session := observeCaptureShopSession(t, s, v, ctx)
	authority := &publicInvoiceReadAuthority{}
	held := &publicInvoiceReadHold{owner: authority}
	service := &OriginalShopInvoiceReadService{children: map[uint64]originalShopInvoiceReadHold{1: held}}
	req := httptest.NewRequest("GET", "/", nil)
	owner := &shopV4ResponseOwner{service: service, request: req, childID: 1, held: held, session: session, product: "shop.order", order: order.ID}
	if err := owner.Current(req); err != nil {
		t.Fatalf("original request and order: %v", err)
	}
	if err := owner.Current(req.Clone(req.Context())); err == nil {
		t.Fatal("different request borrowed the original owner")
	}
	if err := s.RevokeOriginalShopSession(ctx); err != nil {
		t.Fatal(err)
	}
	if err := owner.Current(req); err == nil {
		t.Fatal("revoked original session passed the response fence")
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if !owner.PhysicalClosed() || held.closes.Load() != 1 {
		t.Fatal("original holders did not close exactly once")
	}
}
