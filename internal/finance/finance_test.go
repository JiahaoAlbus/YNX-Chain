package finance

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testAccount = "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"

type fakeAI struct{ result map[string]any }

func (f fakeAI) Status(context.Context) (string, string, bool, error) {
	return "test-provider", "test-model", true, nil
}
func (f fakeAI) Estimate(context.Context, AIRequest) (string, error) { return "2 AI credits", nil }
func (f fakeAI) Stream(_ context.Context, _ AIRequest, emit func(string)) (map[string]any, error) {
	emit("Draft ready")
	return f.result, nil
}

func TestWalletAssertionRejectsReplayAndTamper(t *testing.T) {
	store, _ := OpenStore("")
	auth, _ := NewAuthenticator(strings.Repeat("s", 32), "finance-web", store)
	signed := testAssertion(t, strings.Repeat("s", 32), "nonce-1234567890123456")
	if _, err := auth.Complete(signed); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Complete(signed); err == nil || !strings.Contains(err.Error(), "already been used") {
		t.Fatalf("expected replay rejection, got %v", err)
	}
	signed = testAssertion(t, strings.Repeat("s", 32), "nonce-2234567890123456")
	signed.Assertion.Account = "ynx1tampered"
	if _, err := auth.Complete(signed); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("expected tamper rejection, got %v", err)
	}
}

