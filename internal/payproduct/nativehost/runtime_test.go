//go:build pay_pq && pay_cloud && pay_auth_source

package nativehost

import (
	"bytes"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
)

// Actual frozen normal Auth factory, no PUBLIC assembly seam or fake handler.
func TestNormalOriginalAuthFactoryRetainsPartialAndRefusesEmptyRoot(t *testing.T) {
	r, err := New(nil, Resources{}, nil, buildinfo.Info{}, nil)
	if err == nil || !strings.Contains(err.Error(), "PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED") {
		t.Fatal("missing actual commissioning was not refused", err)
	}
	if r == nil || !r.PartialRetained() || r.Ready() || r.Handler() != nil || r.Err() != err {
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
	r, err := New(parent, Resources{PayStore: other}, nil, buildinfo.Info{}, nil)
	if err == nil || err.Error() != "PAY_ORIGINAL_STORE_IDENTITY_MISMATCH" || r.Ready() {
		t.Fatal("another Store substituted for original", err)
	}
	r, err = New(parent, Resources{PayStore: store}, nil, buildinfo.Info{}, nil)
	if err == nil || !strings.Contains(err.Error(), "PAY_ORIGINAL_BUSINESS_SOURCE_COMMISSIONING_NOT_SUPPLIED") || !r.PartialRetained() || r.Ready() {
		t.Fatal("normal same-Store factory lost real missing-Root refusal", err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
}
