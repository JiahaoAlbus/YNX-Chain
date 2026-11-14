//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"bytes"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	paynativesource "github.com/JiahaoAlbus/YNX-Chain/internal/authnativesource"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

// Actual committed-port invoice factory explicitly rejects native capability;
// its account Source's Root0 path is a distinct direct original factory test.
func TestNormalNativeInvoiceFactoryRetainsCompositionAndRefusesCapability(t *testing.T) {
	r, err := New(nil, Resources{Engine: NativeEngine, Native: chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))}, nil, buildinfo.Info{}, nil)
	if err == nil || !strings.Contains(err.Error(), "PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED") {
		t.Fatal("native invoice capability was not refused", err)
	}
	if r == nil || !r.CompositionRetained() || r.PartialRetained() || r.Ready() || r.Handler() != nil || r.Err() != err {
		t.Fatal("actual Source partial or first cause was lost")
	}
	r.Retire()
	if e := r.Close(); e != nil {
		t.Fatal("actual empty partial cleanup failed", e)
	}
	if r.Err() != err || r.Ready() {
		t.Fatal("cleanup changed Source refusal into readiness")
	}
}

// Use the actual supplier's Root0 partial, without admitting a Source or
// installing requests. A construction error and completed physical cleanup
// are distinct facts; neither retirement nor an empty handler proves Close.
func TestNormalRuntimeOriginalSourceCloseFactPreservesConstructionCause(t *testing.T) {
	actual := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	source, cause := paynativesource.NewOriginalNativePaySource(Resources{Engine: NativeEngine, Native: actual})
	if source == nil || cause == nil {
		t.Fatal("original Source refusal partial required", cause)
	}
	r := &Runtime{composition: &paynativesource.OriginalPrivateNativePayComposition{Source: source}, first: cause}
	if r.Closed() {
		t.Fatal("retained original Source declared closed before cleanup")
	}
	r.Retire()
	if r.Closed() {
		t.Fatal("retirement counted as physical Source close")
	}
	if err := r.Close(); err != nil || !r.Closed() || r.Err() != cause || r.Ready() {
		t.Fatal("original Source cleanup erased cause or retained debt", err)
	}
	if err := r.Close(); err != nil || !r.Closed() || r.Err() != cause {
		t.Fatal("repeated cleanup changed original outcome", err)
	}
	if !(*Runtime)(nil).Closed() {
		t.Fatal("nil runtime acquired a child")
	}
}

type noNetwork struct{}

func (noNetwork) RoundTrip(*http.Request) (*http.Response, error) {
	panic("normal empty-Root constructor must not make HTTP calls")
}
func TestNormalHostUsesSameOriginalStoreAndRejectsLookalike(t *testing.T) {
	api, err := payproduct.NewHTTPPayAPI("http://127.0.0.1:1", "PUBLIC-no-network")
	if err != nil {
		t.Fatal(err)
	}
	api.Client = &http.Client{Transport: noNetwork{}}
	key := bytes.Repeat([]byte{'P'}, 32)
	parent, err := payproduct.New(payproduct.Config{StorePath: filepath.Join(t.TempDir(), "original.json"), IntegrityKey: key, GatewayKey: key, BootstrapKey: strings.Repeat("P", 32), PublicBaseURL: "http://127.0.0.1", PayAPI: api})
	if err != nil {
		t.Fatal(err)
	}
	store, err := parent.BorrowOriginalNativePayStore()
	if err != nil {
		t.Fatal(err)
	}
	other, err := payproduct.OpenStore(filepath.Join(t.TempDir(), "lookalike.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	original := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	r, err := New(parent, Resources{Engine: NativeEngine, Native: original, PayStore: other}, nil, buildinfo.Info{}, nil)
	if err == nil || err.Error() != "PAY_ORIGINAL_STORE_IDENTITY_MISMATCH" || r.Ready() {
		t.Fatal("another Store substituted for original", err)
	}
	r, err = New(parent, Resources{Engine: NativeEngine, Native: original, PayStore: store}, nil, buildinfo.Info{}, nil)
	if err == nil || !strings.Contains(err.Error(), "PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED") || !r.CompositionRetained() || r.Ready() {
		t.Fatal("normal same-Store factory lost real capability refusal", err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
}
