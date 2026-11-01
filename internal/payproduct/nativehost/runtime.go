//go:build pay_pq && pay_cloud && pay_auth_source

// Package nativehost is the owning process's normal composition of the exact
// Auth/Cloud/Pay/Core resources. It imports the supplier as a dependency, never
// copies a Source implementation into Pay or constructs grants from JSON.
package nativehost

import (
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"

	paynativesource "github.com/JiahaoAlbus/YNX-Chain/internal/authnativesource"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

type Resources = paynativesource.OriginalNativePayResources
type Engine = paynativesource.OriginalPayEngine

const NativeEngine = paynativesource.OriginalPayNativeEngine
const BFTEngine = paynativesource.OriginalPayBFTEngine

type Runtime struct {
	composition *paynativesource.OriginalPrivateNativePayComposition
	mu          sync.Mutex
	retired     atomic.Bool
	first       error
}

// New borrows mutually exclusive native or BFT original resources. The service's own Store is
// always used; another Store cannot be substituted even when its DATA matches.
// Native uses the actual Devnet; BFT uses the actual App+Node, never an input
// BlockStore. Other parents must come from the original hosting process, never a
// second ledger/Cloud server, a locator or a reconstructed RPC projection.
// Every nonnull Auth partial is retained before inspecting its error.
func New(parent *payproduct.Service, resources Resources, coreHTTP *payproduct.NativePayHTTP, build buildinfo.Info, logger *slog.Logger) (*Runtime, error) {
	runtime := &Runtime{}
	if parent != nil {
		store, e := parent.BorrowOriginalNativePayStore()
		if e != nil {
			runtime.first = e
			return runtime, e
		}
		if resources.PayStore != nil && resources.PayStore != store {
			runtime.first = errors.New("PAY_ORIGINAL_STORE_IDENTITY_MISMATCH")
			return runtime, runtime.first
		}
		resources.PayStore = store
	}
	composition, e := paynativesource.NewOriginalPrivateNativePayServer(parent, resources, coreHTTP, build, logger)
	runtime.composition = composition
	if e != nil {
		runtime.first = e
		return runtime, e
	}
	if composition == nil || composition.Source == nil || composition.Server == nil || composition.Intents == nil || composition.Handler == nil {
		runtime.first = errors.New("PAY_ORIGINAL_SOURCE_COMPOSITION_INCOMPLETE")
		return runtime, runtime.first
	}
	return runtime, nil
}
func (r *Runtime) Ready() bool {
	return r != nil && !r.retired.Load() && r.Err() == nil && r.composition != nil && r.composition.Handler != nil
}
func (r *Runtime) Handler() http.Handler {
	if !r.Ready() {
		return nil
	}
	return r.composition.Handler
}
func (r *Runtime) Err() error {
	if r == nil {
		return payproduct.ErrNativePayUnavailable
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.first
}
func (r *Runtime) PartialRetained() bool {
	return r != nil && r.composition != nil && r.composition.Source != nil
}
func (r *Runtime) CompositionRetained() bool { return r != nil && r.composition != nil }
func (r *Runtime) Retire() {
	if r != nil {
		r.retired.Store(true)
		if r.composition != nil && r.composition.Source != nil {
			r.composition.Source.Retire()
		}
	}
}
func (r *Runtime) Close() error {
	if r == nil || r.composition == nil || r.composition.Source == nil {
		return nil
	}
	r.Retire()
	e := r.composition.Source.Close()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.first == nil && e != nil {
		r.first = e
	}
	return e
}