func TestOverviewPersistenceExportAndAIReview(t *testing.T) {
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/accounts/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"account": map[string]any{"address": testAccount, "balance": 420, "staked": 20, "nonce": 2, "resourceUsage": map[string]any{}, "lots": map[string]any{}}})
		case r.URL.Path == "/api/txs":
			_ = json.NewEncoder(w).Encode(map[string]any{"transactions": []map[string]any{{"hash": "tx-owned", "type": "transfer", "from": testAccount, "to": "ynx1recipient", "amount": 40, "fee": 1, "blockNumber": 9, "timestamp": time.Now().UTC().Add(-time.Hour)}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer explorer.Close()
	pay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-YNX-Pay-Key") != "pay-secret" {
			http.Error(w, "unauthorized", 401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"events": []map[string]any{{"id": "receipt-owned", "status": "settled", "payer": testAccount, "merchant": "ynx1merchant", "amountYnxt": 12, "transactionHash": "tx-owned", "createdAt": time.Now().UTC().Format(time.RFC3339)}, {"id": "receipt-other", "payer": "ynx1other", "amountYnxt": 99}}})
	}))
	defer pay.Close()
	statePath := filepath.Join(t.TempDir(), "finance.json")
	store, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	upstreams, _ := NewUpstreams(explorer.URL, pay.URL, "pay-secret", "https://support.example/disputes")
	service := &Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	auth, _ := NewAuthenticator(strings.Repeat("s", 32), "finance-web", store)
	server, err := NewServer(service, auth, ServerConfig{WalletCallback: "ynxfinance://auth/callback", WalletClientID: "finance-web", AllowedOrigins: []string{"https://finance.example"}})
	if err != nil {
		t.Fatal(err)
	}
	session, err := auth.Complete(testAssertion(t, strings.Repeat("s", 32), "nonce-3234567890123456"))
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()

	var overview map[string]any
	requestJSON(t, ts.URL+"/api/overview", http.MethodGet, nil, session.Token, "", 200, &overview)
	p := overview["portfolio"].(map[string]any)
	if p["balanceYnxt"].(float64) != 420 || len(p["activity"].([]any)) != 1 || len(p["payReceipts"].([]any)) != 1 || p["readOnly"] != true {
		t.Fatalf("unexpected real-data overview: %#v", p)
	}
	var category Category
	requestJSON(t, ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "Essentials", "color": "#002FA7", "idempotencyKey": "category-test-key-0001"}, session.Token, "https://finance.example", 201, &category)
	var replay Category
	requestJSON(t, ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "Essentials", "color": "#002FA7", "idempotencyKey": "category-test-key-0001"}, session.Token, "https://finance.example", 201, &replay)
	if replay.ID != category.ID {
		t.Fatal("idempotent category replay created a new object")
	}
	requestJSON(t, ts.URL+"/api/budgets", http.MethodPost, map[string]any{"name": "Monthly essentials", "categoryId": category.ID, "limitYnxt": 100, "period": "monthly", "startsAt": time.Now().UTC(), "idempotencyKey": "budget-test-key-000001"}, session.Token, "https://finance.example", 201, &map[string]any{})
	requestJSON(t, ts.URL+"/api/activity/tx-owned/category", http.MethodPut, map[string]any{"categoryId": category.ID, "idempotencyKey": "classification-key-0001"}, session.Token, "https://finance.example", 200, &map[string]any{})
	requestJSON(t, ts.URL+"/api/activity/tx-owned/category", http.MethodPut, map[string]any{"categoryId": category.ID, "idempotencyKey": "classification-key-0001"}, session.Token, "https://finance.example", 200, &map[string]any{})
	requestJSON(t, ts.URL+"/api/privacy", http.MethodPut, map[string]any{"includePayInStatements": true, "allowAiActivityContext": true, "alertsEnabled": true}, session.Token, "https://finance.example", 200, &map[string]any{})
	var job AIJob
	requestJSON(t, ts.URL+"/api/ai/jobs", http.MethodPost, map[string]any{"kind": "detect_anomalies", "recordIds": []string{"tx-owned"}, "contextClasses": []string{"owned_activity"}, "consent": true, "outputLocale": "ar"}, session.Token, "https://finance.example", 202, &job)
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		requestJSON(t, ts.URL+"/api/ai/jobs/"+job.ID, http.MethodGet, nil, session.Token, "", 200, &job)
		if job.Status == "ready" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if job.Status != "ready" || job.Provider != "test-provider" || job.Progress == "" || job.OutputLocale != "ar" {
		t.Fatalf("AI draft not reviewable: %+v", job)
	}
	requestJSON(t, ts.URL+"/api/ai/jobs/"+job.ID+"/decision", http.MethodPost, map[string]any{"decision": "reject"}, session.Token, "https://finance.example", 200, &job)
	if job.Status != "rejected" {
		t.Fatalf("AI rejection not audited: %+v", job)
	}
	resp, _ := authorizedRequest(ts.URL+"/api/export?format=csv", http.MethodGet, nil, session.Token, "")
	if resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Content-Type"), "text/csv") {
		t.Fatalf("CSV export failed: %d", resp.StatusCode)
	}
	resp.Body.Close()
	reopened, err := OpenStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(reopened.Account(testAccount).Budgets) != 1 || len(reopened.Account(testAccount).AIJobs) != 1 {
		t.Fatal("account state did not survive restart")
	}
}

