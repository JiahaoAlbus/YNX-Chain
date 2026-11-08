//go:build linux || darwin

package securelink

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// This private transport owner is independent of Member/WPC's five-slot
// registration. Only the dedicated strong-Auth C entry constructs it from a
// retained original Product source loan. None of these DATA values is Source.
const productPrivateOperationCount = 14

type productPrivateProfile struct {
	resource, network, account, epoch, origin string
	cfg                                       LocalCallerClientConfig
	enabled                                   uint32
}

type productPrivateRequest struct {
	operation                 uint32
	method, path, contentType string
	body                      []byte
}

type productPrivateClient struct {
	profile         productPrivateProfile
	ctx             context.Context
	cancel          context.CancelFunc
	mu              sync.Mutex
	retired, closed bool
	inflight        int
	first           error
	active          atomic.Bool
	pending         map[uintptr]LocalCallerResponse
}

func newProductPrivateClient(ctx context.Context, p productPrivateProfile) (*productPrivateClient, error) {
	if ctx == nil || p.enabled == 0 || p.enabled>>productPrivateOperationCount != 0 || p.cfg.Timeout <= 0 || p.cfg.Timeout > 30*time.Second || p.cfg.MaxHeaderBytes < 1 || p.cfg.MaxHeaderBytes > 65536 || p.cfg.MaxResponseBytes < 1 || p.cfg.MaxResponseBytes > 1<<20 {
		return nil, ErrBounds
	}
	// The source profile names an operation grammar, not concrete parameter
	// paths. Validate its immutable endpoint now; create the real exact-route
	// LocalCallerClient after a concrete request passes that grammar. No dummy
	// route, unregistered permission or wildcard client is created at startup.
	if !localService(p.cfg.Service) || p.cfg.PeerUID == 0 || p.cfg.PeerPID <= 0 {
		return nil, ErrDenied
	}
	if err := privateParent(p.cfg.SocketPath, p.cfg.PeerUID); err != nil {
		return nil, err
	}
	child, cancel := context.WithCancel(ctx)
	owner := &productPrivateClient{profile: p, ctx: child, cancel: cancel, pending: make(map[uintptr]LocalCallerResponse)}
	owner.active.Store(true)
	if err := context.Cause(child); err != nil {
		owner.first = err
		owner.retired = true
		return owner, err
	}
	return owner, nil
}

func (p *productPrivateClient) remember(err error) {
	if err == nil {
		return
	}
	p.mu.Lock()
	if p.first == nil {
		p.first = err
	}
	p.mu.Unlock()
}

func (p *productPrivateClient) retire() {
	if p == nil {
		return
	}
	p.active.Store(false)
	p.mu.Lock()
	p.retired = true
	p.mu.Unlock()
	p.cancel()
}

