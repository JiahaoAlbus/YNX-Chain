package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Controlled owner routing tests. Actual cryptographic/shared interoperability
// is separate under commerce_v2; this verifier is never a production adapter.
type controlledBusinessVerifier struct {
	account string
	role    string
	fence   func() error
}

func (v controlledBusinessVerifier) verify(r *http.Request, body []byte, route businessRoutePolicy) (*verifiedBusinessRequest, error) {
	if r.Header.Get("X-QA-Business-Nonce") == "" {
		return nil, &businessHTTPError{"PROOF_REQUIRED", 401}
	}
	scopes := ShopScopes
	if v.role == "seller" {
		scopes = SellerScopes
	}
	fence := v.fence
	if fence == nil {
		fence = currentBusinessActor
	}
	return &verifiedBusinessRequest{principal: Principal{Account: v.account, Role: v.role, SessionBinding: strings.Repeat("a", 64), Scopes: scopes, ExpiresAt: time.Now().Add(time.Minute)}, proof: businessActionAuthorization{strings.Repeat("a", 64), r.Header.Get("X-QA-Business-Nonce"), time.Now().Add(30 * time.Second)}, revalidate: func(context.Context) error { return nil }, fence: fence}, nil
}
func businessHTTPRequest(server *Server, method, path, nonce, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("X-QA-Business-Nonce", nonce)
	r.Header.Set("Authorization", "Bearer legacy-valid-token")
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	return w
}
func TestV2HTTPOriginalProfileAtomicReplyAndReplayDoesNotFallBackToBearer(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Auth: testAuth{principals: map[string]Principal{"legacy-valid-token": principal(buyer, "buyer")}}})
	if w := businessHTTPRequest(server, "PUT", "/api/profile", "", `{"DisplayName":"legacy"}`); w.Code != 401 {
		t.Fatal("legacy bearer bypassed v2", w.Code)
	}
	nonce := strings.Repeat("b", 43)
	if w := businessHTTPRequest(server, "PUT", "/api/profile", nonce, `{"DisplayName":"confirmed"}`); w.Code != 200 || s.Profile(buyer).DisplayName != "confirmed" {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := businessHTTPRequest(server, "PUT", "/api/profile", nonce, `{"DisplayName":"changed"}`); w.Code != 409 || s.Profile(buyer).DisplayName != "confirmed" {
		t.Fatal("replay changed profile", w.Code)
	}
	if w := businessHTTPRequest(server, "POST", "/api/auth/gateway/sessions", nonce, `{}`); w.Code != 410 {
		t.Fatal("v2 retained legacy issuance", w.Code)
	}
}
func TestV2HTTPRejectedBodyRoleAndReplacementKeepBusinessAndNonceUnchanged(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	_, owner := actor(t, 1)
	store, _ := setupCatalog(t, s, owner, 10)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	nonce := strings.Repeat("b", 43)
	if w := businessHTTPRequest(server, "PUT", "/api/profile", nonce, `{"Unknown":true}`); w.Code != 400 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("invalid body committed", w.Code)
	}
	if w := businessHTTPRequest(server, "PUT", "/api/seller/stores/"+store.ID, nonce, `{}`); w.Code != 403 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("buyer became seller", w.Code)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", "/api/seller/stores/"+store.ID+"/activate", nonce, `{}`); w.Code != 403 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("seller scope created foreign owner", w.Code)
	}
	checks := 0
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
		checks++
		if checks >= 4 {
			return ErrUnauthorized
		}
		return nil
	}}})
	w := businessHTTPRequest(server, "PUT", "/api/profile", nonce, `{"DisplayName":"late private reply"}`)
	if w.Code != 403 || s.Profile(buyer).DisplayName != "" || len(s.s.BusinessNonces) != 0 || bytes.Contains(w.Body.Bytes(), []byte("late private reply")) {
		t.Fatal("replacement published staged private data", w.Code, w.Body.String())
	}
}
func TestV2HTTPUnsupportedExternalRouteRemainsClosed(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(200) }))
	defer provider.Close()
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, Pay: HTTPPayVerifier{BaseURL: provider.URL, APIKey: "qa", MerchantID: "qa"}})
	w := businessHTTPRequest(server, "POST", "/api/orders/order_abc/transition", strings.Repeat("b", 43), `{"Action":"disputed"}`)
	if w.Code != 503 || calls != 0 || len(s.s.BusinessNonces) != 0 {
		t.Fatal("external effect dispatched or silently consumed", w.Code, calls)
	}
	if err := validateCommerceBusinessRoutes(); err != nil {
		t.Fatal(err)
	}
}
func TestV2HTTPPrivacyAndLookupKeepOriginalActorBoundaries(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 2)
	_, other := actor(t, 3)
	_, _ = s.SaveProfile(buyer, "mine", nil)
	_, _ = s.SaveProfile(other, "theirs", nil)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	w := businessHTTPRequest(server, "POST", "/api/privacy/delete", strings.Repeat("b", 43), `{"confirmation":"DELETE_MY_SHOP_DATA"}`)
	if w.Code != 200 || s.Profile(buyer).DisplayName != "" || s.Profile(other).DisplayName != "theirs" {
		t.Fatal("privacy crossed account", w.Code, w.Body.String())
	}
	var receipt BuyerDataDeletionReceipt
	if err := json.Unmarshal(w.Body.Bytes(), &receipt); err != nil || receipt.ReceiptID == "" {
		t.Fatal("missing actual deletion receipt", err)
	}
	w = businessHTTPRequest(server, "POST", "/api/orders/intent-lookup", strings.Repeat("c", 43), `{"IdempotencyKey":"still-unseen-original-key"}`)
	if w.Code != 404 {
		t.Fatal("unseen lookup manufactured receipt", w.Code)
	}
	if len(s.s.BusinessNonces) != 1 {
		t.Fatal("rejected lookup consumed nonce")
	}
}
