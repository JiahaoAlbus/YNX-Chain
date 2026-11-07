//go:build commerce_v2

package main

import (
	"context"
	"github.com/JiahaoAlbus/YNX-Chain/internal/commerce"
	"net/http"
)

// Real source-bound bootstrap must supply these original request-entry binders
// and custody guard. They are intentionally absent, not minted from ENV/cookie.
var originalShopRuntimeInputs struct {
	current       commerce.ShopRuntimeCurrent
	buyer, seller commerce.CommerceBrowserActorBinder
	transport     http.RoundTripper
	nativeFiles   *commerce.OriginalNativeBuyerFilesPair
	// Borrowed qualified Pay caller supplied by the original hosting owner.
	// Neither ENV nor a request can create/select its protected transport.
	nativePay         *commerce.NativeShopPayClient
	nativeInvoiceDATA commerce.OriginalShopNativeInvoiceDATAReader
}

type preparedOriginalShopRuntime struct {
	prepared          *commerce.PreparedOriginalShop
	native            *commerce.PreparedOriginalNativeBuyers
	nativePay         *commerce.NativeShopPayClient
	nativeInvoiceDATA commerce.OriginalShopNativeInvoiceDATAReader
}

func prepareOriginalShopRuntime(ctx context.Context, f originalShopFiles) (originalShopRuntime, error) {
	if ctx == nil {
		return nil, commerce.ErrOriginalShopCompositionUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.empty() {
		return closedOriginalShopRuntime{}, nil
	}
	inputs := originalShopRuntimeInputs
	p, err := commerce.LoadOriginalShopProfile(ctx, commerce.OriginalShopFiles{BackendKeyID: f.keyID, BackendKeyFile: f.keyFile, BrowserSealFile: f.sealFile}, inputs.current, inputs.buyer, inputs.seller, inputs.transport)
	if err != nil {
		return nil, err
	}
	var native *commerce.PreparedOriginalNativeBuyers
	if inputs.nativeFiles != nil {
		files := *inputs.nativeFiles
		native, err = commerce.LoadOriginalNativeBuyers(ctx, files)
		if err != nil {
			return nil, err
		}
	}
	return preparedOriginalShopRuntime{prepared: p, native: native, nativePay: inputs.nativePay, nativeInvoiceDATA: inputs.nativeInvoiceDATA}, nil
}
func (p preparedOriginalShopRuntime) servers(ctx context.Context, store *commerce.Store, cfg commerce.ServerConfig) (http.Handler, http.Handler, http.Handler, *commerce.Server, *commerce.Server, error) {
	cfg.NativePay = p.nativePay
	cfg.NativeInvoiceDATA = p.nativeInvoiceDATA
	if cfg.NativeInvoiceDATA == nil {
		cfg.NativeInvoiceDATA = store
	} // same original Store, explicit frozen native price DATA only
	buyer, seller, err := p.prepared.OpenOriginal(ctx, func() (*commerce.Store, error) { return store, nil }, cfg)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	if p.native != nil {
		if err := p.native.AttachOriginalBuyer(ctx, buyer, cfg); err != nil {
			return nil, nil, nil, nil, nil, err
		}
	}
	return p.prepared.GuardedOriginalHandler(buyer.Handler()), p.prepared.GuardedOriginalHandler(seller.Handler()), p.prepared.GuardedOriginalHandler(buyer.Handler()), buyer, seller, nil
}
