package commerce

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCentralGatewayIntrospectionRejectsTamperExpiryAndCrossProduct(t *testing.T) {
	_, account := actor(t, 61)
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/product-sessions/introspect" || r.Method != http.MethodPost || r.Header.Get("X-YNX-Product-Key") != "service-key" {
			http.Error(w, "wrong contract", http.StatusBadRequest)
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		response := map[string]any{"active": true, "sessionBinding": strings.Repeat("a", 64), "productClientId": ShopClientID, "bundleId": ShopBundleID, "account": account, "scopes": ShopScopes, "expiresAt": now.Add(time.Hour).Format(time.RFC3339Nano)}
		switch token {
		case "tampered-scope-token-123456":
			response["scopes"] = []string{"account:read", "shop:seller:operate"}
		case "cross-product-token-1234567":
			response["bundleId"] = "com.attacker.product"
		case "expired-session-token-12345":
			response["expiresAt"] = now.Add(-time.Minute).Format(time.RFC3339Nano)
		case "unknown-field-token-1234567":
			response["unexpected"] = true
		case "valid-product-token-123456789":
		default:
			http.Error(w, "revoked", http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	gateway := HTTPAuthGateway{BaseURL: server.URL, ServiceKey: "service-key", Client: server.Client()}
	principal, err := gateway.Verify(context.Background(), "valid-product-token-123456789")
	if err != nil || principal.Account != account || principal.Role != "buyer" || !principal.HasScope("shop:orders:write") {
		t.Fatalf("valid central session rejected: %+v %v", principal, err)
	}
	for _, token := range []string{"tampered-scope-token-123456", "cross-product-token-1234567", "expired-session-token-12345", "unknown-field-token-1234567", "revoked-product-token-123456"} {
		if _, err := gateway.Verify(context.Background(), token); err == nil {
			t.Fatalf("unsafe session accepted: %s", token)
		}
	}
}

func TestCentralGatewayProxyPreservesReplayAndTamperRejection(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := struct {
			Nonce  string `json:"nonce"`
			Tamper bool   `json:"tamper,omitempty"`
		}{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Nonce == "" {
			http.Error(w, `{"error":"invalid"}`, http.StatusBadRequest)
			return
		}
		if body.Tamper {
			http.Error(w, `{"error":"binding mismatch"}`, http.StatusBadRequest)
			return
		}
		key := r.URL.Path + ":" + body.Nonce
		mu.Lock()
		if seen[key] {
			mu.Unlock()
			http.Error(w, `{"error":"replay"}`, http.StatusConflict)
			return
		}
		seen[key] = true
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"accepted":true,"path":%q}`, r.URL.Path)
	}))
	defer server.Close()
	gateway := HTTPAuthGateway{BaseURL: server.URL, Client: server.Client()}
	if _, err := gateway.Begin(context.Background(), json.RawMessage(`{"nonce":"approval-123"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := gateway.Begin(context.Background(), json.RawMessage(`{"nonce":"approval-123"}`)); err == nil || !strings.Contains(err.Error(), "replay") {
		t.Fatalf("approval replay not preserved: %v", err)
	}
	if _, err := gateway.Complete(context.Background(), json.RawMessage(`{"nonce":"device-proof","tamper":true}`)); err == nil {
		t.Fatal("tampered device completion accepted")
	}
	if _, err := gateway.Complete(context.Background(), json.RawMessage(`{"nonce":"device-proof"}`)); err != nil {
		t.Fatal(err)
	}
}
