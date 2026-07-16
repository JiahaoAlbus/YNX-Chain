package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestServerAuthorizationScopeAndStrictJSON(t *testing.T) {
	now := time.Now().UTC()
	s := testService(t, func(c *Config) { c.Now = func() time.Time { return now } })
	handler := NewServer(s).Handler()
	a := WalletAssertion{Product: "cloud", ClientID: "com.ynx.cloud.web", BundleID: "com.ynx.cloud.web", Callback: "/cloud/auth/callback", Account: owner, ChainID: ChainID, Scopes: []string{"files.read"}, Nonce: "n", ExpiresAt: now.Add(4 * time.Minute).Format(time.RFC3339), DevicePublicKey: "d", Signature: "s"}
	token, _, err := s.CreateSession(context.Background(), a)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401 got %d", rr.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 403 {
		t.Fatalf("scope must fail before parse: %d %s", rr.Code, rr.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/objects", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("read: %d %s", rr.Code, rr.Body.String())
	}
	var objects []Object
	if err := json.NewDecoder(rr.Body).Decode(&objects); err != nil {
		t.Fatal(err)
	}
	if rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("missing CSP")
	}
	a.Scopes = []string{"files.read", "files.write"}
	a.Nonce = "n2"
	token, _, err = s.CreateSession(context.Background(), a)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/objects", bytes.NewBufferString(`{"kind":"folder","name":"x","unknown":true}`))
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 400 {
		t.Fatalf("strict JSON want 400 got %d: %s", rr.Code, rr.Body.String())
	}
}
