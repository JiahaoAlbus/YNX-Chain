package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// Only PUBLIC Auth qualification controls live here. Production's sole factory
// stays unavailable until the genuine shared Auth/SDK callee is supplied.
type publicInvoiceReadAuthority struct {
	p        originalShopInvoiceReadProfile
	selected originalShopInvoiceReadScope
	retired  atomic.Bool
	closed   atomic.Int32
	mode     string
	hook     func(*http.Request)
	hold     *publicInvoiceReadHold
}
type publicInvoiceReadHold struct {
	owner   *publicInvoiceReadAuthority
	checks  atomic.Int32
	closes  atomic.Int32
	entered chan struct{}
	release chan struct{}
}

func (a *publicInvoiceReadAuthority) current(ctx context.Context) error {
	if a.retired.Load() {
		return errShopInvoiceReadDenied
	}
	return ctx.Err()
}
func (a *publicInvoiceReadAuthority) profile(context.Context) (originalShopInvoiceReadProfile, error) {
	return a.p, nil
}
func (a *publicInvoiceReadAuthority) open(_ context.Context, r *http.Request, _, _ string) (originalShopInvoiceReadHold, error) {
	if a.hook != nil {
		a.hook(r)
	}
	if a.mode == "missing" {
		return nil, ErrShopInvoiceReadSourceNotSupplied
	}
	return a.hold, nil
}
func (a *publicInvoiceReadAuthority) retire() error { a.retired.Store(true); return nil }
func (a *publicInvoiceReadAuthority) close() error  { a.closed.Add(1); return nil }
func (h *publicInvoiceReadHold) scope() (originalShopInvoiceReadScope, error) {
	return h.owner.selected, nil
}
func (h *publicInvoiceReadHold) current(ctx context.Context) error {
	n := h.checks.Add(1)
	if h.entered != nil && n == 1 {
		close(h.entered)
		<-h.release
	}
	if h.owner.mode == "late" && n >= 2 {
		return errShopInvoiceReadDenied
	}
	return h.owner.current(ctx)
}
func (h *publicInvoiceReadHold) close() error {
	if h.closes.Add(1) == 1 && h.owner.mode == "close-error" {
		return errors.New("PUBLIC_SCOPE_CLOSE_FIRST_CAUSE")
	}
	return nil
}

func publicSourceInvoiceRecord(t *testing.T) (*Store, string, Order, NativeShopInvoiceRequestDATA) {
	t.Helper()
	s, buyer, o := effectOrderFixture(t, filepath.Join(t.TempDir(), "state.json"))
	request, err := nativeInvoiceRequestDATA(o, publicNativePriceDATA())
	if err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(nativeInvoiceInput{Order: cloneOrder(o), Origin: "https://public.invalid", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	id := effectDigest(buyer, "buyer", "pay.native-create", o.ID, "PUBLIC-retained-original")
	s.s.BusinessEffects[id] = BusinessEffect{ID: id, Actor: buyer, Role: "buyer", Kind: "pay.native-create", Target: o.ID, RequestHash: strings.Repeat("a", 64), Phase: "admitted", Admission: strings.Repeat("b", 64), Input: input, CreatedAt: s.now(), UpdatedAt: s.now()}
	if err = s.persistLocked(); err != nil {
		t.Fatal(err)
	}
	return s, buyer, o, request
}
func publicInvoiceReadService(t *testing.T, s *Store, buyer string, o Order, mode string) (*OriginalShopInvoiceReadService, *publicInvoiceReadAuthority, *securelink.LocalCallerClient) {
	t.Helper()
	root := os.Getenv("SHOP_SOURCE_READ_SOCKET_ROOT")
	if root == "" {
		t.Skip("explicit short owned Unix QA socket root supplied by Source-read CI")
	}
	if os.Geteuid() == 0 {
		t.Fatal("registered non-root OS caller required")
	}
	dir, err := os.MkdirTemp(root, "sr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	a := &publicInvoiceReadAuthority{p: originalShopInvoiceReadProfile{realm: "PUBLIC-realm", tenant: "PUBLIC-tenant", purpose: "PUBLIC-existing-purpose", epoch: 7, socket: filepath.Join(dir, "s"), service: "shop-source-public-fixture", orders: []string{o.ID, "PUBLIC-absent-order"}, uid: uint32(os.Geteuid()), pid: os.Getpid()}, selected: originalShopInvoiceReadScope{realm: "PUBLIC-realm", tenant: "PUBLIC-tenant", purpose: "PUBLIC-existing-purpose", epoch: 7, actor: buyer, role: "buyer", storeID: o.StoreID, productID: "shop.order", sourceOrder: o.ID}, mode: mode}
	switch mode {
	case "purpose":
		a.selected.purpose = "PUBLIC-wrong"
	case "epoch":
		a.selected.epoch--
	case "tenant":
		a.selected.tenant = "PUBLIC-other"
	case "store":
		a.selected.storeID = "PUBLIC-other-store"
	case "actor":
		a.selected.actor = "PUBLIC-other-actor"
	}
	a.hold = &publicInvoiceReadHold{owner: a}
	svc, err := prepareOriginalShopInvoiceReadService(t.Context(), a, func() (*Store, error) { return s, nil })
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- svc.Serve() }()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = svc.Close(ctx)
		select {
		case <-done:
		case <-ctx.Done():
			t.Error("original Unix service not drained")
		}
	})
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: a.p.socket, Service: a.p.service, PeerUID: a.p.uid, PeerPID: a.p.pid, Routes: []securelink.LocalCallerRoute{{Method: "GET", Path: OriginalShopInvoiceReadPath + o.ID, MaxBodyBytes: 1024, Timeout: time.Second}, {Method: "GET", Path: OriginalShopInvoiceReadPath + "PUBLIC-absent-order", MaxBodyBytes: 1024, Timeout: time.Second}}, Timeout: time.Second, MaxResponseBytes: maxBody})
	if err != nil {
		t.Fatal(err)
	}
	return svc, a, client
}
func sourceReadCall(t *testing.T, c *securelink.LocalCallerClient, body []byte) (securelink.LocalCallerResponse, error) {
	t.Helper()
	var selected map[string]string
	if err := json.Unmarshal(body, &selected); err != nil {
		return securelink.LocalCallerResponse{}, err
	}
	path, err := OriginalShopInvoiceReadPathFor(selected["productId"], selected["sourceOrder"])
	if err != nil {
		return securelink.LocalCallerResponse{}, err
	}
	return c.Call(t.Context(), "GET", path, "", nil)
}

