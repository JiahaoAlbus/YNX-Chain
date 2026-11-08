package productreadsource

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"
)

// Explicit PUBLIC observed-Source boundary, never the normal Root factory.
// Tests execute production hold/client/LINK/body custody, NOT Source admission.
func publicShopClient(t *testing.T, handler func(http.ResponseWriter, *http.Request, *Authority)) (*ShopPrivateClient, *atomic.Int32) {
	t.Helper()
	dir, err := os.MkdirTemp("", "shop-original-PUBLIC-")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "s")
	listener, err := securelink.ListenPrivate(socket, uint32(os.Geteuid()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	a := &Authority{parent: ctx, changed: make(chan struct{}, 1)}
	scope := ScopeDATA{Version: 1, NetworkID: strings.Repeat("a", 64), Account: "0x" + strings.Repeat("b", 40), ProtectedResourceRef: "PUBLIC-shop-resource", Operations: []string{"readOriginalInvoiceIntent"}, Products: []ProductReference{{"shop.order", "order-001"}}}
	resource := resourceOriginal{Version: 1, ProtectedResourceRef: scope.ProtectedResourceRef, NetworkID: scope.NetworkID, Account: scope.Account, Realm: "PUBLIC.realm", Tenant: "PUBLIC.tenant", Epoch: 1, Socket: socket, Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Orders: []string{"order-001"}, Bindings: []resourceOrder{{"shop.order", "order-001", scope.Account, "buyer", "PUBLIC.store"}}}
	a.state.Store(&epoch{observation: &semanticObservation{1}, until: time.Now().Add(5 * time.Second), wallStart: time.Now().UnixMilli(), scope: scope, resource: resource})
	c := &ShopPrivateClient{source: a, ctx: ctx, cancel: cancel, responses: map[*ShopOriginalResponse]bool{}, changed: make(chan struct{}, 1)}
	c.capture, err = a.captureObservedDATA(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = c.validateCapture(); err != nil {
		t.Fatal(err)
	}
	// Explicit independent client-registration PUBLIC edge. Production never
	// derives this from a server profile; it reads the separately selected row.
	if err = c.validateOriginalClientTransport(resource); err != nil {
		t.Fatal(err)
	}
	if err = c.captureIndependentServerExpected(publicShopOwnedExpected(t)); err != nil {
		t.Fatal(err)
	} // explicit PUBLIC fixture, never normal TOFU
	calls := &atomic.Int32{}
	server, err := securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: "ynx-shop-source", PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: []securelink.LocalCallerRoute{{Method: http.MethodGet, Path: shopPath("order-001"), MaxBodyBytes: 0, Timeout: time.Second}}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		actual, e := securelink.LocalCallerFromRequest(r)
		if e != nil {
			t.Errorf("original LINK caller: %v", e)
			return
		}
		view, e := actual.Current(r.Context())
		if e != nil || view.Method != "GET" || view.Path != shopPath("order-001") || len(view.RequestBody) != 0 || view.ContentType != "" || r.URL.RawQuery != "" {
			t.Errorf("not actual fixed GET: %v", e)
			return
		}
		handler(w, r, a)
	})})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	t.Cleanup(func() {
		_ = server.Close()
		joinCtx, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		if e := server.Join(joinCtx); e != nil {
			t.Errorf("server cleanup: %v", e)
		}
		select {
		case <-done:
		case <-joinCtx.Done():
			t.Error("PUBLIC listener debt")
		}
		c.Retire()
		_ = os.Remove(socket)
		_ = os.Remove(dir)
	})
	return c, calls
}

// Actual P07 NativeShopInvoiceRequestDATA field order/tags, PUBLIC DATA only.
var publicShopBody = []byte(`{"productId":"shop.order","storeId":"PUBLIC.store","sourceOrder":"order-001","merchant":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","recipient":"0xcccccccccccccccccccccccccccccccccccccccc","genesis":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nativeChainId":"6423","assetId":"YNXT","unitVersion":"1","amountAtoms":"1","domainData":{"schema":"ynx.shop.order.invoice/v1","PUBLIC":true}}`)

