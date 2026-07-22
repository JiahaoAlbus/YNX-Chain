package governance

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type testAuth struct {
	principal Principal
	err       error
}

func (a *testAuth) Authenticate(*http.Request) (Principal, error) { return a.principal, a.err }

func TestServerFailsClosedAndPersistsAuthoritativeMutation(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	service := testService(t)
	auth := &testAuth{err: errors.New("no session")}
	path := filepath.Join(t.TempDir(), "state.json")
	server, err := NewServer(service, auth, path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	in := proposalInput(now)
	in.Proposer = "untrusted-body-account"
	body, _ := json.Marshal(in)
	req := httptest.NewRequest(http.MethodPost, "/governance/proposals", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing auth status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("X-Request-ID") == "" || rec.Header().Get("X-YNX-Error-ID") == "" {
		t.Fatal("authorization failure missing request/error IDs")
	}
	auth.err = nil
	auth.principal = Principal{Account: "delegator-from-session", Product: "wrong-product", DeviceID: "device-1", SessionID: "session-1", Roles: map[string]bool{"proposer": true}, Scopes: map[Scope]bool{ScopeBridge: true}}
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req.Clone(req.Context()))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong product status=%d", rec.Code)
	}
	auth.principal.Product = "governance"
	auth.principal.Roles = map[string]bool{"voter": true}
	req = httptest.NewRequest(http.MethodPost, "/governance/proposals", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("scope widening status=%d", rec.Code)
	}
	auth.principal.Roles["proposer"] = true
	auth.principal.Scopes = map[Scope]bool{ScopeOracle: true}
	req = httptest.NewRequest(http.MethodPost, "/governance/proposals", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong object scope status=%d", rec.Code)
	}
	auth.principal.Scopes = map[Scope]bool{ScopeBridge: true}
	req = httptest.NewRequest(http.MethodPost, "/governance/proposals", bytes.NewReader(body))
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data    Proposal `json:"data"`
		Source  string   `json:"source"`
		Version string   `json:"version"`
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Data.Input.Proposer != "delegator-from-session" || envelope.Source != "ynx-governance-authoritative-state" || envelope.Version != apiVersion {
		t.Fatalf("bad envelope: %+v", envelope)
	}
	restored, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := restored.Get(envelope.Data.ID)
	if err != nil || saved.Input.Proposer != "delegator-from-session" {
		t.Fatalf("not persisted: %+v %v", saved, err)
	}
}

func TestServerPublicReadsExposeSourceAndNoSecrets(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	server, err := NewServer(testService(t), &testAuth{err: errors.New("unused")}, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/health", "/governance/proposals", "/governance/emergencies", "/governance/appeals", "/governance/roles"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d", path, rec.Code)
		}
		if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Content-Security-Policy") == "" {
			t.Fatalf("%s missing security headers", path)
		}
		var out map[string]any
		if err = json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out["source"] != "ynx-governance-authoritative-state" || out["version"] != apiVersion || out["asOf"] == nil {
			t.Fatalf("%s metadata=%v", path, out)
		}
	}
}

func TestMetricsAreBoundedAndTruthful(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	server, err := NewServer(testService(t), &testAuth{err: errors.New("unused")}, filepath.Join(t.TempDir(), "state.json"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/plain; version=0.0.4; charset=utf-8" {
		t.Fatalf("metrics status=%d", rec.Code)
	}
	body := rec.Body.String()
	for _, required := range []string{"ynx_governance_proposals_total", "ynx_governance_active_emergencies", "ynx_governance_external_execution_enabled", " 0\n"} {
		if !strings.Contains(body, required) {
			t.Fatalf("metrics missing %q: %s", required, body)
		}
	}
}
