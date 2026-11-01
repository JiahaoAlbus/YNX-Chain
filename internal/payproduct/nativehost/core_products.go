//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"context"
	"log/slog"
	"net/http"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/cometbft/cometbft/node"
)

// BFTPrivateProductsConfig is operator service configuration, never Source
// authority. Core supplies its already-open original App/Node separately.
type BFTPrivateProductsConfig struct {
	Endpoint BFTEndpointConfig
	Products ProductsConfig
	Private  PrivateConfig
}

// BFTPrivateProducts is the one normal Core attachment. It owns only the
// product children and their LINK endpoints. A retained error is independent
// of completed cleanup: Core must test CoreReleased before closing its Node,
// Application, custody, stores or leases, even after constructor failure.
type BFTPrivateProducts struct {
	self        *BFTPrivateProducts
	mu, closeMu sync.Mutex
	engine      *EngineBinding
	products    *Products
	private     *Private
	first       error
	released    bool
}

// OpenBFTPrivateProducts runs the same frozen normal factories, once, with
// the original objects held by runPQNode. It neither starts/stops consensus
// nor opens an engine DB, creates identities or grants Root/merchant approval.
// Always retain the nonnull result before inspecting err.
func OpenBFTPrivateProducts(ctx context.Context, app *consensus.Application, original *node.Node, cfg BFTPrivateProductsConfig, build buildinfo.Info, logger *slog.Logger) (*BFTPrivateProducts, error) {
	h := &BFTPrivateProducts{}
	h.self = h
	fail := func(err error) (*BFTPrivateProducts, error) { h.remember(err); return h, err }
	if ctx == nil {
		return fail(ErrProductsRetired)
	}
	if err := ctx.Err(); err != nil {
		return fail(err)
	}
	var err error
	h.engine, err = BindBFT(app, original, cfg.Endpoint, build)
	if err != nil {
		return fail(err)
	}
	h.products, err = OpenProductsWithEngine(ctx, cfg.Products, h.engine, build, logger)
	if err != nil {
		return fail(err)
	}
	h.private, err = OpenPrivate(h.products, cfg.Private)
	if err != nil {
		return fail(err)
	}
	return h, nil
}

func (h *BFTPrivateProducts) remember(err error) {
	if err == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.first == nil {
		h.first = err
	}
}
func (h *BFTPrivateProducts) Err() error {
	if h == nil || h.self != h {
		return ErrProductsRetired
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.first
}

// Done is only the owned private Serve outcome. A product boundary failure
// does not itself stop consensus; the owning callsite retires/cleans it.
func (h *BFTPrivateProducts) Done() <-chan struct{} {
	if h == nil || h.self != h || h.private == nil {
		return nil
	}
	return h.private.Done()
}

// NativeSourceStatus preserves the independent real Auth commissioning cause.
// An open service attachment or CoreReleased is not business readiness.
func (h *BFTPrivateProducts) NativeSourceStatus() error {
	if h == nil || h.self != h || h.products == nil {
		return ErrOriginalEngineResourcesNotSupplied
	}
	return h.products.NativeSourceStatus()
}

// CloudHandler is the same independently owned normal Cloud handler, with its
// own original request/drain accounting. It is not a replacement Source.
func (h *BFTPrivateProducts) CloudHandler() (http.Handler, error) {
	if h == nil || h.self != h || h.products == nil {
		return nil, ErrProductsRetired
	}
	return h.products.CloudHandler()
}

// Retire stops original product admission/retry without closing borrowed Core.
func (h *BFTPrivateProducts) Retire() {
	if h == nil || h.self != h {
		return
	}
	if h.private != nil {
		h.remember(h.private.Retire())
	}
	if h.products != nil {
		h.products.Retire()
	}
}

// CoreReleased is cleanup DATA only. False requires retaining the same host
// and every borrowed Core parent; no unconditional Node/lease defer is safe.
func (h *BFTPrivateProducts) CoreReleased() bool {
	if h == nil {
		return true
	}
	if h.self != h {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.released
}

// Shutdown is retryable cleanup, never a retry of a product operation. It
// drains private requests and product workers/Source before the engine HTTP
// endpoint. First cause remains visible after a later successful cleanup.
func (h *BFTPrivateProducts) Shutdown(ctx context.Context) error {
	if h == nil || h.self != h || ctx == nil {
		return ErrProductsRetired
	}
	h.closeMu.Lock()
	defer h.closeMu.Unlock()
	if h.CoreReleased() {
		return h.Err()
	}
	h.Retire()
	if h.private != nil {
		h.remember(h.private.Shutdown(ctx))
		if !h.private.Closed() {
			return h.Err()
		}
	} else if h.products != nil {
		if err := h.products.Join(ctx); err != nil {
			h.remember(err)
			return h.Err()
		}
		h.remember(h.products.Close())
		if !h.products.Closed() {
			return h.Err()
		}
	}
	if h.engine != nil {
		h.remember(h.engine.ShutdownEndpoint(ctx))
		if !h.engine.endpointClosed() {
			return h.Err()
		}
	}
	h.mu.Lock()
	h.released = true
	h.mu.Unlock()
	return h.Err()
}