func TestShopInvoiceSourceNormalFactoryMissingDoesNotOpenStore(t *testing.T) {
	opens := 0
	svc, err := OpenOriginalShopInvoiceReadService(t.Context(), func() (*Store, error) { opens++; return nil, nil })
	if !errors.Is(err, ErrShopInvoiceReadSourceNotSupplied) || !errors.Is(err, errShopProductAuthCalleeNotLinked) || opens != 0 {
		t.Fatal("ordinary data/ENV activated Source", err, opens)
	}
	if svc != nil {
		if err = svc.Close(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
}
func TestShopInvoiceSourceActualUnixColdOriginalReadNoMutation(t *testing.T) {
	s, buyer, o, request := publicSourceInvoiceRecord(t)
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	svc, a, client := publicInvoiceReadService(t, cold, buyer, o, "")
	a.hook = func(r *http.Request) {
		w := httptest.NewRecorder()
		svc.serveHTTP(w, r.Clone(r.Context()))
		if w.Code != 403 {
			t.Error("copied original request context forged caller", w.Code)
		}
	}
	before, _ := os.ReadFile(s.path)
	stateBefore, _ := json.Marshal(cold.s)
	body, _ := json.Marshal(map[string]string{"productId": "shop.order", "sourceOrder": o.ID})
	response, err := sourceReadCall(t, client, body)
	if err != nil || response.StatusCode != 200 {
		t.Fatal(err, response.StatusCode, string(response.Body))
	}
	want, _ := json.Marshal(request)
	if !bytes.Equal(want, response.Body) {
		t.Fatal("original bill/atom/merchant DATA reconstructed")
	}
	after, _ := os.ReadFile(s.path)
	stateAfter, _ := json.Marshal(cold.s)
	if !bytes.Equal(before, after) || !bytes.Equal(stateBefore, stateAfter) {
		t.Fatal("read wrote nonce/state/price/journal")
	}
	if a.hold.closes.Load() != 1 {
		t.Fatal("original held scope not closed once")
	}
}
func TestShopInvoiceSourceRejectsWrongScopeAndLateCurrent(t *testing.T) {
	for _, mode := range []string{"missing", "purpose", "epoch", "tenant", "store", "actor", "late"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, _ := publicSourceInvoiceRecord(t)
			_, _, client := publicInvoiceReadService(t, s, buyer, o, mode)
			body, _ := json.Marshal(map[string]string{"productId": "shop.order", "sourceOrder": o.ID})
			response, err := sourceReadCall(t, client, body)
			if err == nil && response.StatusCode < 400 {
				t.Fatal("invalid Source succeeded", mode)
			}
			if bytes.Contains(response.Body, []byte("domainData")) {
				t.Fatal("denial leaked original bill")
			}
		})
	}
}
func TestShopInvoiceSourceGETOnlyNoBodyAndNoPublicCaller(t *testing.T) {
	s, buyer, o, _ := publicSourceInvoiceRecord(t)
	svc, _, client := publicInvoiceReadService(t, s, buyer, o, "")
	path, _ := OriginalShopInvoiceReadPathFor("shop.order", o.ID)
	response, err := client.Call(t.Context(), "GET", path, "application/json", []byte(`{"actor":"owner"}`))
	if err == nil && response.StatusCode < 400 {
		t.Fatal("GET body supplied authority")
	}
	if _, err = OriginalShopInvoiceReadPathFor("other", o.ID); err == nil {
		t.Fatal("other product selected")
	}
	for _, target := range []string{path + "?actor=owner", OriginalShopInvoiceReadPath + "../other"} {
		r, err := client.Call(t.Context(), "GET", target, "", nil)
		if err == nil && r.StatusCode < 400 {
			t.Fatal("query/path alias selected original")
		}
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", path, nil)
	r.Header.Set("X-Peer-UID", "501")
	svc.serveHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("HTTP headers supplied caller", w.Code)
	}
}

