//go:build pay_pq && pay_main_result_client

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// New normal Main result/cold recovery business delta only. The existing
// five-row Core/payment/refund proof evidence is reused, never rerun here.
func TestNativeMainResultLostCreateColdOriginalLookupNoRetry(t *testing.T) {
	node, driver := os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_MAIN_RESULT_DRIVER")
	if !filepath.IsAbs(node) || !filepath.IsAbs(driver) {
		t.Fatal("exact Node and owned result driver required")
	}
	f := newNativeServiceFixture(t)
	request := nativeIntentTestRequest(f)
	request.ProductID = "shop.order"
	request.StoreID = "store-original"
	source, reader := nativeIntentTestSource(t, f.service.parent, request, f.terms)
	server, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var creates, lookups, gets, money atomic.Int32
	endpointHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents":
			creates.Add(1)
		case r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents/lookup":
			lookups.Add(1)
		case r.Method == "GET":
			gets.Add(1)
		default:
			money.Add(1)
			w.WriteHeader(405)
			return
		}
		server.Handler().ServeHTTP(w, r)
	})
	endpoint := httptest.NewServer(endpointHandler)
	defer func() { endpoint.Close() }()
	file := filepath.Join(t.TempDir(), "PUBLIC-original-request.json")
	raw, _ := json.Marshal(request)
	if err = os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	type childResult struct {
		Result struct {
			OK              bool              `json:"ok"`
			RecoveryActions []json.RawMessage `json:"recoveryActions"`
			Intent          struct {
				IntentID string `json:"intentId"`
			} `json:"intent"`
		} `json:"result"`
	}
	run := func(scenario string, recovery json.RawMessage) childResult {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, node, driver)
		command.Env = append(os.Environ(), "PAY_MAIN_RESULT_ORIGIN="+endpoint.URL, "PAY_MAIN_RESULT_REQUEST="+file, "PAY_MAIN_RESULT_SCENARIO="+scenario, "PAY_MAIN_RESULT_RECOVERY="+string(recovery))
		out, e := command.CombinedOutput()
		if e != nil {
			t.Fatalf("new normal Main result %s: %v %s", scenario, e, out)
		}
		var result childResult
		if e = json.Unmarshal(bytes.TrimSpace(out), &result); e != nil {
			t.Fatal(e, string(out))
		}
		t.Logf("ACTUAL_NORMAL_MAIN_RESULT %s", out)
		return result
	}
	lost := run("create-loss", nil)
	if lost.Result.OK || len(lost.Result.RecoveryActions) != 1 || creates.Load() != 1 || f.writes != 0 {
		t.Fatal("lost response did not retain original without money")
	}
	endpoint.Close()
	before, err := os.ReadFile(f.service.parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	cold, err := OpenStore(f.service.parent.store.path, f.service.parent.key)
	if err != nil {
		t.Fatal(err)
	}
	f.service.parent.store = cold
	endpoint = httptest.NewServer(endpointHandler)
	restored := run("cold-lookup", lost.Result.RecoveryActions[0])
	endpoint.Close()
	if !restored.Result.OK || restored.Result.Intent.IntentID != nativeIntentSlot(request) {
		t.Fatal("new process did not query the original durable intent")
	}
	after, err := os.ReadFile(f.service.parent.store.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("cold result lookup changed original Pay disk", err)
	}
	reader.denied = true
	endpoint = httptest.NewServer(endpointHandler)
	denied := run("denied", lost.Result.RecoveryActions[0])
	endpoint.Close()
	if denied.Result.OK || creates.Load() != 1 || lookups.Load() != 2 || gets.Load() != 1 || money.Load() != 0 || f.writes != 0 {
		t.Fatal("normal result/refusal retried create, sent money or skipped exact original read")
	}
	after, err = os.ReadFile(f.service.parent.store.path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("refusal changed original disk", err)
	}
	t.Logf("ACTUAL_NORMAL_MAIN_RESULT_COLD complete=true createPOST=%d queryOnlyLookupPOST=%d GET=%d moneyPOST=%d CorePOST=%d originalDiskUnchanged=true originalMainWrapper=true SourceAdmission=false", creates.Load(), lookups.Load(), gets.Load(), money.Load(), f.writes)
}
