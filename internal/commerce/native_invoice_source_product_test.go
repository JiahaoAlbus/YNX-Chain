package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// PUBLIC in-process Auth supplier controls, never compiled into normal shopd.
// They test the owning product adapter; they do not grant Source admission.
type publicShopProductSource struct {
	context                                          originalShopProductContext
	retired                                          atomic.Bool
	sourceChecks, borrowed, permissionChecks, closed atomic.Int32
	lockedPermissionChecks                           atomic.Int32
	store                                            *Store
	denyPermission                                   atomic.Bool
	failBorrow, failClose                            atomic.Bool
	permissionCloses                                 atomic.Int32
	lastRequest                                      *http.Request
}

func (s *publicShopProductSource) current(ctx context.Context) error {
	s.sourceChecks.Add(1)
	// Full Source qualification/refresh is forbidden under the Store lock.
	if !s.store.mu.TryLock() {
		return errors.New("PUBLIC_SOURCE_IO_UNDER_STORE_LOCK")
	}
	s.store.mu.Unlock()
	if s.retired.Load() {
		return errShopInvoiceReadDenied
	}
	return ctx.Err()
}
func (s *publicShopProductSource) capture(context.Context) (originalShopProductContext, error) {
	return s.context, nil
}
func (s *publicShopProductSource) borrow(_ context.Context, r *http.Request, ref originalShopProductReference) (originalShopProductPermission, error) {
	if ref.productID != "shop.order" || ref.sourceOrder != s.context.scope.products[0].sourceOrder {
		return nil, errShopInvoiceReadDenied
	}
	s.lastRequest = r
	s.borrowed.Add(1)
	if s.failBorrow.Load() {
		return &publicShopProductPermission{source: s}, errors.New("PUBLIC_ORIGINAL_AUTH_PARTIAL_BORROW")
	}
	return &publicShopProductPermission{source: s}, nil
}
func (s *publicShopProductSource) retire() error { s.retired.Store(true); return nil }
func (s *publicShopProductSource) close() error  { s.closed.Add(1); return nil }

type publicShopProductPermission struct{ source *publicShopProductSource }

func (p *publicShopProductPermission) current(ctx context.Context) error {
	p.source.permissionChecks.Add(1)
	if p.source.store.mu.TryLock() {
		p.source.store.mu.Unlock()
	} else {
		p.source.lockedPermissionChecks.Add(1)
	}
	if p.source.retired.Load() || p.source.denyPermission.Load() {
		return errShopInvoiceReadDenied
	}
	return ctx.Err()
}
func (p *publicShopProductPermission) close() error {
	p.source.permissionCloses.Add(1)
	if p.source.failClose.Swap(false) {
		return errors.New("PUBLIC_ORIGINAL_PERMISSION_CLOSE_DEBT")
	}
	return nil
}

func publicShopProductMapping(t *testing.T, s *Store, buyer string, o Order) *publicShopProductSource {
	t.Helper()
	account, err := accountaddress.Normalize(buyer)
	if err != nil {
		t.Fatal(err)
	}
	p := originalShopInvoiceReadProfile{realm: "PUBLIC-realm", tenant: "PUBLIC-tenant", purpose: shopProductSourcePurpose, epoch: 19, service: "PUBLIC-original-shop-product", uid: uint32(os.Geteuid()), pid: os.Getpid()}
	selection := originalShopInvoiceReadScope{realm: p.realm, tenant: p.tenant, purpose: p.purpose, epoch: p.epoch, actor: buyer, role: "buyer", storeID: o.StoreID, productID: "shop.order", sourceOrder: o.ID}
	return &publicShopProductSource{store: s, context: originalShopProductContext{purpose: shopProductSourcePurpose, selection: shopProductSourceSelection, sourceEpoch: p.epoch,
		scope:    originalShopProductScopeDATA{version: 1, networkID: strings.Repeat("ab", 32), account: account, protectedResourceRef: "PUBLIC-original-shop-resource", operations: []string{"readOriginalInvoiceIntent"}, products: []originalShopProductReference{{"shop.order", o.ID}}},
		resource: originalShopProductResource{ref: "PUBLIC-original-shop-resource", networkID: strings.Repeat("ab", 32), account: account, profile: p, selections: []originalShopInvoiceReadScope{selection}}}}
}

