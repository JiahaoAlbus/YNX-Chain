package aiproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProductionRejectsPersistedFixtureSessionsButAllowsRevocation(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, fixture := testProduct(t, gateway.URL)
	defer fixture.Close()
	session := authenticate(t, fixture.URL, store, newTestIdentity(t))
	// Use the same persisted store, as a restart with fixture mode disabled would.
	server, err := NewServer(Config{GatewayURL: gateway.URL, GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback}, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	production := httptest.NewServer(server.Handler())
	defer production.Close()
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, "/api/conversations"},
		{http.MethodGet, "/api/provider"},
		{http.MethodPost, "/api/conversations"},
		{http.MethodGet, "/api/audit"},
		{http.MethodGet, "/api/auth/session"},
	} {
		raw := authedJSON(t, route.method, production.URL+route.path, nil, session, http.StatusServiceUnavailable)
		if !bytes.Contains(raw, []byte("canonical Wallet session integration is unavailable")) {
			t.Fatalf("missing canonical authority boundary: %s", raw)
		}
	}
	authedJSON(t, http.MethodPost, production.URL+"/api/auth/revoke", nil, session, http.StatusNoContent)
	if _, err := store.Authenticate(session.Token, session.DeviceID); err == nil {
		t.Fatal("legacy fixture session remained active after explicit revocation")
	}
}

func TestSessionReadbackDoesNotIssueCredentialsOrExtendExpiry(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, fixture := testProduct(t, gateway.URL)
	defer fixture.Close()
	session := authenticate(t, fixture.URL, store, newTestIdentity(t))
	for i := 0; i < 2; i++ {
		raw := authedJSON(t, http.MethodGet, fixture.URL+"/api/auth/session", nil, session, http.StatusOK)
		var out struct {
			SessionOutput
			Authority string `json:"authority"`
		}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		if out.Token != "" || out.Account != session.Account || out.DeviceID != session.DeviceID || !out.ExpiresAt.Equal(session.ExpiresAt) || out.Authority != "local-fixture" {
			t.Fatalf("session readback changed identity, expiry or authority: %s", raw)
		}
		if bytes.Contains(raw, []byte("tokenHash")) || bytes.Contains(raw, []byte(session.Token)) {
			t.Fatal("session readback exposed credential material")
		}
	}
	authedJSON(t, http.MethodPost, fixture.URL+"/api/auth/revoke", nil, session, http.StatusNoContent)
	authedJSON(t, http.MethodGet, fixture.URL+"/api/auth/session", nil, session, http.StatusUnauthorized)
}
