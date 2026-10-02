package finance

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Real HTTP/business store, with an isolated authorization decision fixture.
// This does not stand in for installed Wallet approval or public acceptance.
func TestOwnedBudgetCommittedResponseLossExplicitRetryAndRestart(t *testing.T) {
	other, _ := accountaddress.Encode(strings.Repeat("2", 40))
	authority := &financeDecisionFixture{account: other, used: map[string]bool{}}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "isolated upstream unavailable", 503) }))
	defer upstream.Close()
	upstreams, err := NewUpstreams(upstream.URL, "", "", "https://support.invalid/disputes")
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(t.TempDir(), "finance.json")
	open := func() *Server {
		store, err := OpenStore(statePath)
		if err != nil {
			t.Fatal(err)
		}
		server, err := NewServer(&Service{Store: store, Upstreams: upstreams, AI: fakeAI{}, Support: SupportLinks{HelpURL: "https://support.invalid/help", PrivacyURL: "https://support.invalid/privacy", DisputeURL: "https://support.invalid/disputes"}}, &Authenticator{v2: authority, privateAuthority: allowFinanceAuthority}, ServerConfig{AllowedOrigins: []string{BrowserFinanceOrigin}, CursorSigningKey: testCursorKey, OperationsKey: testOperationsKey})
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	server := open()
	var drop atomic.Bool
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/api/budgets" && drop.Swap(false) {
			committed := httptest.NewRecorder()
			server.Handler().ServeHTTP(committed, r)
			if committed.Code != http.StatusCreated {
				t.Errorf("commit status %d", committed.Code)
			}
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = connection.Close() // Outcome is unknown to the caller, not rolled back.
			return
		}
		server.Handler().ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	client := &http.Client{Timeout: 3 * time.Second}
	request := func(method, path, proof string, body []byte) (*http.Response, error) {
		r, err := http.NewRequest(method, endpoint.URL+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Origin", BrowserFinanceOrigin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set(productsessionv2.ProofHeader, proof)
		return client.Do(r)
	}
	response, err := request("POST", "/api/categories", "A-category", []byte(`{"name":"Owned category","color":"#002FA7","idempotencyKey":"category-response-loss-001"}`))
	if err != nil {
		t.Fatal(err)
	}
	var category Category
	err = json.NewDecoder(response.Body).Decode(&category)
	response.Body.Close()
	if err != nil || response.StatusCode != 201 {
		t.Fatal("category setup failed")
	}
	body, _ := json.Marshal(map[string]any{"name": "Saved once", "categoryId": category.ID, "limitYnxt": 17, "period": "monthly", "startsAt": time.Now().UTC(), "idempotencyKey": "budget-response-loss-0001"})
	drop.Store(true)
	if response, err = request("POST", "/api/budgets", "A-budget-first", body); err == nil {
		response.Body.Close()
		t.Fatal("lost response unexpectedly observed")
	}
	response, err = request("POST", "/api/budgets", "A-budget-explicit-retry", body)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal("explicit retry rejected")
	}
	response, err = request("PUT", "/api/privacy", "A-privacy-save", []byte(`{"includePayInStatements":false,"allowAiActivityContext":true,"alertsEnabled":false}`))
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("owned privacy save failed")
	}
	server = open()
	for _, proof := range []string{"A-reopened", "B-independent"} {
		response, err = request("GET", "/api/profile", proof, nil)
		if err != nil {
			t.Fatal(err)
		}
		var profile AccountState
		err = json.NewDecoder(response.Body).Decode(&profile)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 {
			t.Fatal("profile read failed")
		}
		if proof == "A-reopened" && (len(profile.Budgets) != 1 || profile.Budgets[0].Name != "Saved once" || profile.Budgets[0].LimitYNXT != 17) {
			t.Fatal("retry duplicated or lost owned budget")
		}
		if proof == "A-reopened" && (!profile.Privacy.AllowAIActivityContext || profile.Privacy.IncludePayInStatements || profile.Privacy.AlertsEnabled) {
			t.Fatal("privacy save lost after reopen")
		}
		if proof == "B-independent" && profile.Privacy.AllowAIActivityContext {
			t.Fatal("private preference leaked to another account")
		}
		if proof == "B-independent" && len(profile.Budgets) != 0 {
			t.Fatal("budget leaked to another account")
		}
	}
}
