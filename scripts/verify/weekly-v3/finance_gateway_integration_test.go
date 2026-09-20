//go:build weekly_v3_integration

package finance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Exercises the existing real Gateway HTTP client, not a fakeAI implementation.
// The remote model side is an explicitly synthetic loopback SSE responder.
// The model is not real; downstream HTTP job validation and persistence are.
func TestWeeklyV3GatewayHTTPClientConsumesFragmentedDraft(t *testing.T) {
	provider := &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_VALID"), APIKey: "public-local-gateway-fixture-not-a-secret"}
	name, model, available, err := provider.Status(context.Background())
	if err != nil || !available || name != "YNX AI Gateway" || !strings.Contains(model, "fixture-not-a-model") {
		t.Fatalf("real Gateway health contract: %s %s %v %v", name, model, available, err)
	}
	request := AIRequest{Kind: "draft_broker_order", Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", Permission: "draft-only; never execute", OutputLocale: "en", Context: map[string]any{"brokerIntent": map[string]string{"symbol": "ACME", "side": "buy", "qty": "2", "limitPrice": "125.34"}}}
	var text strings.Builder
	chunks := 0
	result, err := provider.Stream(context.Background(), request, func(delta string) { chunks++; text.WriteString(delta) })
	if err != nil {
		t.Fatal(err)
	}
	draft, ok := result["orderDraft"].(map[string]any)
	if !ok || draft["symbol"] != "ACME" || draft["qty"] != "2" || draft["limitPrice"] != "125.34" || result["draftOnly"] != true || chunks < 2 {
		t.Fatalf("fragmented public fixture draft not preserved: %+v chunks=%d", result, chunks)
	}
}

func TestWeeklyV3GatewayStructuredJobHTTPPersistenceAndCopy(t *testing.T) {
	for _, scenario := range []string{"VALID", "INVALID_SCHEMA", "RATIONAL_QTY", "EXPONENT_PRICE", "EXTRA_ROOT", "UNSTRUCTURED", "MALFORMED_SSE", "TRUNCATED", "UNAUTHORIZED", "RATE_LIMITED"} {
		t.Run(scenario, func(t *testing.T) {
			server, local, statePath, now := weeklyServer(t)
			explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/health":
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rpcHeight": 120, "indexedHeight": 120, "syncLagBlocks": 0, "nativeSymbol": "YNXT", "lastCheckedAt": now, "build": map[string]any{"commit": "synthetic-explorer-fixture", "release": "local-only"}})
				case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
					_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 420, "staked": 0, "nonce": 2, "resourceUsage": map[string]any{}, "lots": map[string]any{}}})
				case r.URL.Path == "/api/txs":
					_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []map[string]any{{"hash": "weekly-owned-record", "type": "transfer", "from": testAccount, "to": "ynx1recipient", "amount": 1, "fee": 0, "blockNumber": 9, "timestamp": now}}})
				default:
					_ = json.NewEncoder(w).Encode(map[string]any{})
				}
			}))
			t.Cleanup(explorer.Close)
			var err error
			server.service.Upstreams, err = NewUpstreams(explorer.URL, "", "", "https://support.invalid/disputes")
			if err != nil {
				t.Fatal(err)
			}
			server.service.AI = &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_" + scenario), APIKey: "public-local-gateway-fixture-not-a-secret"}
			if err := server.service.Store.Update(testAccount, "fixture.ai.consent", "", func(state *AccountState) error { state.Privacy.AllowAIActivityContext = true; return nil }); err != nil {
				t.Fatal(err)
			}
			portfolio := server.observedPortfolio(context.Background(), testAccount, nil)
			if len(portfolio.Activity) != 1 {
				t.Fatalf("synthetic owned activity not observed: %+v", portfolio)
			}
			body, _ := json.Marshal(map[string]any{"kind": "draft_broker_order", "recordIds": []string{portfolio.Activity[0].ID}, "contextClasses": []string{"owned_activity"}, "consent": true, "securitiesOrderIntent": map[string]string{"symbol": "ACME", "side": "buy", "qty": "2", "limitPrice": "125.34"}})
			r := httptest.NewRequest("POST", "/api/ai/jobs", strings.NewReader(string(body)))
			r.Header.Set("Origin", BrowserFinanceOrigin)
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set(productsessionv2.ProofHeader, "finance.ai.draft")
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, r)
			if scenario == "UNAUTHORIZED" {
				if w.Code != 503 {
					t.Fatalf("unauthorized Gateway returned %d %s", w.Code, w.Body.String())
				}
				return
			}
			if w.Code != 202 {
				t.Fatalf("AI start %d %s", w.Code, w.Body.String())
			}
			var job AIJob
			if err := json.Unmarshal(w.Body.Bytes(), &job); err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				r = httptest.NewRequest("GET", "/api/ai/jobs/"+job.ID, nil)
				r.Header.Set(productsessionv2.ProofHeader, "finance.ai.draft")
				w = httptest.NewRecorder()
				server.Handler().ServeHTTP(w, r)
				if w.Code != 200 {
					t.Fatalf("AI read %d %s", w.Code, w.Body.String())
				}
				if err := json.Unmarshal(w.Body.Bytes(), &job); err != nil {
					t.Fatal(err)
				}
				if job.Status != "running" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			want := "failed"
			if scenario == "VALID" {
				want = "ready"
			}
			if job.Status != want {
				t.Fatalf("%s job status=%s error=%s result=%+v", scenario, job.Status, job.Error, job.Result)
			}
			reopened, err := OpenStore(statePath)
			if err != nil {
				t.Fatal(err)
			}
			persisted := reopened.Account(testAccount).AIJobs
			if len(persisted) != 1 || persisted[0].ID != job.ID || persisted[0].Status != want {
				t.Fatalf("job lost on reopen: %+v", persisted)
			}
			if len(reopened.BrokerWorkspace(testAccount, now).Orders) != 0 {
				t.Fatal("AI generated an executable order")
			}
			if scenario != "VALID" {
				if len(job.Result) != 0 {
					t.Fatal("failed job exposed usable result")
				}
				return
			}
			result := weeklyBridge(t, map[string]any{"mode": "draft", "source": "ai", "base": local.URL, "body": weeklyInput(), "aiJob": persisted[0]})
			var form map[string]string
			if err := json.Unmarshal(result["form"], &form); err != nil {
				t.Fatal(err)
			}
			if form["symbol"] != "ACME" || form["qty"] != "2" || form["limitPrice"] != "125.34" || string(result["url"]) == "null" {
				t.Fatalf("persisted real AI job did not feed reviewed draft: %+v", result)
			}
			if len(server.service.Store.BrokerWorkspace(testAccount, now).Orders) != 1 {
				t.Fatal("explicit reviewed challenge was not created")
			}
		})
	}
}

func TestWeeklyV3GatewayHTTPClientErrorsStayExplicit(t *testing.T) {
	for _, scenario := range []string{"UNAUTHORIZED", "RATE_LIMITED", "MALFORMED_SSE"} {
		t.Run(scenario, func(t *testing.T) {
			provider := &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_" + scenario), APIKey: "public-local-gateway-fixture-not-a-secret"}
			result, err := provider.Stream(context.Background(), AIRequest{Kind: "draft_broker_order", Account: "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80", Permission: "draft-only; never execute", OutputLocale: "en"}, func(string) {})
			if err == nil || result != nil {
				t.Fatalf("Gateway failure became a usable draft: %+v %v", result, err)
			}
		})
	}
}
