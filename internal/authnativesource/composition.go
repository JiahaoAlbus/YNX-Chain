//go:build pay_pq

package paynativesource

import (
	"log/slog"
	"net/http"
	"slices"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

// This is the normal P06 private factory closure, not a fixture or alternate
// service. It calls the real unchanged product constructors and preserves the
// typed Source partial before any error. Caller owns listener/HTTP/Core parents.
type OriginalPrivateNativePayComposition struct {
	Source  *Owner
	Server  *payproduct.Server
	Intents *payproduct.NativeInvoiceIntents
	Handler http.Handler
}

func NewOriginalPrivateNativePayServer(parent *payproduct.Service, resources OriginalNativePayResources, coreHTTP *payproduct.NativePayHTTP, build buildinfo.Info, logger *slog.Logger) (*OriginalPrivateNativePayComposition, error) {
	result := &OriginalPrivateNativePayComposition{}
	// Devnet account registration reads do not imply its handler can execute
	// invoice fee-one/terms/settlement actions. No nil HTTP/native fallback.
	if resources.Engine == OriginalPayNativeEngine {
		return result, ErrNativeInvoiceUnsupported
	}
	source, e := NewOriginalNativePaySource(resources)
	result.Source = source
	if e != nil {
		return result, e
	}
	if e = bindOriginalPayHTTP(source.runtime, coreHTTP); e != nil {
		return result, e
	}
	reader, e := payproduct.NewRegisteredNativeInvoiceIntentSource(parent, source.InvoiceReader())
	if e != nil {
		return result, e
	}
	server, intents, e := payproduct.NewPrivateNativePayServer(parent, payproduct.NativePayConfig{Genesis: slices.Clone(source.runtime.genesis), NativeChainID: source.runtime.nativeID, HTTP: coreHTTP, Authority: source.Authority(), ProofSource: source.ProofSource()}, reader, build, logger)
	result.Server = server
	result.Intents = intents
	if e != nil {
		return result, e
	}
	result.Handler = source.WrapOriginalPrivateHandler(server.Handler())
	return result, nil
}

// Only the concrete product transport constructed by P06 is accepted. The
// read-only methods expose its immutable constructor identity, not a setter,
// transport callback or grant. Exact origin is independently SDK/Root bound.
func bindOriginalPayHTTP(runtime *commissionedRuntime, transport *payproduct.NativePayHTTP) error {
	if runtime == nil || runtime.engine != OriginalPayBFTEngine || transport == nil || runtime.nodeOrigin == "" {
		return ErrPayEngineResources
	}
	origin, e := transport.OriginData()
	if e != nil {
		return e
	}
	if transport.Engine() != string(runtime.engine) || origin != runtime.nodeOrigin {
		return ErrPayEngineResources
	}
	return nil
}
