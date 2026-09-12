package aigateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBYOKRoutingKeepsHostedAndUserCredentialsSeparate(t *testing.T) {
	type received struct{ path, authorization, body string }
	calls := []received{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = io.WriteString(w, `{"chainId":6423,"height":1,"network":"test","nativeCurrencySymbol":"YNXT"}`)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		calls = append(calls, received{r.URL.Path, r.Header.Get("Authorization"), string(raw)})
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"provider answer"}}]}`)
	}))
	defer provider.Close()
	byokAccess := strings.Repeat("b", 32)
	audit := filepath.Join(t.TempDir(), "audit.jsonl")
	service, err := New(Config{ChainURL: provider.URL, ProviderURL: provider.URL + "/hosted", ProviderAPIKey: "hosted-test-key", Model: "hosted-model", AccessAPIKey: "product-access", UpstreamKey: "upstream-test", AuditLog: audit, BYOKAccessAPIKey: byokAccess, BYOKProviders: map[string]BYOKProvider{"example": {URL: provider.URL + "/user", Models: []string{"user-model"}}}})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewServer(service).Handler()
	send := func(path, key string, selection *ProviderSelection) *httptest.ResponseRecorder {
		body := map[string]any{"session": "conversation-1", "prompt": "Explain the test network", "outputLanguage": "en"}
		if selection != nil {
			body["providerSelection"] = selection
		}
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-YNX-AI-Key", "product-access")
		if key != "" {
			req.Header.Set("X-YNX-AI-BYOK-Key", key)
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		return recorder
	}
	selection := &ProviderSelection{Provider: "example", Model: "user-model", APIKey: "user-test-secret"}
	if got := send("/ai/byok/stream", "", selection); got.Code != http.StatusUnauthorized {
		t.Fatalf("BYOK without product key: %d", got.Code)
	}
	if got := send("/ai/stream", byokAccess, selection); got.Code != http.StatusBadRequest {
		t.Fatalf("legacy override accepted: %d", got.Code)
	}
	if len(calls) != 0 {
		t.Fatal("denied requests reached provider")
	}
	if got := send("/ai/byok/stream", byokAccess, selection); got.Code != http.StatusOK {
		t.Fatalf("BYOK failed: %d %s", got.Code, got.Body.String())
	}
	if got := send("/ai/stream", "", nil); got.Code != http.StatusOK {
		t.Fatalf("hosted route regressed: %d %s", got.Code, got.Body.String())
	}
	if len(calls) != 2 || calls[0].path != "/user/chat/completions" || calls[0].authorization != "Bearer user-test-secret" || calls[1].path != "/hosted/chat/completions" || calls[1].authorization != "Bearer hosted-test-key" {
		t.Fatal("provider routing or credential isolation failed")
	}
	if !strings.Contains(calls[0].body, `"model":"user-model"`) || !strings.Contains(calls[1].body, `"model":"hosted-model"`) {
		t.Fatal("wrong model sent to provider")
	}
	for _, call := range calls {
		if strings.Contains(call.body, "user-test-secret") || strings.Contains(call.body, "hosted-test-key") {
			t.Fatal("provider credential entered model content")
		}
	}
	raw, err := os.ReadFile(audit)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "user-test-secret") || strings.Contains(string(raw), byokAccess) {
		t.Fatal("credential entered audit log")
	}
	if got := send("/ai/byok/stream", byokAccess, &ProviderSelection{Provider: "example", Model: "not-allowed", APIKey: "user-test-secret"}); got.Code != http.StatusBadRequest {
		t.Fatal("model allowlist bypass")
	}
	if len(calls) != 2 {
		t.Fatal("unsupported model reached provider")
	}
}
