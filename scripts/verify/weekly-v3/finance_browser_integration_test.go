//go:build weekly_v3_integration

package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Unlike the earlier VM copy test, this loads the unchanged real HTML and
// clicks Request review draft with Chromium's native HTMLFormElement/FormData.
// The server, Gateway HTTP client and durable job store are production code.
// Identity authority, Explorer and remote Gateway content are local fixtures.
func TestWeeklyV3RealDOMStartsSecuritiesDraftWithoutChainDependency(t *testing.T) {
	for _, scenario := range []string{"owned_activity", "empty_activity", "explorer_unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			server, local, statePath, now := weeklyServer(t)
			explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if scenario == "explorer_unavailable" {
					http.Error(w, "isolated unavailable Explorer fixture", 503)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/health":
					_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "rpcHeight": 120, "indexedHeight": 120, "syncLagBlocks": 0, "nativeSymbol": "YNXT", "lastCheckedAt": now, "build": map[string]any{"commit": "synthetic-browser-explorer", "release": "local-only"}})
				case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
					_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 0, "staked": 0, "nonce": 0, "resourceUsage": map[string]any{}, "lots": map[string]any{}}})
				case r.URL.Path == "/api/txs":
					transactions := []map[string]any{}
					if scenario == "owned_activity" {
						transactions = append(transactions, map[string]any{"hash": "weekly-browser-owned-record", "type": "transfer", "from": testAccount, "to": "ynx1recipient", "amount": 1, "fee": 0, "blockNumber": 9, "timestamp": now})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"transactions": transactions})
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
			server.service.AI = &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_VALID"), APIKey: "public-local-gateway-fixture-not-a-secret"}
			if err := server.service.Store.Update(testAccount, "fixture.browser.consent", "", func(state *AccountState) error {
				// Existing global AI privacy permission remains an explicit
				// prerequisite; empty activity must not bypass a user's opt-out.
				state.Privacy.AllowAIActivityContext = true
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			input, _ := json.Marshal(map[string]any{"base": local.URL, "selectOwnedActivity": scenario == "owned_activity"})
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", os.Getenv("WEEKLY_DOM_BRIDGE"))
			cmd.Stdin = bytes.NewReader(input)
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			raw, err := cmd.Output()
			if err != nil {
				t.Fatalf("real browser launch: %v %s", err, stderr.String())
			}
			var result struct {
				IntentTag      string            `json:"intentTag"`
				NativeFormData bool              `json:"nativeFormData"`
				ActivityCount  int               `json:"activityCount"`
				Copied         bool              `json:"copied"`
				Form           map[string]string `json:"form"`
				AssetQuery     string            `json:"assetQuery"`
				PageErrors     []string          `json:"pageErrors"`
				Blocked        []json.RawMessage `json:"blocked"`
				Requests       []struct {
					Path         string `json:"path"`
					Method       string `json:"method"`
					Status       int    `json:"status"`
					ProofScope   string `json:"proofScope"`
					Body         string `json:"body"`
					ResponseBody string `json:"responseBody"`
				} `json:"requests"`
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatalf("browser JSON: %v %s", err, raw)
			}
			if result.IntentTag != "FORM" || !result.NativeFormData || !result.Copied || len(result.PageErrors) != 0 || len(result.Blocked) != 0 {
				t.Fatalf("actual DOM start/copy failed (not a VM result): %s", raw)
			}
			if scenario != "owned_activity" && result.ActivityCount != 0 {
				t.Fatalf("chain-independent scenario fabricated activity: %s", raw)
			}
			if scenario == "owned_activity" && result.ActivityCount != 1 {
				t.Fatalf("owned activity fixture was not rendered: %s", raw)
			}
			posts := 0
			for _, request := range result.Requests {
				if request.Method == "GET" {
					continue
				}
				if request.Method != "POST" || request.Path != "/api/ai/jobs" || request.Status != 202 || request.ProofScope != "finance.ai.draft" {
					t.Fatalf("unexpected browser write/authority: %+v", request)
				}
				posts++
				var payload map[string]json.RawMessage
				if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
					t.Fatal(err)
				}
				if string(payload["consent"]) != "true" || string(payload["kind"]) != `"draft_broker_order"` {
					t.Fatalf("browser did not send explicit securities consent: %s", request.Body)
				}
			}
			if posts != 1 || result.Form["assetId"] != "" || result.Form["symbol"] != "" || result.Form["side"] != "buy" || result.Form["qty"] != "2" || result.Form["limitPrice"] != "125.34" || result.AssetQuery != "ACME" {
				t.Fatalf("draft copy bypassed exact provider selection or duplicated request: %s", raw)
			}
			reopened, err := OpenStore(statePath)
			if err != nil {
				t.Fatal(err)
			}
			jobs := reopened.Account(testAccount).AIJobs
			if len(jobs) != 1 || jobs[0].Kind != "draft_broker_order" || jobs[0].Status != "ready" || len(reopened.BrokerWorkspace(testAccount, now).Orders) != 0 {
				t.Fatalf("real browser job was not durable/draft-only: %+v", jobs)
			}
		})
	}
}

func TestWeeklyV3SecuritiesIntentDoesNotBypassAIPrivacyOptOut(t *testing.T) {
	server, _, statePath, _ := weeklyServer(t)
	server.service.AI = &HTTPAIProvider{URL: os.Getenv("WEEKLY_GATEWAY_VALID"), APIKey: "public-local-gateway-fixture-not-a-secret"}
	if err := server.service.Store.Update(testAccount, "fixture.ai.opt_out", "", func(state *AccountState) error { state.Privacy.AllowAIActivityContext = false; return nil }); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(statePath)
	request := httptest.NewRequest("POST", "/api/ai/jobs", strings.NewReader(`{"kind":"draft_broker_order","recordIds":[],"contextClasses":[],"consent":true,"securitiesOrderIntent":{"symbol":"ACME","side":"buy","qty":"2","limitPrice":"125.34"}}`))
	request.Header.Set("Origin", BrowserFinanceOrigin)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Product-Session-Proof-V2", "finance.ai.draft")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != 503 || !strings.Contains(response.Body.String(), "privacy settings") {
		t.Fatalf("AI opt-out was bypassed for securities intent: %d %s", response.Code, response.Body.String())
	}
	after, _ := os.ReadFile(statePath)
	if !bytes.Equal(before, after) || len(server.service.Store.Account(testAccount).AIJobs) != 0 {
		t.Fatal("disabled AI privacy still persisted a job")
	}
}
