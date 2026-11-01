//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"errors"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

var ErrNativeInvoiceTransportUnsupported = errors.New("PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED")
var ErrEngineEndpointNotSupplied = errors.New("PAY_HOST_SAME_ENGINE_ENDPOINT_NOT_SUPPLIED")

// EngineBinding is a normal boot composition, never an IPC/JSON grant. Its
// constructors make the actual handler from the same original engine resource;
// callers cannot substitute a handler, URL, callback client or independent DB.
type EngineBinding struct {
	self       *EngineBinding
	resources  Resources
	handler    http.Handler
	http       *payproduct.NativePayHTTP
	invoiceErr error
	endpoint   *bftEndpoint
}

// BindNative uses the existing native API constructor with that exact original
// Devnet. This does not open/recreate a ledger or transfer its lifecycle. Native
// API's accepted Transaction DTO and currently unsupported invoice fee/actions
// must not be projected into BFT PQActionView or an independent receipt.
func BindNative(original *chain.Devnet, cfg api.ServerConfig) (*EngineBinding, error) {
	if original == nil {
		return nil, ErrEngineEndpointNotSupplied
	}
	b := &EngineBinding{resources: Resources{Engine: NativeEngine, Native: original}, handler: api.NewServerWithConfig(original, cfg), invoiceErr: ErrNativeInvoiceTransportUnsupported}
	b.self = b
	return b, nil
}

func (b *EngineBinding) original() (Resources, *payproduct.NativePayHTTP, error) {
	if b == nil || b.self != b || b.handler == nil {
		return Resources{}, nil, ErrEngineEndpointNotSupplied
	}
	if b.endpoint != nil {
		b.endpoint.mu.Lock()
		first := b.endpoint.first
		b.endpoint.mu.Unlock()
		if first != nil {
			return Resources{}, nil, first
		}
	}
	return b.resources, b.http, nil
}

// OriginalHandler returns only the constructor-created same-engine handler.
// Mounting it never supplies Root or Source, and native invoice remains denied.
func (b *EngineBinding) OriginalHandler() (http.Handler, error) {
	if _, _, e := b.original(); e != nil {
		return nil, e
	}
	return b.handler, nil
}

type EngineStatusDATA struct {
	Engine                    Engine
	AccountResourceBound      bool
	InvoiceTransportSupported bool
	BFTProofSupported         bool
	Origin                    string
}

func (b *EngineBinding) StatusDATA() (EngineStatusDATA, error) {
	r, h, e := b.original()
	if e != nil {
		return EngineStatusDATA{}, e
	}
	origin := ""
	if h != nil {
		origin, e = h.OriginData()
		if e != nil {
			return EngineStatusDATA{}, e
		}
	}
	return EngineStatusDATA{Engine: r.Engine, AccountResourceBound: true, InvoiceTransportSupported: b.invoiceErr == nil && h != nil, BFTProofSupported: r.Engine == BFTEngine, Origin: origin}, nil
}
