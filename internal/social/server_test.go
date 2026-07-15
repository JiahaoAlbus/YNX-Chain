package social

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type testResolver struct{ account string }

func (r testResolver) ResolveDiscovery(source, value string) (string, error) {
	if source != "handle" || value != "bob_social" {
		return "", errors.New("only an exact Social handle is accepted")
	}
	return r.account, nil
}

func TestServerStrictParserDiscoveryBoundaryAndAuthorization(t *testing.T) {
	service, now := testService(t)
	service.cfg.RateLimitMax = 100
	aliceFixture := newFixture(t, 31)
	bobFixture := newFixture(t, 32)
	login, err := service.Login(signedAssertion(t, aliceFixture, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service, testResolver{account: bobFixture.account}).Handler())
	defer server.Close()
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-1","source":"handle","value":"bob_social","unknown":true}`))
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", response.StatusCode)
	}
	response.Body.Close()
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-2","source":"handle","value":"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz7fll8"}`))
	if response.StatusCode == http.StatusCreated {
		t.Fatal("wallet address discovery was accepted")
	}
	response.Body.Close()
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-3","source":"handle","value":"bob_social"}`))
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("handle discovery status=%d", response.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	response = doRequest(t, http.MethodGet, server.URL+"/social/v1/contacts", "", nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status=%d", response.StatusCode)
	}
	response.Body.Close()
}

func doRequest(t *testing.T, method, url, token string, body []byte) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}