func publicReply(w http.ResponseWriter, _ *http.Request, _ *Authority) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(publicShopBody)
}
func TestShopClientNormalRootEmptyCABI(t *testing.T) {
	c, e := OpenOriginalShopPrivateClient(context.Background())
	if c == nil || !errors.Is(e, ErrNotSupplied) {
		t.Fatal("normal Source Root0", c, e)
	}
	if e, done := c.Close(); !errors.Is(e, ErrNotSupplied) || !done {
		t.Fatal("Root0 partial close", e, done)
	}
	a := ynx_auth_shop_original_client_acquire_v1()
	if a.owner == nil || a.status.error_present != 1 {
		t.Fatal("C nonnull partial")
	}
	d := ynx_auth_shop_original_client_close_v1(a.owner)
	if d.error_present != 1 || d.physical_done != 1 {
		t.Fatal("C independent first/done")
	}
	if r := ynx_auth_shop_original_client_release_closed_v1(a.owner); r.physical_done != 1 {
		t.Fatal("C release")
	}
	if x := ynx_auth_shop_original_client_current_v1(a.owner); x.error_present != 1 {
		t.Fatal("C stale token")
	}
}
func TestShopClientActualPrivateGETPacketAndDebt(t *testing.T) {
	c, calls := publicShopClient(t, publicReply)
	r, e := c.readOriginalAtObserved(c.ctx, "order-001")
	if e != nil || r == nil {
		t.Fatal("actual LINK read", e)
	}
	if calls.Load() != 1 || !bytes.Equal(r.original.Body, publicShopBody) {
		t.Fatal("raw body changed")
	}
	if _, done := c.Close(); done {
		t.Fatal("parent closed with owned packet")
	}
	if c.source.children.Load() != 1 {
		t.Fatal("Source loan lost")
	}
	if _, done := r.Release(); !done {
		t.Fatal("response release")
	}
	if e, done := c.Join(context.Background()); e != nil || !done {
		t.Fatal("join", e, done)
	}
	if e, done := c.Close(); e != nil || !done {
		t.Fatal("close", e, done)
	}
}
func TestShopClientWrongOrderAndPeer(t *testing.T) {
	for _, name := range []string{"order", "peer"} {
		t.Run(name, func(t *testing.T) {
			c, calls := publicShopClient(t, publicReply)
			order := "order-001"
			if name == "order" {
				order = "order-002"
			} else {
				c.transport.PeerPID = os.Getpid() + 12345
			}
			r, e := c.readOriginalAtObserved(c.ctx, order)
			if e == nil || r == nil {
				t.Fatal("missing held failure")
			}
			if calls.Load() != 0 {
				t.Fatal("wrong peer/order reached handler")
			}
			_, _ = r.Release()
			if _, done := c.Close(); !done {
				t.Fatal("failure cleanup")
			}
		})
	}
}

func TestShopClientIndependentServerPeerMapping(t *testing.T) {
	c, _ := publicShopClient(t, publicReply)
	record := c.transport
	record.PeerPID = os.Getpid() + 12345
	if e := c.validateOriginalClientTransport(record); e != nil {
		t.Fatal("independent reviewed server peer", e)
	}
	if c.transport.PeerPID == c.capture.Profile.PeerPID {
		t.Fatal("server peer aliased allowed caller")
	}
	c.capture.Profile.PeerPID = os.Getpid() + 1
	if e := c.validateOriginalClientTransport(record); e == nil {
		t.Fatal("foreign actual caller admitted")
	}
	if _, done := c.Close(); !done {
		t.Fatal("drain")
	}
}
func TestShopClientNoClientRegistrationFromServerProfile(t *testing.T) {
	c, _ := publicShopClient(t, publicReply)
	if e := c.captureOriginalClientTransport(c.ctx); !errors.Is(e, ErrNotSupplied) {
		t.Fatal("server profile substituted for separate Root-selected client registration", e)
	}
	if _, done := c.Close(); !done {
		t.Fatal("drain")
	}
}
func TestShopClientLateRevokeKeepsOriginalPacket(t *testing.T) {
	c, _ := publicShopClient(t, func(w http.ResponseWriter, r *http.Request, a *Authority) { a.Retire(); publicReply(w, r, a) })
	r, e := c.readOriginalAtObserved(c.ctx, "order-001")
	if e == nil || r == nil || !bytes.Equal(r.original.Body, publicShopBody) {
		t.Fatal("late packet not retained", e)
	}
	if data, e := r.ReadOriginalTransportDATA(); e == nil || len(data.Body) != 0 {
		t.Fatal("revoked reply published")
	}
	if _, done := c.Close(); done {
		t.Fatal("packet debt discarded")
	}
	_, _ = r.Release()
	if first, done := c.Close(); !done || first != e {
		t.Fatal("first vs physicaldone", first, e, done)
	}
}
func TestShopClientRetireCancelsActualInflight(t *testing.T) {
	entered := make(chan struct{})
	c, _ := publicShopClient(t, func(w http.ResponseWriter, r *http.Request, _ *Authority) { close(entered); <-r.Context().Done() })
	type result struct {
		r *ShopOriginalResponse
		e error
	}
	resultCh := make(chan result, 1)
	go func() { r, e := c.readOriginalAtObserved(c.ctx, "order-001"); resultCh <- result{r, e} }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("not dispatched")
	}
	c.Retire()
	select {
	case x := <-resultCh:
		if x.r == nil || x.e == nil {
			t.Fatal("cancel lost partial")
		}
		_, _ = x.r.Release()
	case <-time.After(time.Second):
		t.Fatal("retire did not cancel actual client")
	}
	if _, done := c.Close(); !done {
		t.Fatal("drain")
	}
}

