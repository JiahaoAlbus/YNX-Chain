package datafabricapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

var apiTestKey = []byte("0123456789abcdef0123456789abcdef")

func TestCanonicalRequestPathRejectsAmbiguousQueries(t *testing.T) {
	tests := []struct {
		raw  string
		want string
		ok   bool
	}{
		{raw: "/v1/events", want: "/v1/events", ok: true},
		{raw: "/v1/events?a=1&b=two+words", want: "/v1/events?a=1&b=two+words", ok: true},
		{raw: "/v1/events?b=2&a=1", ok: false},
		{raw: "/v1/events?a=%20", ok: false},
		{raw: "/v1/events?a=1;a=2", ok: false},
	}
	for _, test := range tests {
		value, err := url.Parse(test.raw)
		if err != nil {
			t.Fatal(err)
		}
		got, err := canonicalRequestPath(value)
		if test.ok && (err != nil || got != test.want) {
			t.Fatalf("canonical path %q: got %q, err %v", test.raw, got, err)
		}
		if !test.ok && err == nil {
			t.Fatalf("non-canonical path %q was accepted as %q", test.raw, got)
		}
	}
}

type fakeAuthorizer struct{ deny bool }

func (f fakeAuthorizer) Authorize(_ context.Context, credential Credential, scope string) (Principal, error) {
	if f.deny || credential.SessionToken != "opaque-session-token" || credential.RequestSignature != "device-signature" {
		return Principal{}, errors.New("denied")
	}
	return Principal{SessionID: credential.SessionID, AccountID: "account.wallet.0001", DeviceID: credential.DeviceID, Product: credential.Product, BundleID: credential.BundleID, Scopes: []string{scope}, ExpiresAt: time.Now().UTC().Add(time.Minute), Active: true, RequestBound: true}, nil
}

func TestServerFailsClosedAndCommitsAuthorizedEvent(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	body, _ := json.Marshal(event)

	request := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(body))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || len(store.Events()) != 0 {
		t.Fatalf("missing canonical session did not fail closed: %d %s", response.Code, response.Body.String())
	}

	request = authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay")
	request.Header.Set("Authorization", "Bearer legacy-token")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("legacy bearer was accepted: %d", response.Code)
	}

	request = authorizedRequest(t, http.MethodPost, "/v1/events", body, "shop")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || len(store.Events()) != 0 {
		t.Fatalf("wrong product was accepted: %d %s", response.Code, response.Body.String())
	}

	request = authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || len(store.Events()) != 1 || !strings.Contains(response.Body.String(), "committed-to-outbox") {
		t.Fatalf("authorized event was not committed: %d %s", response.Code, response.Body.String())
	}

	request = authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict || len(store.Events()) != 1 {
		t.Fatalf("duplicate was not idempotently rejected: %d %s", response.Code, response.Body.String())
	}
}

