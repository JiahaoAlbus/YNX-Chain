package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestShopRegistryV2EntriesMatchRuntimeBindings(t *testing.T) {
	type registry struct {
		SchemaVersion           int      `json:"schemaVersion"`
		ProductClientID         string   `json:"productClientId"`
		RequestingProduct       string   `json:"requestingProduct"`
		BundleID                string   `json:"bundleId"`
		Callbacks               []string `json:"callbacks"`
		Scopes                  []string `json:"scopes"`
		MaxScopes               int      `json:"maxScopes"`
		ProductDeviceAlgorithms []string `json:"productDeviceAlgorithms"`
	}
	for filename, binding := range map[string]ProductBinding{"integration/shop-registry-v2.json": ShopBinding(), "integration/seller-registry-v2.json": SellerBinding()} {
		data, err := os.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		var entry registry
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&entry); err != nil {
			t.Fatalf("%s: %v", filename, err)
		}
		if entry.SchemaVersion != 2 || entry.ProductClientID != binding.ProductClientID || entry.RequestingProduct != binding.RequestingProduct || entry.BundleID != binding.BundleID || len(entry.Callbacks) != 1 || entry.Callbacks[0] != binding.Callback || !exactScopes(entry.Scopes, binding.Scopes) || entry.MaxScopes != len(binding.Scopes) || len(entry.ProductDeviceAlgorithms) != 1 || entry.ProductDeviceAlgorithms[0] != DeviceAlgorithm {
			t.Fatalf("registry/runtime mismatch for %s: %+v %+v", filename, entry, binding)
		}
	}
}

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

func TestCentralGatewayStoreAuthorizationRevocationBindsAccountAndReceipt(t *testing.T) {
	_, account := actor(t, 62)
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/product-authorizations/revocations" || r.Method != http.MethodPost || r.Header.Get("X-YNX-Product-Key") != "service-key" {
			http.Error(w, "wrong revocation contract", http.StatusBadRequest)
			return
		}
		var body struct {
			RequestID, Account, ProductClientID, BundleID string
			ResourceType, ResourceID, Reason              string
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil || body.RequestID != "seller-revoke-request-001" || body.Account != account || body.ProductClientID != SellerClientID || body.BundleID != SellerBundleID || body.ResourceType != "seller_store" || body.ResourceID != "store_scope_001" || body.Reason != "Member access removed" {
			http.Error(w, "bad revocation binding", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"revoked": true, "revocationId": "wallet-revoke-001", "requestId": body.RequestID, "account": body.Account, "productClientId": body.ProductClientID, "bundleId": body.BundleID, "resourceType": body.ResourceType, "resourceId": body.ResourceID, "sessionCount": 2, "revokedAt": now.Format(time.RFC3339Nano)})
	}))
	defer server.Close()
	gateway := HTTPAuthGateway{BaseURL: server.URL, ServiceKey: "service-key", Client: server.Client()}
	receipt, err := gateway.RevokeProductAuthorization(context.Background(), ProductAuthorizationRevocationRequest{RequestID: "seller-revoke-request-001", Account: account, ProductClientID: SellerClientID, BundleID: SellerBundleID, ResourceType: "seller_store", ResourceID: "store_scope_001", Reason: "Member access removed"})
	if err != nil || !receipt.Revoked || receipt.RevocationID != "wallet-revoke-001" || receipt.SessionCount != 2 || receipt.Account != account || receipt.ResourceType != "seller_store" || receipt.ResourceID != "store_scope_001" {
		t.Fatalf("valid revocation receipt rejected: %+v err=%v", receipt, err)
	}
}

func TestCentralGatewayStoreAuthorizationRevocationUnavailableWhenContractMissing(t *testing.T) {
	_, account := actor(t, 63)
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	gateway := HTTPAuthGateway{BaseURL: server.URL, Client: server.Client()}
	_, err := gateway.RevokeProductAuthorization(context.Background(), ProductAuthorizationRevocationRequest{RequestID: "seller-revoke-request-002", Account: account, ProductClientID: SellerClientID, BundleID: SellerBundleID, ResourceType: "seller_store", ResourceID: "store_scope_002", Reason: "Member access removed"})
	if err == nil || !strings.Contains(err.Error(), "not deployed") {
		t.Fatalf("missing revocation contract was not reported unavailable: %v", err)
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