func TestShopInvoiceSourceOriginalNotFoundAndChangedBillStayExact(t *testing.T) {
	for _, mode := range []string{"notfound", "changed", "wrong-reference"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, _ := publicSourceInvoiceRecord(t)
			_, a, client := publicInvoiceReadService(t, s, buyer, o, "")
			order := o.ID
			expected := 409
			if mode == "notfound" {
				order = "PUBLIC-absent-order"
				a.selected.sourceOrder = order
				expected = 404
			} else if mode == "changed" {
				changed := cloneOrder(o)
				changed.Lines[0].Title = "PUBLIC changed original bill"
				s.s.Orders[o.ID] = changed
			} else {
				for id, record := range s.s.BusinessEffects {
					var input nativeInvoiceInput
					if err := json.Unmarshal(record.Input, &input); err != nil {
						t.Fatal(err)
					}
					input.Request.SourceOrder = "PUBLIC-other-original"
					record.Input, _ = json.Marshal(input)
					s.s.BusinessEffects[id] = record
				}
			}
			body, _ := json.Marshal(map[string]string{"productId": "shop.order", "sourceOrder": order})
			response, err := sourceReadCall(t, client, body)
			if err != nil || response.StatusCode != expected || bytes.Contains(response.Body, []byte("domainData")) {
				t.Fatal("notfound/conflict changed or leaked", err, response.StatusCode, string(response.Body))
			}
		})
	}
}
func TestShopInvoiceSourceFailedChildCloseRetainsOwnerAndFirstCause(t *testing.T) {
	s, buyer, o, _ := publicSourceInvoiceRecord(t)
	svc, a, client := publicInvoiceReadService(t, s, buyer, o, "close-error")
	body, _ := json.Marshal(map[string]string{"productId": "shop.order", "sourceOrder": o.ID})
	response, _ := sourceReadCall(t, client, body)
	if bytes.Contains(response.Body, []byte("domainData")) {
		t.Fatal("close error emitted bill")
	}
	if a.closed.Load() != 0 || !svc.retired.Load() {
		t.Fatal("child close failure released Source or kept service active")
	}
	err := svc.Close(t.Context())
	if err == nil || !strings.Contains(err.Error(), "PUBLIC_SCOPE_CLOSE_FIRST_CAUSE") || a.closed.Load() != 1 || a.hold.closes.Load() != 2 {
		t.Fatal("close debt/first cause lost", err, a.closed.Load(), a.hold.closes.Load())
	}
}
func TestShopInvoiceSourceRetireJoinsHandlerBeforeAuthorityClose(t *testing.T) {
	s, buyer, o, _ := publicSourceInvoiceRecord(t)
	svc, a, client := publicInvoiceReadService(t, s, buyer, o, "")
	a.hold.entered = make(chan struct{})
	a.hold.release = make(chan struct{})
	result := make(chan securelink.LocalCallerResponse, 1)
	go func() {
		r, _ := client.Call(context.Background(), "GET", OriginalShopInvoiceReadPath+o.ID, "", nil)
		result <- r
	}()
	<-a.hold.entered
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	err := svc.Close(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) || a.closed.Load() != 0 {
		t.Fatal("Source closed before handler drain", err, a.closed.Load())
	}
	close(a.hold.release)
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = svc.Close(ctx)
	if !errors.Is(err, context.DeadlineExceeded) || a.closed.Load() != 1 {
		t.Fatal("actual later drain or first cause lost", err, a.closed.Load())
	}
	select {
	case r := <-result:
		if bytes.Contains(r.Body, []byte("domainData")) {
			t.Fatal("retired read emitted bill")
		}
	case <-ctx.Done():
		t.Fatal("caller not drained")
	}
}
