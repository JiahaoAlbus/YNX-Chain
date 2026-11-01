//go:build pay_pq && pay_product_intent_client

package payproduct

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

// New actual consumer combination only: original Go private factory/Store and
// current Node product client. PUBLIC Source fixture, no real commissioning.
func TestNativeIntentClientLostCreateColdOriginalLookupAndRefusal(t *testing.T) {
	node, driver := os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_PRODUCT_INTENT_CLIENT_DRIVER")
	if !filepath.IsAbs(node) || !filepath.IsAbs(driver) {
		t.Fatal("exact owned client driver and Node required")
	}
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	server, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(server.Handler())
	t.Cleanup(func() { endpoint.Close() })
	file := filepath.Join(t.TempDir(), "PUBLIC-original-request.json")
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	run := func(scenario string) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, node, driver)
		command.Env = append(os.Environ(), "PAY_PRODUCT_INTENT_ORIGIN="+endpoint.URL, "PAY_PRODUCT_INTENT_REQUEST="+file, "PAY_PRODUCT_INTENT_SCENARIO="+scenario)
		out, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("current actual consumer %s: %v %s", scenario, err, out)
		}
		t.Logf("%s %s", scenario, out)
	}
	run("create-loss")
	endpoint.Close() // join actual original HTTP handlers before cold reopen
	if f.writes != 0 {
		t.Fatal("product creation dispatched a signed Core action")
	}
	// Original server Store is reopened only after the first client exits.
	cold, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = cold
	endpoint = httptest.NewServer(server.Handler())
	run("cold-lookup")
	endpoint.Close()
	reader.denied = true
	endpoint = httptest.NewServer(server.Handler())
	run("denied")
	endpoint.Close()
	if f.writes != 0 {
		t.Fatal("lookup/refusal submitted a Core action")
	}
}
