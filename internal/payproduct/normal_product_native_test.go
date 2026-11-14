//go:build pay_pq && pay_securelink && securelink_openssl && cgo

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func normalProductFixture(t *testing.T) (Config, NormalCentralPayEndpoint) {
	t.Helper()
	f := newTLSFixture(t)
	edge := securelink.Edge{ID: "pay-normal-parent", LocalSAN: "pay.ynx.test", PeerSAN: "adapter.ynx.test", Epoch: 1, Roots: []securelink.Root{{Fingerprint: f.root, Until: time.Now().Add(time.Hour)}}, Routes: []securelink.Route{{Method: "GET", Path: "/health", Risk: "read"}}}
	link := productionLinkConfig{TLS: f.config(false), Policy: securelink.Policy{Edges: []securelink.Edge{edge}}, EdgeID: edge.ID, Address: "127.0.0.1:1", Origin: "https://adapter.ynx.test", TimeoutSeconds: 1, MaxConnections: 1}
	file := filepath.Join(t.TempDir(), "original-link.json")
	raw, err := json.Marshal(link)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{'P'}, 32)
	return Config{StorePath: filepath.Join(t.TempDir(), "original-product.json"), IntegrityKey: key, GatewayKey: key, BootstrapKey: strings.Repeat("P", 32), PublicBaseURL: "https://pay.ynx.test"}, NormalCentralPayEndpoint{Origin: link.Origin, APIKey: "PUBLIC-normal-parent-no-network", LINKConfigPath: file}
}

func TestNormalProductOriginalConstructorStoreAndTransportLifecycle(t *testing.T) {
	cfg, central := normalProductFixture(t)
	owner, err := OpenNormalProduct(cfg, central)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Close() })
	parent := owner.Service()
	if parent == nil || owner.Service() != parent {
		t.Fatal("normal factory did not retain the same original service")
	}
	store, err := parent.BorrowOriginalNativePayStore()
	if err != nil || store != parent.store {
		t.Fatal("normal source would receive another Store", err)
	}
	api, ok := parent.pay.(*HTTPPayAPI)
	if !ok || api.Client.Transport == http.DefaultTransport {
		t.Fatal("normal production LINK constructor was bypassed")
	}
	if err = owner.Close(); err != nil || owner.Service() != nil {
		t.Fatal("normal transport did not close", err)
	}
	// The actual retained original LINK transport refuses after owned close.
	if err = api.Health(context.Background()); err == nil {
		t.Fatal("closed original transport still admitted a request")
	}
	if err = owner.Close(); err != nil || owner.Err() != nil {
		t.Fatal("normal idempotent cleanup changed the outcome", err)
	}
}

func TestNormalProductPartialAndReplacementRefusal(t *testing.T) {
	cfg, central := normalProductFixture(t)
	cfg.IntegrityKey = nil
	partial, cause := OpenNormalProduct(cfg, central)
	if partial == nil || cause == nil || partial.transport == nil || partial.Service() != nil {
		t.Fatal("original transport partial lost after actual product refusal", cause)
	}
	if err := partial.Close(); err != nil || partial.Err() != cause {
		t.Fatal("normal rollback lost original construction cause", err)
	}
	cfg.PayAPI = &HTTPPayAPI{}
	refused, err := OpenNormalProduct(cfg, NormalCentralPayEndpoint{LINKConfigPath: "/not-supplied"})
	if err == nil || !strings.Contains(err.Error(), "replacement PayAPI") || refused.transport != nil || refused.Service() != nil {
		t.Fatal("replacement callback/client reached the normal parent constructor", err)
	}
	if _, err := os.Stat(cfg.StorePath); !os.IsNotExist(err) {
		t.Fatal("refused parent created or changed product state", err)
	}
}