func TestShopInvoiceSourceProductScopeAndResourceMustJoin(t *testing.T) {
	for _, mode := range []string{"valid", "purpose", "selection", "epoch", "network", "account", "resource-ref", "resource-network", "resource-account", "role", "tenant", "actor", "unselected-order", "missing-order", "missing-operation"} {
		t.Run(mode, func(t *testing.T) {
			s, buyer, o, _ := publicSourceInvoiceRecord(t)
			source := publicShopProductMapping(t, s, buyer, o)
			c := &source.context
			switch mode {
			case "purpose":
				c.purpose = "wallet-native-member-source-v1"
			case "selection":
				c.selection = "codeRoot"
			case "epoch":
				c.sourceEpoch++
			case "network":
				c.scope.networkID = strings.Repeat("AB", 32)
			case "account":
				c.scope.account = "ynx-not-a-closed-account"
			case "resource-ref":
				c.resource.ref = "PUBLIC-other-resource"
			case "resource-network":
				c.resource.networkID = strings.Repeat("cd", 32)
			case "resource-account":
				c.resource.account = "0x" + strings.Repeat("b", 40)
			case "role":
				c.resource.selections[0].role = "admin"
			case "tenant":
				c.resource.selections[0].tenant = "PUBLIC-other-tenant"
			case "actor":
				c.resource.selections[0].actor = "0x" + strings.Repeat("b", 40)
			case "unselected-order":
				c.resource.selections = append(c.resource.selections, originalShopInvoiceReadScope{realm: c.resource.profile.realm, tenant: c.resource.profile.tenant, purpose: c.purpose, epoch: c.sourceEpoch, actor: buyer, role: "buyer", storeID: o.StoreID, productID: "shop.order", sourceOrder: "PUBLIC-other-order"})
			case "missing-order":
				c.resource.selections = nil
			case "missing-operation":
				c.scope.operations = []string{"readInvoice"}
			}
			a := &originalShopProductReadAuthority{source: source}
			err := a.capture(t.Context())
			if mode == "valid" {
				if err != nil {
					t.Fatal(err)
				}
				p, err := a.profile(t.Context())
				if err != nil || len(p.orders) != 1 || p.orders[0] != o.ID {
					t.Fatal(p, err)
				}
			} else if err == nil {
				t.Fatal("detached or mismatched Source resource was accepted")
			}
			if err := a.retire(); err != nil {
				t.Fatal(err)
			}
			if err := a.close(); err != nil || source.closed.Load() != 1 {
				t.Fatal("original parent not closed", err)
			}
		})
	}
}

func TestShopInvoiceSourceProductActualUnixColdMapAndNativePermission(t *testing.T) {
	root := os.Getenv("SHOP_SOURCE_READ_SOCKET_ROOT")
	if root == "" {
		t.Skip("original Source CI supplies short private Unix root")
	}
	s, buyer, o, request := publicSourceInvoiceRecord(t)
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	source := publicShopProductMapping(t, cold, buyer, o)
	dir, err := os.MkdirTemp(root, "pm-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	source.context.resource.profile.socket = filepath.Join(dir, "s")
	a := &originalShopProductReadAuthority{source: source}
	if err := a.capture(t.Context()); err != nil {
		t.Fatal(err)
	}
	svc, err := prepareOriginalShopInvoiceReadService(t.Context(), a, func() (*Store, error) { return cold, nil })
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- svc.Serve() }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := svc.Close(ctx); err != nil {
			if !strings.Contains(err.Error(), "PUBLIC_ORIGINAL_PERMISSION_CLOSE_DEBT") {
				t.Error(err)
			}
		}
		if source.closed.Load() != 1 {
			t.Error("Root parent not closed once after original children drained")
		}
		select {
		case <-done:
		case <-ctx.Done():
			t.Error("actual handler did not drain")
		}
	}()
	p := source.context.resource.profile
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: p.socket, Service: p.service, PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Routes: []securelink.LocalCallerRoute{{Method: "GET", Path: OriginalShopInvoiceReadPath + o.ID, MaxBodyBytes: 1, Timeout: time.Second}}, Timeout: time.Second, MaxResponseBytes: maxBody})
	if err != nil {
		t.Fatal(err)
	}
	path, _ := OriginalShopInvoiceReadPathFor("shop.order", o.ID)
	out, err := client.Call(t.Context(), "GET", path, "", nil)
	expected, _ := json.Marshal(request)
	if err != nil || out.StatusCode != 200 || !bytes.Equal(bytes.TrimSpace(out.Body), expected) || source.borrowed.Load() != 1 || source.lockedPermissionChecks.Load() < 2 {
		t.Fatal("original product map/permission/Store read did not join", out.StatusCode, err, source.lockedPermissionChecks.Load())
	}
	// A live OS peer and copied scope cannot replace the Native observed loan.
	source.denyPermission.Store(true)
	out, err = client.Call(t.Context(), "GET", path, "", nil)
	if err != nil || out.StatusCode != 403 || bytes.Contains(out.Body, []byte("amountAtoms")) {
		t.Fatal("expired Native permission emitted original bill", out.StatusCode, err)
	}
	after, err := os.ReadFile(s.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read mapping enrolled a namespace or altered Store", err)
	}
	// Caller-controlled HTTP has no original LINK request, even with same path.
	forged, _ := http.NewRequestWithContext(t.Context(), "GET", "https://invalid"+path, nil)
	if hold, err := a.open(t.Context(), forged, "shop.order", o.ID); err == nil || hold != nil {
		t.Fatal("plain request received actual Source loan")
	}
	// A genuine supplier may return a child AND an error. Adopt it before
	// interpreting the failure; close debt keeps the original parent held.
	source.failBorrow.Store(true)
	source.failClose.Store(true)
	out, err = client.Call(t.Context(), "GET", path, "", nil)
	// Retiring LINK can close the request before an HTTP rejection is emitted.
	// Either EOF or an explicit failure is valid; bill bytes/early Root close are not.
	if (err == nil && out.StatusCode < 400) || bytes.Contains(out.Body, []byte("amountAtoms")) || source.closed.Load() != 0 {
		t.Fatal("partial Native loan escaped custody or closed parent early", out.StatusCode, err, source.closed.Load())
	}
	svc.stateMu.Lock()
	debt := len(svc.children)
	svc.stateMu.Unlock()
	if debt != 1 || source.borrowed.Load() != 3 {
		t.Fatal("original partial permission not retained", debt, source.borrowed.Load())
	}
}