func TestUnavailableSourcesStayUnavailableAndOriginFailsClosed(t *testing.T) {
	explorer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "offline", 503) }))
	defer explorer.Close()
	store, _ := OpenStore("")
	up, _ := NewUpstreams(explorer.URL, "", "", "")
	service := &Service{Store: store, Upstreams: up, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.example/help", PrivacyURL: "https://support.example/privacy", DisputeURL: "https://support.example/disputes"}}
	auth, _ := NewAuthenticator(strings.Repeat("s", 32), "finance-web", store)
	server, _ := NewServer(service, auth, ServerConfig{WalletCallback: "ynxfinance://auth/callback", WalletClientID: "finance-web", AllowedOrigins: []string{"https://finance.example"}})
	session, _ := auth.Complete(testAssertion(t, strings.Repeat("s", 32), "nonce-4234567890123456"))
	ts := httptest.NewServer(server.Handler())
	defer ts.Close()
	var p Portfolio
	requestJSON(t, ts.URL+"/api/portfolio", http.MethodGet, nil, session.Token, "", 200, &p)
	if p.ExplorerStatus.Available || p.BalanceYNXT != 0 || len(p.Activity) != 0 {
		t.Fatalf("unavailable source became fake state: %+v", p)
	}
	resp, _ := authorizedRequest(ts.URL+"/api/categories", http.MethodPost, map[string]any{"name": "x", "color": "#002FA7", "idempotencyKey": "category-evil-key-0001"}, session.Token, "https://evil.example")
	if resp.StatusCode != 403 {
		t.Fatalf("cross-origin mutation returned %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAIBudgetDraftOnlyAppliesAfterReview(t *testing.T) {
	store, _ := OpenStore("")
	categoryService := &Service{Store: store}
	category, err := categoryService.AddCategory(testAccount, "Operations", "#002FA7", "ai-category-key-000001")
	if err != nil {
		t.Fatal(err)
	}
	if err := categoryService.SetPrivacy(testAccount, Privacy{AllowAIActivityContext: true}); err != nil {
		t.Fatal(err)
	}
	service := &Service{Store: store, AI: fakeAI{result: map[string]any{
		"budgets": []any{map[string]any{"name": "AI draft", "categoryId": category.ID, "limitYnxt": float64(75), "period": "monthly"}},
	}}}
	portfolio := Portfolio{Activity: []Activity{{ID: "owned-record", Source: "indexed"}}, ExplorerStatus: SourceStatus{Available: true}}
	job, err := service.StartAI(context.Background(), testAccount, "draft_budget", []string{"owned-record"}, []string{"owned_activity"}, true, portfolio)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, _ = service.aiJob(testAccount, job.ID)
		if job.Status == "ready" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if len(store.Account(testAccount).Budgets) != 0 {
		t.Fatal("AI budget executed before review")
	}
	if err := service.DecideAI(testAccount, job.ID, "apply"); err != nil {
		t.Fatal(err)
	}
	budgets := store.Account(testAccount).Budgets
	if len(budgets) != 1 || budgets[0].LimitYNXT != 75 || budgets[0].Name != "AI draft" {
		t.Fatalf("reviewed AI budget not applied: %+v", budgets)
	}
	if err := service.DeleteAI(testAccount, job.ID); err != nil {
		t.Fatal(err)
	}
	if len(store.Account(testAccount).AIJobs) != 0 {
		t.Fatal("AI draft data was not deleted")
	}
	audit := store.Audit(testAccount)
	if len(audit) == 0 || audit[len(audit)-1].Action != "ai.deleted" {
		t.Fatal("minimal AI deletion audit event is missing")
	}
}

func testAssertion(t *testing.T, secret, nonce string) SignedWalletAssertion {
	t.Helper()
	now := time.Now().UTC()
	a := WalletAssertion{Version: "1", Nonce: nonce, ChainID: ChainID, Product: Product, ClientID: "finance-web", DeviceID: "device-12345678", Account: testAccount, Scopes: []string{"finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"}, IssuedAt: now, ExpiresAt: now.Add(4 * time.Minute)}
	raw, _ := json.Marshal(a)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	return SignedWalletAssertion{Assertion: a, Signature: base64.RawURLEncoding.EncodeToString(mac.Sum(nil))}
}
func requestJSON(t *testing.T, endpoint, method string, body any, token, origin string, want int, out any) {
	t.Helper()
	resp, err := authorizedRequest(endpoint, method, body, token, origin)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != want {
		var e map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&e)
		t.Fatalf("%s %s returned %d: %#v", method, endpoint, resp.StatusCode, e)
	}
	if out != nil && resp.StatusCode != 204 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
func authorizedRequest(endpoint, method string, body any, token, origin string) (*http.Response, error) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, _ := http.NewRequest(method, endpoint, bytes.NewReader(raw))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return http.DefaultClient.Do(req)
}
