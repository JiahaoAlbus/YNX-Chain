//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

var ErrOriginalEngineContractNotLinked = errors.New("PAY_HOST_ORIGINAL_ENGINE_SOURCE_CONTRACT_NOT_LINKED")
var ErrProductsRetired = errors.New("PAY_HOST_RETIRED")
var ErrProductsDraining = errors.New("PAY_HOST_CHILDREN_STILL_DRAINING")

type ProductsConfig struct {
	Pay           payproduct.Config
	Central       payproduct.NormalCentralPayEndpoint
	Cloud         cloud.OriginalPrivateHostConfig
	RetryInterval time.Duration
}

// Products owns actual Pay/P04 constructors and the actual Auth child, not the
// enclosing listener or borrowed Core parents. Retain its partial before err.
type Products struct {
	mu, closeMu sync.Mutex
	pay         *payproduct.NormalProduct
	cloud       *cloud.OriginalPrivateHost
	native      *Runtime
	first       error
	retired     bool
	active      int
	work        sync.WaitGroup
	joinOnce    sync.Once
	drained     chan struct{}
	cancel      context.CancelFunc
	stopParent  func() bool
	handler     http.Handler
	closedPay   http.Handler
	closed      bool
	joined      bool
	closeErr    error
}

// OpenProducts makes the unique original Pay Store and Cloud Server/Reader in
// this process. It never starts a public listener or creates Core objects.
// Auth's engine-specific normal Source contract must be linked separately;
// the withdrawn universal Devnet/Application/BlockStore tuple is not accepted.
// Until then the actual original closed Pay server refuses protected routes,
// while independent genuine Cloud parent routes remain usable.
func OpenProducts(ctx context.Context, cfg ProductsConfig, build buildinfo.Info, logger *slog.Logger) (*Products, error) {
	h := &Products{drained: make(chan struct{})}
	fail := func(err error) (*Products, error) { h.first = err; return h, err }
	if ctx == nil {
		return fail(ErrProductsRetired)
	}
	if err := ctx.Err(); err != nil {
		return fail(err)
	}
	if cfg.RetryInterval == 0 {
		cfg.RetryInterval = 15 * time.Second
	}
	if cfg.RetryInterval < 100*time.Millisecond || cfg.RetryInterval > time.Minute {
		return fail(errors.New("invalid normal Pay retry interval"))
	}
	workerCtx, cancel := context.WithCancel(ctx)
	h.cancel = cancel
	var err error
	h.cloud, err = cloud.OpenOriginalPrivateHost(workerCtx, cfg.Cloud)
	if err != nil {
		return fail(err)
	}
	h.pay, err = payproduct.OpenNormalProduct(cfg.Pay, cfg.Central)
	if err != nil {
		return fail(err)
	}
	parent := h.pay.Service()
	h.closedPay = payproduct.NewClosedProductionServerWithLogger(parent, build, logger).Handler()
	h.work.Add(1)
	go func() {
		defer h.work.Done()
		ticker := time.NewTicker(cfg.RetryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				parent.RetryDue(workerCtx)
			}
		}
	}()
	h.handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		if h.retired || ctx.Err() != nil {
			h.mu.Unlock()
			http.Error(w, "PAY_HOST_RETIRED", http.StatusServiceUnavailable)
			return
		}
		h.active++
		h.work.Add(1)
		h.mu.Unlock()
		defer func() { h.mu.Lock(); h.active--; h.mu.Unlock(); h.work.Done() }()
		// Same *http.Request: do not clone away LINK's original caller binding.
		h.closedPay.ServeHTTP(w, r)
	})
	h.stopParent = context.AfterFunc(ctx, h.Retire)
	if err = ctx.Err(); err != nil {
		h.Retire()
		return fail(err)
	}
	return h, nil
}

func (h *Products) Handler() (http.Handler, error) {
	if h == nil {
		return nil, ErrProductsRetired
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.retired {
		return nil, ErrProductsRetired
	}
	if h.first != nil {
		return nil, h.first
	}
	return h.handler, nil
}

// This exact error distinguishes the known missing normal engine CODE from a
// request for users to supply objects or from genuine Root commissioning.
func (h *Products) NativeSourceStatus() error { return ErrOriginalEngineContractNotLinked }

// This is the genuine Cloud handler, independently closed by its own host.
// A missing Pay/Core Source cannot replace it or disable unrelated reads.
func (h *Products) CloudHandler() (http.Handler, error) {
	if h == nil || h.cloud == nil {
		return nil, ErrProductsRetired
	}
	return h.cloud.Handler()
}

func (h *Products) Retire() {
	if h == nil {
		return
	}
	h.mu.Lock()
	h.retired = true
	h.mu.Unlock()
	if h.native != nil {
		h.native.Retire()
	}
	if h.cancel != nil {
		h.cancel()
	}
	if h.cloud != nil {
		h.cloud.Retire()
	}
}

// Retire the original listener too and Join that boundary independently before
// closing Products. This Join covers product handlers, retry and Cloud workers.
func (h *Products) Join(ctx context.Context) error {
	if h == nil || ctx == nil {
		return ErrProductsRetired
	}
	h.Retire()
	h.joinOnce.Do(func() { go func() { h.work.Wait(); close(h.drained) }() })
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-h.drained:
	}
	if h.cloud != nil {
		if err := h.cloud.Join(ctx); err != nil {
			return err
		}
	}
	h.mu.Lock()
	h.joined = true
	h.mu.Unlock()
	return nil
}

// Close never closes borrowed Core resources. Any undrained request, Source
// close failure or Cloud child debt retains all still-dependent owned parents.
// Keep the first close cause even if a later retry can release remaining debt.
func (h *Products) Close() error {
	if h == nil {
		return nil
	}
	h.Retire()
	h.closeMu.Lock()
	defer h.closeMu.Unlock()
	remember := func(err error) error {
		if h.closeErr == nil {
			h.closeErr = err
		}
		return h.closeErr
	}
	if h.closed {
		return h.closeErr
	}
	h.mu.Lock()
	joined := h.joined
	h.mu.Unlock()
	if !joined {
		return remember(ErrProductsDraining)
	}
	if h.native != nil {
		if err := h.native.Close(); err != nil {
			return remember(err)
		}
	}
	if h.cloud != nil {
		if err := h.cloud.Close(); err != nil {
			return remember(err)
		}
	}
	if h.pay != nil {
		if err := h.pay.Close(); err != nil {
			return remember(err)
		}
	}
	if h.stopParent != nil {
		h.stopParent()
	}
	h.closed = true
	return h.closeErr
}