func TestHealthAndProtectedRead(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"integrity":"verified"`) {
		t.Fatalf("health is not evidence backed: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/ledger/journal", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("ledger read was public: %d", response.Code)
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	for _, metric := range []string{"ynx_data_fabric_events", "ynx_data_fabric_outbox_pending", "ynx_data_fabric_dead_letters", "ynx_data_fabric_sagas_recovery", "ynx_data_fabric_reconciliations", "ynx_data_fabric_request_duration_seconds_bucket"} {
		if !strings.Contains(response.Body.String(), metric) {
			t.Fatalf("metrics missing %s: %s", metric, response.Body.String())
		}
	}
}

func TestOperatorConsoleShellHasStrictBrowserBoundary(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/operator/", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "YNX Data Fabric Operator") {
		t.Fatalf("operator console shell is unavailable: %d %s", response.Code, response.Body.String())
	}
	csp := response.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self'") || strings.Contains(csp, "unsafe-inline") || !strings.Contains(response.Header().Get("Permissions-Policy"), "payment=()") {
		t.Fatalf("operator browser boundary is incomplete: CSP=%q permissions=%q", csp, response.Header().Get("Permissions-Policy"))
	}
}

type unavailableRepository struct{ Repository }

func (unavailableRepository) Events(context.Context) ([]datafabric.EventEnvelope, error) {
	return nil, errors.New("postgres://secret@internal/database unavailable")
}

func TestRepositoryFailureIs503AndDoesNotLeakConnectionDetails(t *testing.T) {
	server, err := New(Config{Repository: unavailableRepository{}, Authorizer: fakeAuthorizer{}, EventKeys: map[string][]byte{"key.datafabric.0001": apiTestKey}, EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"}, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0"})
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/events", nil, "pay"))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "repository_unavailable") || strings.Contains(response.Body.String(), "postgres") || strings.Contains(response.Body.String(), "internal/database") {
		t.Fatalf("repository error boundary leaked or returned wrong status: %d %s", response.Code, response.Body.String())
	}
}

func TestHTTPAuthorizerRejectsScopeWideningAndExpiry(t *testing.T) {
	introspection := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if validTraceID(r.Header.Get("Traceparent")) == "" {
			t.Error("canonical introspection did not receive valid trace context")
		}
		var request map[string]string
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["requestMethod"] != http.MethodGet || request["requestPath"] != "/v1/events" || request["bundleId"] != "app.ynx.pay" || request["contentSha256"] == "" {
			t.Errorf("introspection did not receive the exact method/path/bundle binding: %#v", request)
		}
		writeJSON(w, http.StatusOK, Principal{SessionID: request["sessionId"], AccountID: "account.wallet.0001", DeviceID: request["deviceId"], Product: request["product"], BundleID: request["bundleId"], Scopes: []string{"fabric.events.read"}, ExpiresAt: time.Now().UTC().Add(time.Minute), Active: true, RequestBound: true})
	}))
	defer introspection.Close()
	authorizer := HTTPAuthorizer{Endpoint: introspection.URL}
	credential := Credential{SessionToken: "opaque", SessionID: "session.wallet.0001", DeviceID: "device.wallet.0001", Product: "pay", BundleID: "app.ynx.pay", RequestID: "request.fabric.0001", RequestNonce: "nonce.fabric.0001", RequestTimestamp: time.Now().UTC().Format(time.RFC3339), RequestSignature: "signature", RequestMethod: http.MethodGet, RequestPath: "/v1/events", ContentSHA256: fmt.Sprintf("%x", sha256.Sum256(nil))}
	traceContext, _, _ := requestTraceContext(context.Background(), "00-11111111111111111111111111111111-2222222222222222-01")
	if _, err := authorizer.Authorize(traceContext, credential, "fabric.ledger.write"); err == nil {
		t.Fatal("scope widening was accepted")
	}
}

func TestServerContinuesOrReplacesTraceContext(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set("Traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if traceID := validTraceID(response.Header().Get("Traceparent")); traceID != "11111111111111111111111111111111" {
		t.Fatalf("valid trace context was not continued: %q", response.Header().Get("Traceparent"))
	}
	request = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	request.Header.Set("Traceparent", "invalid")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if traceID := validTraceID(response.Header().Get("Traceparent")); traceID == "" {
		t.Fatalf("invalid trace context was not safely replaced: %q", response.Header().Get("Traceparent"))
	}
}

func TestHTTPAuthorizerFailsClosedAcrossCanonicalAuthorityBoundaries(t *testing.T) {
	credential := Credential{SessionToken: "opaque", SessionID: "session.wallet.0001", DeviceID: "device.wallet.0001", Product: "pay", BundleID: "app.ynx.pay", RequestID: "request.fabric.0001", RequestNonce: "nonce.fabric.0001", RequestTimestamp: time.Now().UTC().Format(time.RFC3339Nano), RequestSignature: "signature", RequestMethod: http.MethodPost, RequestPath: "/v1/events", ContentSHA256: fmt.Sprintf("%x", sha256.Sum256(nil))}
	valid := Principal{SessionID: credential.SessionID, AccountID: "account.wallet.0001", DeviceID: credential.DeviceID, Product: credential.Product, BundleID: credential.BundleID, Scopes: []string{"fabric.events.write"}, ExpiresAt: time.Now().UTC().Add(time.Minute), Active: true, RequestBound: true}
	cases := []struct {
		name   string
		mutate func(*Principal)
	}{
		{name: "revoked", mutate: func(value *Principal) { value.Active = false }},
		{name: "tampered-or-unbound", mutate: func(value *Principal) { value.RequestBound = false }},
		{name: "wrong-session", mutate: func(value *Principal) { value.SessionID = "session.wallet.other" }},
		{name: "wrong-device", mutate: func(value *Principal) { value.DeviceID = "device.wallet.other" }},
		{name: "wrong-product", mutate: func(value *Principal) { value.Product = "shop" }},
		{name: "wrong-bundle", mutate: func(value *Principal) { value.BundleID = "app.ynx.other" }},
		{name: "scope-widening", mutate: func(value *Principal) { value.Scopes = []string{"fabric.events.read"} }},
		{name: "expired", mutate: func(value *Principal) { value.ExpiresAt = time.Now().UTC().Add(-time.Second) }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			principal := valid
			test.mutate(&principal)
			introspection := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				writeJSON(w, http.StatusOK, principal)
			}))
			defer introspection.Close()
			if _, err := (HTTPAuthorizer{Endpoint: introspection.URL}).Authorize(context.Background(), credential, "fabric.events.write"); err == nil {
				t.Fatalf("canonical boundary %q failed open", test.name)
			}
		})
	}
}

func TestServerRejectsStaleAndReplayedCanonicalBindings(t *testing.T) {
	server, _ := newTestServer(t, fakeAuthorizer{})
	stale := authorizedRequest(t, http.MethodGet, "/v1/events", nil, "pay")
	stale.Header.Set("X-YNX-Timestamp", time.Now().UTC().Add(-3*time.Minute).Format(time.RFC3339Nano))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, stale)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "canonical_request_stale") {
		t.Fatalf("stale request binding was accepted: %d %s", response.Code, response.Body.String())
	}

	request := authorizedRequest(t, http.MethodGet, "/v1/events", nil, "pay")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("fresh request was rejected: %d %s", response.Code, response.Body.String())
	}
	replay := request.Clone(context.Background())
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, replay)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "canonical_request_replayed") {
		t.Fatalf("replayed request binding was accepted: %d %s", response.Code, response.Body.String())
	}
}

func TestServerRejectsContentDigestTamperingBeforeIntrospection(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	body, _ := json.Marshal(event)
	request := authorizedRequest(t, http.MethodPost, "/v1/events", body, "pay")
	request.Header.Set("X-YNX-Content-SHA256", strings.Repeat("0", 64))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "canonical_content_tampered") || len(store.Events()) != 0 {
		t.Fatalf("content tampering reached the authoritative store: %d %s", response.Code, response.Body.String())
	}
}

func TestPaginationIsBoundedStableAndRejectsUnknownCursor(t *testing.T) {
	values := []string{"event.0001", "event.0002", "event.0003"}
	request := httptest.NewRequest(http.MethodGet, "/v1/events?limit=2", nil)
	page, cursor, err := paginate(request, values, func(value string) string { return value })
	if err != nil || len(page) != 2 || cursor != "event.0002" {
		t.Fatalf("first page is unstable: %v %q %v", page, cursor, err)
	}
	request = httptest.NewRequest(http.MethodGet, "/v1/events?limit=2&cursor=event.0002", nil)
	page, cursor, err = paginate(request, values, func(value string) string { return value })
	if err != nil || len(page) != 1 || page[0] != "event.0003" || cursor != "" {
		t.Fatalf("second page is unstable: %v %q %v", page, cursor, err)
	}
	for _, query := range []string{"?limit=0", "?limit=201", "?limit=invalid", "?cursor=event.absent"} {
		request = httptest.NewRequest(http.MethodGet, "/v1/events"+query, nil)
		if _, _, err := paginate(request, values, func(value string) string { return value }); err == nil {
			t.Fatalf("invalid pagination was accepted: %s", query)
		}
	}
}

func TestCanonicalSessionRateLimitFailsClosed(t *testing.T) {
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Store: store, Authorizer: fakeAuthorizer{}, EventKeys: map[string][]byte{"key.datafabric.0001": apiTestKey}, EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"}, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0", RateLimitPerMinute: 1})
	if err != nil {
		t.Fatal(err)
	}
	first := httptest.NewRecorder()
	server.Handler().ServeHTTP(first, authorizedRequest(t, http.MethodGet, "/v1/events", nil, "pay"))
	if first.Code != http.StatusOK {
		t.Fatalf("first bounded request failed: %d %s", first.Code, first.Body.String())
	}
	second := httptest.NewRecorder()
	server.Handler().ServeHTTP(second, authorizedRequest(t, http.MethodGet, "/v1/events", nil, "pay"))
	if second.Code != http.StatusTooManyRequests || second.Header().Get("Retry-After") != "60" || !strings.Contains(second.Body.String(), "canonical_session_rate_limited") {
		t.Fatalf("session rate limit failed open: %d %s", second.Code, second.Body.String())
	}
}

func TestProductIsolationSagaRecoveryAndAuditExport(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	if err := store.Append(event, apiTestKey); err != nil {
		t.Fatal(err)
	}

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/events", nil, "shop"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"events":[]`) {
		t.Fatalf("cross-product event isolation failed: %d %s", response.Code, response.Body.String())
	}

	deadline := time.Now().UTC().Add(time.Minute)
	start, _ := json.Marshal(map[string]any{"sagaId": "saga.pay.api.0001", "kind": datafabric.SagaPay, "aggregateId": "invoice.api.0001", "correlationId": event.CorrelationID, "auditId": "audit.saga.api.0001", "deadline": deadline})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas", start, "pay"))
	if response.Code != http.StatusCreated {
		t.Fatalf("saga start failed: %d %s", response.Code, response.Body.String())
	}

	step, _ := json.Marshal(map[string]string{"eventId": "event.pay.authorization.0001"})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas/saga.pay.api.0001/steps", step, "pay"))
	if response.Code != http.StatusOK {
		t.Fatalf("saga step failed: %d %s", response.Code, response.Body.String())
	}
	failure, _ := json.Marshal(map[string]string{"reason": "settlement provider unavailable"})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas/saga.pay.api.0001/fail", failure, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"compensating"`) {
		t.Fatalf("saga fail failed: %d %s", response.Code, response.Body.String())
	}
	compensation, _ := json.Marshal(map[string]string{"eventId": "event.pay.authorization.voided.0001"})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas/saga.pay.api.0001/compensations", compensation, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"compensated"`) {
		t.Fatalf("saga compensation failed: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/sagas/saga.pay.api.0001", nil, "shop"))
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-product saga read was accepted: %d", response.Code)
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/audit/export", nil, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), event.EventID) || !strings.Contains(response.Body.String(), "saga.pay.api.0001") {
		t.Fatalf("audit export is incomplete: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/privacy/export", nil, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), event.EventID) || !strings.Contains(response.Body.String(), event.Actor.AccountID) {
		t.Fatalf("subject export is incomplete: %d %s", response.Code, response.Body.String())
	}
	erasure, _ := json.Marshal(map[string]string{"auditId": "audit.privacy.api.0001"})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/privacy/erase", erasure, "pay"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "analytics-suppressed-authoritative-retention-applied") || strings.Contains(response.Body.String(), event.Actor.AccountID) {
		t.Fatalf("subject erasure truth is invalid: %d %s", response.Code, response.Body.String())
	}
}

