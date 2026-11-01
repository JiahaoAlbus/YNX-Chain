//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// PrivateConfig registers one exact original OS caller and fixed routes. The
// original LINK implementation enforces canonical paths, body limits/timeouts,
// UID/PID and the original request lifetime. No Handler/Source callback exists.
type PrivateConfig struct {
	SocketPath string
	Service    string
	PeerUID    uint32
	PeerPID    int
	Routes     []securelink.LocalCallerRoute
}

type Private struct {
	products *Products
	listener net.Listener
	server   *securelink.LocalCallerServer
	done     chan struct{}
	mu       sync.Mutex
	closeMu  sync.Mutex
	first    error
	serveErr error
	closed   bool
}

// OpenPrivate uses only the actual product handlers and existing private LINK
// listener. It never opens TCP, unlinks a previous socket or chooses a request-
// supplied target. Keep this nonnull partial on error and Shutdown it too.
func OpenPrivate(products *Products, cfg PrivateConfig) (*Private, error) {
	p := &Private{products: products, done: make(chan struct{})}
	fail := func(err error) (*Private, error) { p.first = err; close(p.done); return p, err }
	if products == nil {
		return fail(ErrProductsRetired)
	}
	pay, err := products.Handler()
	if err != nil {
		return fail(err)
	}
	cloud, err := products.CloudHandler()
	if err != nil {
		return fail(err)
	}
	actual := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v5/pay/") {
			pay.ServeHTTP(w, r)
		} else {
			cloud.ServeHTTP(w, r)
		}
	})
	p.server, err = securelink.NewLocalCallerServer(securelink.LocalCallerServerConfig{Service: cfg.Service, PeerUID: cfg.PeerUID, PeerPID: cfg.PeerPID, Routes: cfg.Routes, Handler: actual})
	if err != nil {
		return fail(err)
	}
	p.listener, err = securelink.ListenPrivate(cfg.SocketPath, cfg.PeerUID)
	if err != nil {
		return fail(err)
	}
	go func() {
		err := p.server.Serve(p.listener)
		p.mu.Lock()
		p.serveErr = err
		p.mu.Unlock()
		close(p.done)
	}()
	return p, nil
}

func (p *Private) Done() <-chan struct{} { return p.done }

func (p *Private) remember(err error) {
	if err == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.first == nil {
		p.first = err
	}
}

// Retire stops original admission and workers without claiming their drain.
func (p *Private) Retire() error {
	if p == nil {
		return nil
	}
	if p.server != nil {
		p.remember(p.server.Retire())
	}
	if p.products != nil {
		p.products.Retire()
	}
	return p.Err()
}

func (p *Private) Closed() bool {
	if p == nil {
		return true
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.closed
}

// Shutdown retains the listener even before Serve transfers ownership. It
// closes that exact listener explicitly, drains the actual registered handlers
// and Serve goroutine, then drains/closes product children/parents. Failure at
// any drain or child close leaves the later parents alive and first cause intact.
func (p *Private) Shutdown(ctx context.Context) error {
	if p == nil || ctx == nil {
		return ErrProductsRetired
	}
	p.closeMu.Lock()
	defer p.closeMu.Unlock()
	if p.Closed() {
		return p.Err()
	}
	remember := p.remember
	p.Retire()
	if p.listener != nil {
		if err := p.listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			remember(err)
			return p.Err()
		}
	}
	if p.products != nil {
		p.products.Retire()
	}
	if p.server != nil {
		if err := p.server.Join(ctx); err != nil {
			remember(err)
			return p.Err()
		}
	}
	select {
	case <-ctx.Done():
		remember(ctx.Err())
		return p.Err()
	case <-p.done:
	}
	p.mu.Lock()
	serveErr := p.serveErr
	p.mu.Unlock()
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) && !errors.Is(serveErr, net.ErrClosed) {
		remember(serveErr)
	}
	if p.server != nil {
		if err := p.server.Close(); err != nil {
			remember(err)
			return p.Err()
		}
	}
	if p.products != nil {
		if err := p.products.Join(ctx); err != nil {
			remember(err)
			return p.Err()
		}
		remember(p.products.Close())
		if !p.products.Closed() {
			return p.Err()
		}
	}
	p.mu.Lock()
	p.closed = true
	p.mu.Unlock()
	return p.Err()
}

func (p *Private) Err() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.first
}
