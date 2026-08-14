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

func TestProductProducerIngressBindsKeyBodyFreshnessAndReplay(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	body, _ := json.Marshal(event)
	at := time.Now().UTC().Format(time.RFC3339Nano)
	request := producerRequest(t, body, at, "nonce.producer.api.0001", "key.datafabric.0001", apiTestKey)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || len(store.Events()) != 1 || !strings.Contains(response.Body.String(), `"status":"committed-to-outbox"`) {
		t.Fatalf("valid product producer event was not committed: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, body, at, "nonce.producer.api.0001", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), string(datafabric.CodeReplay)) {
		t.Fatalf("producer nonce replay was accepted: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, body, time.Now().UTC().Format(time.RFC3339Nano), "nonce.producer.api.0002", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusOK || len(store.Events()) != 1 || !strings.Contains(response.Body.String(), `"status":"already-committed"`) {
		t.Fatalf("idempotent product redelivery was not acknowledged: %d %s", response.Code, response.Body.String())
	}

	tamperedBody := append([]byte(nil), body...)
	tamperedBody[len(tamperedBody)-2] ^= 1
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequestWithSignature(t, tamperedBody, time.Now().UTC().Format(time.RFC3339Nano), "nonce.producer.api.0003", "key.datafabric.0001", body, apiTestKey))
	if response.Code != http.StatusUnauthorized || len(store.Events()) != 1 {
		t.Fatalf("producer body tampering was accepted: %d %s", response.Code, response.Body.String())
	}

	stale := time.Now().UTC().Add(-3 * time.Minute).Format(time.RFC3339Nano)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, body, stale, "nonce.producer.api.0004", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), string(datafabric.CodeReplay)) {
		t.Fatalf("stale producer delivery was accepted: %d %s", response.Code, response.Body.String())
	}

	wrongProduct := event
	wrongProduct.EventID = "event.shop.order.producer.0001"
	wrongProduct.EventType = "shop.order.created"
	wrongProduct.Product = "shop"
	wrongProduct.Service = "order"
	wrongProduct.AggregateID = "order.producer.0001"
	wrongProduct.CorrelationID = "correlation.shop.producer.0001"
	wrongProduct.AuditID = "audit.shop.producer.0001"
	if err := wrongProduct.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	wrongBody, _ := json.Marshal(wrongProduct)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, producerRequest(t, wrongBody, time.Now().UTC().Format(time.RFC3339Nano), "nonce.producer.api.0005", "key.datafabric.0001", apiTestKey))
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), string(datafabric.CodeWrongProduct)) || len(store.Events()) != 1 {
		t.Fatalf("cross-product producer key was accepted: %d %s", response.Code, response.Body.String())
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
	for _, metric := range []string{"ynx_data_fabric_events", "ynx_data_fabric_outbox_pending", "ynx_data_fabric_dead_letters", "ynx_data_fabric_billing_rate_plans", "ynx_data_fabric_billing_settlements", "ynx_data_fabric_sagas_recovery", "ynx_data_fabric_reconciliations", "ynx_data_fabric_producer_concurrency_limit", "ynx_data_fabric_producer_backpressure_total", "ynx_data_fabric_request_duration_seconds_bucket"} {
		if !strings.Contains(response.Body.String(), metric) {
			t.Fatalf("metrics missing %s: %s", metric, response.Body.String())
		}
	}
}

