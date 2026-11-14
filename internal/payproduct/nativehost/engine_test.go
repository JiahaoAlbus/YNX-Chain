//go:build pay_pq && pay_cloud && pay_auth_source && pay_securelink && securelink_openssl && cgo

package nativehost

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	paynativesource "github.com/JiahaoAlbus/YNX-Chain/internal/authnativesource"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestEngineNativeActualHandlerAndSourcePartial(t *testing.T) {
	original := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	bound, err := BindNative(original, api.ServerConfig{})
	if err != nil {
		t.Fatal(err)
	}
	status, err := bound.StatusDATA()
	if err != nil || status.Engine != NativeEngine || status.InvoiceTransportSupported || status.BFTProofSupported {
		t.Fatal("native was promoted into BFT invoice/proof transport", status, err)
	}
	handler, err := bound.OriginalHandler()
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 {
		t.Fatal("same original native API handler unavailable", w.Code)
	}
	accountSource, cause := paynativesource.NewOriginalNativePaySource(bound.resources)
	if accountSource == nil || cause == nil || !strings.Contains(cause.Error(), "COMMISSIONING_NOT_SUPPLIED") {
		t.Fatal("actual native account Source Root0 refusal was lost", cause)
	}
	accountSource.Retire()
	if err = accountSource.Close(); err != nil {
		t.Fatal(err)
	}
	h, err := OpenProductsWithEngine(context.Background(), productsNormalConfig(t), bound, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if h.native == nil || !h.native.CompositionRetained() || h.native.PartialRetained() || h.native.Ready() || h.NativeSourceStatus() == nil || !strings.Contains(h.NativeSourceStatus().Error(), "PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED") {
		t.Fatal("real normal native invoice capability refusal not consumed", h.NativeSourceStatus())
	}
	if bound.resources.Native != original || bound.resources.BFTApplication != nil || bound.resources.BFTNode != nil || h.engine != bound {
		t.Fatal("mixed or replaced actual native engine")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err = h.Join(ctx); err != nil {
		t.Fatal(err)
	}
	if err = h.Close(); err != nil {
		t.Fatal(err)
	}
	if err = bound.ShutdownEndpoint(ctx); err != nil {
		t.Fatal(err)
	}
	// Borrowed native engine remains the same live normal object after close.
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 {
		t.Fatal("product close closed borrowed Core engine")
	}
}

func TestEngineBFTMissingOriginalDeniesBeforeEndpoint(t *testing.T) {
	partial, err := BindBFT(nil, nil, BFTEndpointConfig{ListenAddress: "0.0.0.0:0"}, buildinfo.Info{})
	if partial == nil || !errors.Is(err, ErrEngineEndpointNotSupplied) || partial.endpoint.listener != nil {
		t.Fatal("missing original Node/App opened a listener", err)
	}
	if _, _, e := partial.original(); e == nil {
		t.Fatal("failed partial exposed engine")
	}
	if e := partial.ShutdownEndpoint(context.Background()); e != err {
		t.Fatal("partial cleanup lost original cause", e)
	}
}

func TestEngineBindingCloneCannotRetargetOriginal(t *testing.T) {
	bound, err := BindNative(chain.NewDevnet(chain.DefaultNetworkConfig("testnet")), api.ServerConfig{})
	if err != nil {
		t.Fatal(err)
	}
	copy := *bound
	if _, err = copy.OriginalHandler(); err == nil {
		t.Fatal("copied engine binding became another original")
	}
	if _, err = BindNative(nil, api.ServerConfig{}); err == nil {
		t.Fatal("missing native engine accepted")
	}
}