type shopPublicZero struct{}

func (*shopPublicZero) Error() string     { return "PUBLIC first0" }
func (*shopPublicZero) NativeCode() int32 { return 0 }
func TestShopClientFirstZeroAndUnknownClose(t *testing.T) {
	c, _ := publicShopClient(t, publicReply)
	first := &shopPublicZero{}
	c.fail(first)
	e, done := c.Close()
	if e != first || !done {
		t.Fatal("first0 physicaldone", e, done)
	}
	s := shopCStatus(e, done)
	if s.error_present != 1 || s.first_code != 0 || s.physical_done != 1 {
		t.Fatal("paired first0")
	}
	if again, done := c.Close(); again != first || !done {
		t.Fatal("sticky close")
	}
}

func TestShopClientActualFailedCloseRetainsFirstZero(t *testing.T) {
	c, _ := publicShopClient(t, publicReply)
	f, e := os.CreateTemp("", "Shop-PUBLIC-close-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.Remove(f.Name()) })
	if e = f.Close(); e != nil {
		t.Fatal(e)
	}
	c.source.files.files = append(c.source.files.files, &originalFile{file: f})
	first := &shopPublicZero{}
	c.fail(first)
	p, entry := reserveShopClient()
	entry.owner = c
	s := ynx_auth_shop_original_client_close_v1(p)
	if s.error_present != 1 || s.first_code != 0 || s.physical_done != 0 || s.unknown != 1 {
		t.Fatal("first0/physicalUNKNOWN", s)
	}
	if c.source == nil || !errors.Is(c.cleanupError, ErrUnknown) {
		t.Fatal("original parent/cause lost")
	}
	again := ynx_auth_shop_original_client_close_v1(p)
	if again != s {
		t.Fatal("selected close replayed")
	}
	if release := ynx_auth_shop_original_client_release_closed_v1(p); release.physical_done != 0 {
		t.Fatal("UNKNOWN freed")
	}
}
func TestShopClientOriginalReadDeadlineNotRenewed(t *testing.T) {
	c, _ := publicShopClient(t, publicReply)
	r, e := c.readOriginalAtObserved(c.ctx, "order-001")
	if e != nil {
		t.Fatal(e)
	}
	old := r.hold.epoch
	fresh := *old
	fresh.until = time.Now().Add(time.Hour)
	c.source.state.Store(&fresh)
	old.until = time.Now().Add(-time.Second)
	if e = c.source.atomicCurrent(c.ctx, nil); e != nil {
		t.Fatal("fresh parent", e)
	}
	if e = r.originalCurrent(); e == nil {
		t.Fatal("original hold renewed")
	}
	_, _ = r.Release()
	if _, done := c.Close(); !done {
		t.Fatal("drain original expired hold")
	}
}
func TestShopClientEmptyCPartialReleaseKeepsZeroPresence(t *testing.T) {
	c, _ := OpenOriginalShopPrivateClient(context.Background())
	p, parent := reserveShopClient()
	parent.owner = c
	token, e := reserveShopResponse(parent, nil)
	if e != nil {
		t.Fatal(e)
	}
	shopCInventory.Lock()
	entry := shopCInventory.responses[unsafe.Pointer(token)]
	shopCInventory.Unlock()
	entry.releaseError = &shopPublicZero{}
	s := ynx_auth_shop_original_response_release_v1(token)
	if s.error_present != 1 || s.first_code != 0 || s.physical_done != 1 {
		t.Fatal("empty partial", s)
	}
	if again := ynx_auth_shop_original_response_release_v1(token); again != s {
		t.Fatal("zero first cleared")
	}
	_ = ynx_auth_shop_original_client_close_v1(p)
	_ = ynx_auth_shop_original_client_release_closed_v1(p)
}

func TestShopClientActualP07AggregateBodyBudget(t *testing.T) {
	var body map[string]json.RawMessage
	if e := json.Unmarshal(publicShopBody, &body); e != nil {
		t.Fatal(e)
	}
	domain, _ := json.Marshal(map[string]string{"PUBLIC": strings.Repeat("x", 65480)})
	if len(domain) > 64<<10 {
		t.Fatal("fixture exceeds original P07 domain cap")
	}
	body["domainData"] = domain
	raw, _ := json.Marshal(body)
	if len(raw) <= 64<<10 || len(raw) > 1<<20 {
		t.Fatal("fixture must exceed incorrect old aggregate cap")
	}
	c, _ := publicShopClient(t, func(w http.ResponseWriter, _ *http.Request, _ *Authority) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
	})
	r, e := c.readOriginalAtObserved(c.ctx, "order-001")
	if e != nil || r == nil || !bytes.Equal(r.original.Body, raw) {
		t.Fatal("original maxDomain+11field aggregate rejected", e)
	}
	_, _ = r.Release()
	if _, done := c.Close(); !done {
		t.Fatal("drain")
	}
}