// drain is bounded and nonblocking. The C owner separately keeps its loan and
// response debt until this actual synchronous request has returned.
func (p *productPrivateClient) drain() (bool, error) {
	if p == nil {
		return true, nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.retired {
		return false, ErrDenied
	}
	if p.inflight != 0 || len(p.pending) != 0 {
		return false, ErrLocalCallerDraining
	}
	p.closed = true
	return true, p.first
}

func (p *productPrivateClient) request(r productPrivateRequest, current func() error) (out LocalCallerResponse, err error) {
	if p == nil || current == nil {
		return out, ErrDenied
	}
	if err = productPrivateRoute(r); err != nil {
		p.remember(err)
		return out, err
	}
	p.mu.Lock()
	if p.retired || p.closed || p.ctx.Err() != nil || p.inflight != 0 || p.profile.enabled&(uint32(1)<<r.operation) == 0 {
		p.mu.Unlock()
		return out, ErrDenied
	}
	p.inflight++
	p.mu.Unlock()
	defer func() {
		if cause := context.Cause(p.ctx); err != nil && cause != nil {
			err = errors.Join(err, cause)
		}
		p.mu.Lock()
		p.inflight--
		if err != nil && p.first == nil {
			p.first = err
		}
		p.mu.Unlock()
	}()
	cfg := p.profile.cfg
	maximum := int64(0)
	if r.method == http.MethodPost {
		maximum = 1 << 20
	}
	cfg.Routes = []LocalCallerRoute{{Method: r.method, Path: r.path, MaxBodyBytes: maximum, Timeout: cfg.Timeout}}
	client, e := newProductRouteClient(cfg, r)
	if e != nil {
		return out, e
	}
	// Native-only current runs after actual UID/PID evidence, immediately before
	// Write, with no owner/Store mutex held. Caller owns its fence through return.
	return client.call(p.ctx, r.method, r.path, r.contentType, bytes.Clone(r.body), func() error {
		if !p.active.Load() {
			return ErrDenied
		}
		if err := p.ctx.Err(); err != nil {
			return err
		}
		if err := current(); err != nil {
			return err
		}
		if !p.active.Load() {
			return ErrDenied
		}
		return p.ctx.Err()
	})
}

func newProductRouteClient(cfg LocalCallerClientConfig, r productPrivateRequest) (*LocalCallerClient, error) {
	if err := productPrivateRoute(r); err != nil {
		return nil, err
	}
	if !strings.Contains(r.path, "%") {
		return NewLocalCallerClient(cfg)
	}
	// Only archive %3A survives the exact r2 matcher. The legacy constructor
	// intentionally rejects escaped targets. Preserve that API unchanged while
	// registering this ONE original raw target privately for Product transport.
	if r.operation < 12 || !localService(cfg.Service) || cfg.PeerUID == 0 || cfg.PeerPID <= 0 {
		return nil, ErrDenied
	}
	if err := privateParent(cfg.SocketPath, cfg.PeerUID); err != nil {
		return nil, err
	}
	if len(cfg.Routes) != 1 || cfg.Routes[0].Method != r.method || cfg.Routes[0].Path != r.path {
		return nil, ErrDenied
	}
	route := cfg.Routes[0]
	cfg.Routes = nil
	return &LocalCallerClient{cfg: cfg, routes: map[string]LocalCallerRoute{r.method + " " + r.path: route}}, nil
}

var productPrivateTemplates = [productPrivateOperationCount]string{
	"/v5/pay/invoice-intents", "/v5/pay/invoice-intents/lookup",
	"/v5/pay/invoice-intents/{intentId}/merchant-review", "/v5/pay/invoice-intents/{intentId}",
	"/v5/pay/invoices/{merchant}/{invoiceId}", "/v5/pay/invoices/{merchant}/{invoiceId}/events",
	"/v5/pay/invoices/{merchant}/{invoiceId}/review", "/v5/pay/invoices/{merchant}/{invoiceId}/refund-review",
	"/v5/pay/invoice-intents/{intentId}/reconcile", "/v5/pay/invoices/{merchant}/{invoiceId}/operations/{nativeHash}/reconcile",
	"", "/v5/pay/invoices/{merchant}/{invoiceId}",
	"/v5/pay/products/{productId}/{sourceOrder}/invoices/{merchant}/{invoiceId}/originals/{nativeHash}/receipt",
	"/v5/pay/products/{productId}/{sourceOrder}/invoices/{merchant}/{invoiceId}/archive-reconciliation",
}

func productPrivateRoute(r productPrivateRequest) error {
	if r.operation >= productPrivateOperationCount || r.operation == 10 || len(r.path) > 4096 || len(r.path) == 0 || strings.ContainsAny(r.path, "?#\\") {
		return ErrDenied
	}
	for _, b := range []byte(r.path) {
		if b < 0x21 || b > 0x7e {
			return ErrDenied
		}
	}
	post := r.operation == 0 || r.operation == 1 || r.operation == 2 || r.operation == 6 || r.operation == 7 || r.operation == 8 || r.operation == 9
	if post {
		if r.method != http.MethodPost || r.contentType != "application/json" {
			return ErrDenied
		}
		if len(r.body) == 0 || len(r.body) > 1<<20 {
			return ErrBounds
		}
	} else if r.method != http.MethodGet || r.contentType != "" || len(r.body) != 0 {
		return ErrDenied
	}
	parts, want := strings.Split(r.path, "/"), strings.Split(productPrivateTemplates[r.operation], "/")
	if len(parts) != len(want) {
		return ErrDenied
	}
	for i, part := range parts {
		if strings.HasPrefix(want[i], "{") {
			if !productPrivateOperand(want[i], part, r.operation >= 12) {
				return ErrDenied
			}
		} else if part != want[i] {
			return ErrDenied
		}
	}
	return nil
}

// Exact DATA grammar from Auth transport-contract-r2's executable matcher.
// It grants no permission; the retained original loan and per-call native
// permission remain independently mandatory before and after actual IO.
func productPrivateLowerHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for _, b := range []byte(s) {
		if !(b >= '0' && b <= '9' || b >= 'a' && b <= 'f') {
			return false
		}
	}
	return true
}
func productPrivateID(s string, archive bool) bool {
	count := 0
	for i := 0; i < len(s); i++ {
		b := s[i]
		escaped := false
		if b == '%' {
			if !archive || i+3 > len(s) || s[i:i+3] != "%3A" {
				return false
			}
			b = ':'
			i += 2
			escaped = true
		}
		alnum := b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || archive && b >= 'A' && b <= 'Z'
		if count == 0 {
			if !alnum {
				return false
			}
		} else if !alnum && !strings.ContainsRune("._:-", rune(b)) {
			return false
		}
		if archive && b == ':' && !escaped {
			return false
		}
		count++
	}
	if archive {
		return count >= 3 && count <= 128
	}
	return count >= 1 && count <= 64
}
func productPrivateOperand(label, value string, archive bool) bool {
	switch label {
	case "{intentId}":
		return strings.HasPrefix(value, "npi_") && productPrivateLowerHex(strings.TrimPrefix(value, "npi_"), 48)
	case "{merchant}":
		return strings.HasPrefix(value, "0x") && productPrivateLowerHex(strings.TrimPrefix(value, "0x"), 40)
	case "{nativeHash}":
		return strings.HasPrefix(value, "0x") && productPrivateLowerHex(strings.TrimPrefix(value, "0x"), 64)
	case "{productId}":
		return value == "shop.order" || value == "cloud.ide-usage"
	case "{sourceOrder}":
		return productPrivateID(value, true)
	case "{invoiceId}":
		return productPrivateID(value, archive)
	default:
		return false
	}
}

type productPrivateNativeError struct{ code int32 }

func (e productPrivateNativeError) Error() string {
	return fmt.Sprintf("original Product native current rejected (%d)", e.code)
}

func productPrivateErrorCode(err error) int32 {
	if err == nil {
		return 0
	}
	var native productPrivateNativeError
	switch {
	case errors.As(err, &native):
		return 6
	case errors.Is(err, ErrBounds):
		return 2
	case errors.Is(err, ErrUnavailable):
		return 3
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		return 4
	case errors.Is(err, ErrLocalCallerDraining):
		return 5
	default:
		return 1
	}
}