func TestUsageBillingRoutesEnforceProductAndCommitLedgerSettlement(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	usageStart := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	usageEnd := usageStart.Add(time.Hour)
	payload, _ := json.Marshal(datafabric.MeteredUsage{Meter: "compute", Unit: "request", Quantity: 250, UsageStart: usageStart, UsageEnd: usageEnd})
	event := datafabric.EventEnvelope{
		EventID: "event.cloud.usage.api.0001", EventType: "cloud.usage.recorded",
		SchemaVersion: datafabric.EnvelopeSchemaVersion, Product: "cloud", Service: "usage",
		AggregateID: "usage.cloud.api.0001", Actor: datafabric.Actor{ActorID: "actor.wallet.0001", AccountID: "account.wallet.0001"},
		CorrelationID: "correlation.billing.api.0001", Sequence: 1, Timestamp: usageEnd, EffectiveAt: usageEnd,
		SourceCommit: "719e101", SourceRelease: "cloud-test", PrivacyClassification: "confidential",
		RetentionClass: "financial-7y", AuditID: "audit.event.cloud.usage.api.0001",
		Source:  datafabric.SourceMetadata{Source: "cloud-meter", AsOf: usageEnd, Version: "1", Status: "authoritative"},
		Payload: payload,
	}
	if err := event.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(event, apiTestKey); err != nil {
		t.Fatal(err)
	}
	plan := datafabric.BillingRatePlan{
		PlanID: "rate-plan.api.0001", Version: "rate-v1.api.0001", Product: "cloud",
		Meter: "compute", Unit: "request", UnitsPerBlock: 100, UserPriceMinor: 10, ProviderCostMinor: 4,
		Asset: "USD", Currency: "USD", ChargeCategory: "compute-data-fee",
		RevenueBoundary: "rated authoritative usage period ended", EffectiveFrom: usageStart.Add(-time.Hour),
		SourceCommit: "client-value-replaced", SourceRelease: "client-value-replaced", AuditID: "audit.billing.plan.api.0001",
	}
	body, _ := json.Marshal(plan)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/billing/rate-plans", body, "pay"))
	if response.Code != http.StatusForbidden || len(store.BillingRatePlans()) != 0 {
		t.Fatalf("cross-product Billing rate authority was accepted: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/billing/rate-plans", body, "cloud"))
	if response.Code != http.StatusCreated || len(store.BillingRatePlans()) != 1 || store.BillingRatePlans()[0].SourceCommit != "719e1018267ed5a53e6fae5211c5fd8a1503c35c" {
		t.Fatalf("authoritative Billing rate was not registered: %d %s", response.Code, response.Body.String())
	}
	request := datafabric.BillingSettlementRequest{
		SettlementID: "billing.settlement.api.0001", UsageEventID: event.EventID,
		RatePlanID: plan.PlanID, RatePlanVersion: plan.Version, JournalEntryID: "journal.billing.api.0001",
		ProviderAccountID: "account.billing.provider.api.0001", ProviderCostAccountID: "account.billing.cost.api.0001",
		ProtocolRevenueAccountID: "account.billing.revenue.api.0001", RecordedAt: usageEnd.Add(time.Second),
		SourceCommit: "client-value-replaced", SourceRelease: "client-value-replaced", AuditID: "audit.billing.settlement.api.0001",
		FeeConsent: &datafabric.FeeConsent{ConsentID: "consent.billing.api.0001", FeeScheduleVersion: plan.Version, AcceptedAt: usageStart, MaximumAmountMinor: 30, Basis: "metered price accepted before usage"},
	}
	body, _ = json.Marshal(request)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/billing/settlements", body, "cloud"))
	if response.Code != http.StatusCreated || len(store.BillingSettlements()) != 1 || len(store.Journal()) != 1 || !strings.Contains(response.Body.String(), `"userChargeMinor":30`) {
		t.Fatalf("usage, Billing, and Ledger were not atomically settled: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/billing/settlements", body, "cloud"))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), string(datafabric.CodeBillingAlreadySettled)) {
		t.Fatalf("duplicate usage settlement was accepted: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/billing/settlements", nil, "cloud"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), request.SettlementID) {
		t.Fatalf("authorized Billing settlement read is incomplete: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodGet, "/v1/audit/export", nil, "cloud"))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), plan.PlanID) || !strings.Contains(response.Body.String(), request.SettlementID) {
		t.Fatalf("Billing audit export is incomplete: %d %s", response.Code, response.Body.String())
	}
}

