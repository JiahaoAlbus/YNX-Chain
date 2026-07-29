package governance

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCanaryHTTPMutationsBindSessionIdentityAndPersist(t *testing.T) {
	now := time.Date(2026, 7, 27, 11, 0, 0, 0, time.UTC)
	service := testService(t)
	proposal := proposalAtTimelock(t, service, now)
	envelope := makeTestCanaryEnvelope(t, service, proposal, strings.Repeat("a", 64))
	current := envelope.StartsAt
	auth := &testAuth{principal: Principal{
		Account: "wrong-operator", Product: "governance", DeviceID: "device-1", SessionID: "session-1",
		Roles: map[string]bool{"executor": true}, Scopes: map[Scope]bool{ScopeBridge: true},
	}}
	statePath := filepath.Join(t.TempDir(), "state.json")
	server, err := NewServer(service, auth, statePath, func() time.Time { return current })
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(envelope)
	request := httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/canary/start", bytes.NewReader(body))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched canary session identity status=%d body=%s", response.Code, response.Body.String())
	}

	auth.principal.Account = envelope.Operator
	request = httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/canary/start", bytes.NewReader(body))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("start canary status=%d body=%s", response.Code, response.Body.String())
	}
	restored, err := Load(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if canaries := restored.ListCanaries(); len(canaries) != 1 || canaries[0].Status != CanaryRunning {
		t.Fatalf("running canary was not persisted: %+v", canaries)
	}

	current = envelope.EndsAt
	running := service.ListCanaries()[0]
	result := makeTestCanaryResultEnvelope(t, service, proposal, running, 100, 0, current)
	auth.principal.Roles = map[string]bool{"verifier": true}
	body, _ = json.Marshal(result)
	request = httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/canary/complete", bytes.NewReader(body))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched verifier session identity status=%d body=%s", response.Code, response.Body.String())
	}
	auth.principal.Account = result.Verifier
	request = httptest.NewRequest(http.MethodPost, "/governance/proposals/"+proposal.ID+"/canary/complete", bytes.NewReader(body))
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("complete canary status=%d body=%s", response.Code, response.Body.String())
	}
	restored, err = Load(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if canaries := restored.ListCanaries(); len(canaries) != 1 || canaries[0].Status != CanaryPassed || canaries[0].Result == nil {
		t.Fatalf("passed canary was not persisted: %+v", canaries)
	}
}