func newTestServer(t *testing.T, authorizer Authorizer) (*Server, *datafabric.Store) {
	t.Helper()
	store, err := datafabric.OpenStore(t.TempDir() + "/store.json")
	if err != nil {
		t.Fatal(err)
	}
	server, err := New(Config{Store: store, Authorizer: authorizer, EventKeys: map[string][]byte{"key.datafabric.0001": apiTestKey}, EventKeyProducts: map[string]string{"key.datafabric.0001": "pay"}, PrivacyKey: []byte("abcdef0123456789abcdef0123456789"), SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "data-fabric-testnet-v0"})
	if err != nil {
		t.Fatal(err)
	}
	return server, store
}

func authorizedRequest(t *testing.T, method, path string, body []byte, product string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.Header.Set("X-YNX-App-Session", "opaque-session-token")
	request.Header.Set("X-YNX-Session-ID", "session.wallet.0001")
	request.Header.Set("X-YNX-Device-ID", "device.wallet.0001")
	request.Header.Set("X-YNX-Product", product)
	request.Header.Set("X-YNX-Bundle-ID", "app.ynx."+product)
	sequence := apiRequestSequence.Add(1)
	request.Header.Set("X-YNX-Request-ID", fmt.Sprintf("request.fabric.%04d", sequence))
	request.Header.Set("X-YNX-Request-Nonce", fmt.Sprintf("nonce.fabric.%04d", sequence))
	request.Header.Set("X-YNX-Timestamp", time.Now().UTC().Format(time.RFC3339))
	request.Header.Set("X-YNX-Device-Signature", "device-signature")
	request.Header.Set("X-YNX-Content-SHA256", fmt.Sprintf("%x", sha256.Sum256(body)))
	return request
}

var apiRequestSequence atomic.Uint64

func apiEvent(t *testing.T) datafabric.EventEnvelope {
	t.Helper()
	now := time.Date(2026, 7, 22, 15, 0, 0, 0, time.UTC)
	event := datafabric.EventEnvelope{EventID: "event.pay.invoice.api.0001", EventType: "pay.invoice.created", SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "pay", Service: "invoice", AggregateID: "invoice.api.0001", Actor: datafabric.Actor{ActorID: "actor.wallet.0001", AccountID: "account.wallet.0001", SessionID: "session.wallet.0001"}, CorrelationID: "correlation.api.0001", CausationID: "command.api.0001", Sequence: 1, Timestamp: now, EffectiveAt: now, SourceCommit: "719e1018267ed5a53e6fae5211c5fd8a1503c35c", SourceRelease: "pay-testnet-v0", PrivacyClassification: "confidential", RetentionClass: "financial-7y", AuditID: "audit.api.0001", Source: datafabric.SourceMetadata{Source: "ynx-pay", AsOf: now, Version: "v1", Status: "authoritative"}, Payload: json.RawMessage(`{"status":"created"}`)}
	if err := event.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	return event
}