func TestJournalCorrectionUsesDedicatedAuthorizedRoute(t *testing.T) {
	server, store := newTestServer(t, fakeAuthorizer{})
	event := apiEvent(t)
	if err := store.Append(event, apiTestKey); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 22, 15, 5, 0, 0, time.UTC)
	original := datafabric.JournalEntry{
		EntryID: "journal.api.original.0001", CorrelationID: event.CorrelationID, EventID: event.EventID,
		EffectiveAt: now, RecordedAt: now, Description: "original journal", RevenueBoundary: "payment-settled",
		SourceCommit: "719e101", SourceRelease: "data-fabric-testnet-v0", AuditID: "audit.api.original.0001",
		Postings: []datafabric.Posting{
			{AccountID: event.Actor.AccountID, Asset: "USD", Currency: "USD", Side: datafabric.Debit, Amount: 100, Category: "refund"},
			{AccountID: "account.provider.api.0001", Asset: "USD", Currency: "USD", Side: datafabric.Credit, Amount: 100, Category: "provider-net"},
		},
	}
	if err := store.PostJournal(original); err != nil {
		t.Fatal(err)
	}
	reversal := original
	reversal.EntryID = "journal.api.reversal.0001"
	reversal.CorrectionOf = original.EntryID
	reversal.Description = "exact reversal"
	reversal.AuditID = "audit.api.reversal.0001"
	reversal.Postings = append([]datafabric.Posting(nil), original.Postings...)
	reversal.Postings[0].Side = datafabric.Credit
	reversal.Postings[1].Side = datafabric.Debit
	body, _ := json.Marshal(reversal)

	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/ledger/journal", body, "pay"))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), string(datafabric.CodeLedgerCorrectionRouteRequired)) {
		t.Fatalf("ordinary journal route accepted a correction: %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	path := "/v1/ledger/journal/" + original.EntryID + "/corrections"
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, path, body, "pay"))
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"status":"reversal-recorded"`) || len(store.Journal()) != 2 {
		t.Fatalf("dedicated correction route did not append reversal: %d %s", response.Code, response.Body.String())
	}

	reversal.EntryID = "journal.api.reversal.0002"
	reversal.AuditID = "audit.api.reversal.0002"
	body, _ = json.Marshal(reversal)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, path, body, "pay"))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), string(datafabric.CodeLedgerDuplicateReversal)) {
		t.Fatalf("duplicate reversal was accepted: %d %s", response.Code, response.Body.String())
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
		{name: "missing-account", mutate: func(value *Principal) { value.AccountID = "" }},
		{name: "noncanonical-account", mutate: func(value *Principal) { value.AccountID = "wallet account" }},
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
	authorizationEvent := event
	authorizationEvent.EventID = "event.pay.authorization.0001"
	authorizationEvent.EventType = "pay.invoice.authorized"
	authorizationEvent.Sequence = 2
	authorizationEvent.Timestamp = event.Timestamp.Add(time.Second)
	authorizationEvent.EffectiveAt = authorizationEvent.Timestamp
	authorizationEvent.Source.AsOf = authorizationEvent.Timestamp
	authorizationEvent.Payload = json.RawMessage(`{"status":"authorized"}`)
	if err := authorizationEvent.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(authorizationEvent, apiTestKey); err != nil {
		t.Fatal(err)
	}
	compensationEvent := event
	compensationEvent.EventID = "event.pay.authorization.voided.0001"
	compensationEvent.EventType = "pay.refund.completed"
	compensationEvent.Sequence = 3
	compensationEvent.Timestamp = event.Timestamp.Add(2 * time.Second)
	compensationEvent.EffectiveAt = compensationEvent.Timestamp
	compensationEvent.Source.AsOf = compensationEvent.Timestamp
	compensationEvent.Payload = json.RawMessage(`{"status":"voided"}`)
	if err := compensationEvent.Sign("key.datafabric.0001", apiTestKey); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(compensationEvent, apiTestKey); err != nil {
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

	missingStep, _ := json.Marshal(map[string]string{"eventId": "event.pay.authorization.missing.0001"})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas/saga.pay.api.0001/steps", missingStep, "pay"))
	if response.Code != http.StatusForbidden {
		t.Fatalf("Saga accepted a missing canonical event: %d %s", response.Code, response.Body.String())
	}
	step, _ := json.Marshal(map[string]string{"eventId": authorizationEvent.EventID})
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
	claim, _ := json.Marshal(map[string]any{"leaseSeconds": 60, "limit": 10})
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, authorizedRequest(t, http.MethodPost, "/v1/sagas/recovery/claims", claim, "pay"))
	var claimed struct {
		Tasks []datafabric.SagaRecoveryTask `json:"tasks"`
	}
	if response.Code != http.StatusOK {
		t.Fatalf("Saga recovery claim failed: %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &claimed); err != nil || len(claimed.Tasks) != 1 || claimed.Tasks[0].Compensation != "void-authorization" {
		t.Fatalf("Saga recovery task is invalid: %+v err=%v", claimed, err)
	}
	compensation, _ := json.Marshal(map[string]string{"taskId": claimed.Tasks[0].TaskID, "leaseOwner": claimed.Tasks[0].LeaseOwner, "eventId": compensationEvent.EventID})
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

func producerRequest(t *testing.T, body []byte, timestamp, nonce, keyID string, key []byte) *http.Request {
	t.Helper()
	return producerRequestWithSignature(t, body, timestamp, nonce, keyID, body, key)
}

func producerRequestWithSignature(t *testing.T, body []byte, timestamp, nonce, keyID string, signedBody, key []byte) *http.Request {
	t.Helper()
	signature, err := datafabric.ProducerDeliverySignature(keyID, timestamp, nonce, signedBody, key)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, datafabric.ProducerEventsPath, bytes.NewReader(body))
	request.Header.Set(datafabric.ProducerKeyIDHeader, keyID)
	request.Header.Set(datafabric.ProducerTimestampHeader, timestamp)
	request.Header.Set(datafabric.ProducerNonceHeader, nonce)
	request.Header.Set(datafabric.ProducerSignatureHeader, signature)
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
