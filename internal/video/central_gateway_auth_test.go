package video

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCentralCreatorSessionUsesServerSelectedScope(t *testing.T) {
	wantScope := "video.creator"
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/wallet/sessions/introspect" || r.Header.Get("X-YNX-Product-Session-Proof") != "proof-once" {
			t.Errorf("unexpected introspection request")
		}
		var body struct {
			RequiredScopes []string `json:"requiredScopes"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body.RequiredScopes) != 1 || body.RequiredScopes[0] != wantScope {
			t.Errorf("scope=%v", body.RequiredScopes)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": map[string]any{"account": gatewayTestAccount, "requestingProduct": "ynx-creator-studio", "productClientId": "ynx-creator-studio-web-v1", "bundleId": "com.ynxweb4.creator-studio.web", "scopes": []string{"ai.video.propose", "pay.payout.intent", "video.creator", "video.read"}, "expiresAt": time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)}}})
	}))
	defer gateway.Close()
	auth := CentralProductSessionAuth{GatewayURL: gateway.URL, Client: gateway.Client()}
	request := httptest.NewRequest(http.MethodPost, "/v1/uploads", nil)
	request.Header.Set("X-YNX-Product-Session-Proof", "proof-once")
	account, err := auth.Account(request)
	if err != nil || account != gatewayTestAccount {
		t.Fatalf("account=%s err=%v", account, err)
	}
}

func TestCentralCreatorSessionRejectsProductSubstitution(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": map[string]any{"active": true, "session": map[string]any{"account": gatewayTestAccount, "requestingProduct": "attacker", "productClientId": "ynx-creator-studio-web-v1", "bundleId": "com.ynxweb4.creator-studio.web", "scopes": []string{"video.read"}, "expiresAt": time.Now().UTC().Add(time.Minute).Format(time.RFC3339Nano)}}})
	}))
	defer gateway.Close()
	request := httptest.NewRequest(http.MethodGet, "/v1/studio", nil)
	request.Header.Set("X-YNX-Product-Session-Proof", "proof-once")
	if _, err := (CentralProductSessionAuth{GatewayURL: gateway.URL, Client: gateway.Client()}).Account(request); err == nil {
		t.Fatal("product substitution was accepted")
	}
}
