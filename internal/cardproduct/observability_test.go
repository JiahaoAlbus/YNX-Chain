package cardproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type deterministicCorrelationIDs struct {
	mu     sync.Mutex
	counts map[string]uint64
}

func (d *deterministicCorrelationIDs) Next(kind string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.counts == nil {
		d.counts = map[string]uint64{}
	}
	d.counts[kind]++
	value := d.counts[kind]
	switch kind {
	case "request":
		return fmt.Sprintf("req_%032x", value)
	case "error":
		return fmt.Sprintf("err_%032x", value)
	case "trace":
		return fmt.Sprintf("%032x", value)
	case "span":
		return fmt.Sprintf("%016x", value)
	default:
		return "invalid"
	}
}

type toggleIssuerProvider struct {
	SandboxProvider
	available atomic.Bool
}

func (p *toggleIssuerProvider) Health(context.Context) error {
	if p.available.Load() {
		return nil
	}
	return ErrProviderUnavailable
}

func TestObservabilitySafeErrorsBoundedMetricsAndProviderTransitions(t *testing.T) {
	now := time.Date(2026, 7, 27, 22, 0, 0, 0, time.UTC)
	provider := &toggleIssuerProvider{SandboxProvider: NewSandboxProvider(func() time.Time { return now })}
	provider.available.Store(false)
	gatewayKey := bytes.Repeat([]byte{0xb2}, 32)
	service, err := New(Config{
		StorePath:        filepath.Join(t.TempDir(), "card-state.json"),
		IntegrityKey:     bytes.Repeat([]byte{0xb1}, 32),
		GatewayKey:       gatewayKey,
		ProviderEventKey: bytes.Repeat([]byte{0xb3}, 32),
		Provider:         provider,
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	ids := &deterministicCorrelationIDs{}
	server := httptest.NewServer(NewServerWithObservability(service, buildinfo.Info{Commit: "obs-commit", Release: "obs-test"}, ObservabilityConfig{
		LogWriter:   &logs,
		Now:         func() time.Time { return now },
		IDGenerator: ids.Next,
	}).Handler())
	t.Cleanup(server.Close)

	sensitiveMarker := strings.Repeat("4", 16)
	request, err := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications?pan="+sensitiveMarker, strings.NewReader(`{"pan":"`+sensitiveMarker+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(RequestIDHeader, "req_0123456789abcdef")
	request.Header.Set("traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unexpected unauthorized status: %d", response.StatusCode)
	}
	if got := response.Header.Get(RequestIDHeader); got != "req_0123456789abcdef" {
		t.Fatalf("valid request id was not preserved: %q", got)
	}
	if got := response.Header.Get(TraceIDHeader); got != "11111111111111111111111111111111" {
		t.Fatalf("trace id was not propagated: %q", got)
	}
	if got := response.Header.Get(ErrorCodeHeader); got != "CARD_UNAUTHORIZED" {
		t.Fatalf("unexpected error code header: %q", got)
	}
	if got := response.Header.Get(ErrorIDHeader); !errorIDPattern.MatchString(got) {
		t.Fatalf("invalid error id header: %q", got)
	}
	var errorBody map[string]string
	if err := json.NewDecoder(response.Body).Decode(&errorBody); err != nil {
		t.Fatal(err)
	}
	if errorBody["error"] != "card product authorization failed" || errorBody["code"] != "CARD_UNAUTHORIZED" || errorBody["requestId"] != response.Header.Get(RequestIDHeader) || errorBody["traceId"] != response.Header.Get(TraceIDHeader) || errorBody["errorId"] != response.Header.Get(ErrorIDHeader) {
		t.Fatalf("unsafe or incomplete error body: %#v", errorBody)
	}
	for _, forbidden := range []string{sensitiveMarker, "gateway assertion", "X-YNX-Gateway"} {
		if strings.Contains(strings.ToLower(fmt.Sprint(errorBody)), strings.ToLower(forbidden)) {
			t.Fatalf("error response exposed internal or sensitive detail %q: %#v", forbidden, errorBody)
		}
	}

	invalidIDRequest, err := http.NewRequest(http.MethodGet, server.URL+"/version?account="+sensitiveMarker, nil)
	if err != nil {
		t.Fatal(err)
	}
	invalidIDRequest.Header.Set(RequestIDHeader, sensitiveMarker)
	invalidIDResponse, err := http.DefaultClient.Do(invalidIDRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = invalidIDResponse.Body.Close()
	if got := invalidIDResponse.Header.Get(RequestIDHeader); got == sensitiveMarker || !requestIDPattern.MatchString(got) {
		t.Fatalf("untrusted request id was reflected: %q", got)
	}

	for _, expectedAvailable := range []bool{false, true} {
		provider.available.Store(expectedAvailable)
		healthResponse, err := http.Get(server.URL + "/health")
		if err != nil {
			t.Fatal(err)
		}
		_ = healthResponse.Body.Close()
		if healthResponse.StatusCode != http.StatusOK {
			t.Fatalf("health returned %d", healthResponse.StatusCode)
		}
	}

	applicationBody, err := json.Marshal(ApplyInput{EligibilityReference: "kyc_sandbox_observability", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "observability-application-0001"})
	if err != nil {
		t.Fatal(err)
	}
	applicationRequest, err := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications", bytes.NewReader(applicationBody))
	if err != nil {
		t.Fatal(err)
	}
	applicationRequest.Header.Set(RequestIDHeader, "req_abcdefabcdefabcd")
	applicationRequest.Header.Set("traceparent", "00-55555555555555555555555555555555-6666666666666666-01")
	assertion := GatewayAssertion{
		Account:       testAccount,
		SessionID:     "gateway-session-observability-0001",
		DeviceID:      "device-observability-0001",
		ProductID:     ProductID,
		ClientID:      ClientID,
		BundleID:      BundleID,
		Callback:      Callback,
		ChainID:       "ynx_6423-1",
		Scopes:        append([]string(nil), CardScopes...),
		RequestDigest: strings.Repeat("a", 64),
		IssuedAt:      now.Add(-time.Minute),
		ExpiresAt:     now.Add(4 * time.Minute),
		Nonce:         "observability-gateway-nonce-0001",
	}
	signRequest(t, applicationRequest, applicationBody, assertion, gatewayKey)
	applicationResponse, err := http.DefaultClient.Do(applicationRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = applicationResponse.Body.Close()
	if applicationResponse.StatusCode != http.StatusCreated {
		t.Fatalf("application returned %d", applicationResponse.StatusCode)
	}
	auditID := applicationResponse.Header.Get(AuditIDHeader)
	if auditID == "" {
		t.Fatal("successful mutation did not return an audit id")
	}
	accountState, err := service.State(testAccount)
	if err != nil {
		t.Fatal(err)
	}
	lastAudit := accountState.Audit[len(accountState.Audit)-1]
	if lastAudit.ID != auditID || lastAudit.RequestID != applicationResponse.Header.Get(RequestIDHeader) || lastAudit.TraceID != applicationResponse.Header.Get(TraceIDHeader) {
		t.Fatalf("audit correlation was not persisted: response=%q/%q/%q audit=%+v", auditID, applicationResponse.Header.Get(RequestIDHeader), applicationResponse.Header.Get(TraceIDHeader), lastAudit)
	}

	metricsResponse, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	defer metricsResponse.Body.Close()
	metricsRaw := new(bytes.Buffer)
	if _, err := metricsRaw.ReadFrom(metricsResponse.Body); err != nil {
		t.Fatal(err)
	}
	metrics := metricsRaw.String()
	for _, required := range []string{
		`ynx_card_http_requests_total{method="POST",route="POST /v1/card/applications",status="401"} 1`,
		`ynx_card_issuer_state_known 1`,
		`ynx_card_issuer_available 1`,
		`ynx_card_issuer_state_transitions_total{state="available"} 1`,
	} {
		if !strings.Contains(metrics, required) {
			t.Fatalf("metrics missing %q:\n%s", required, metrics)
		}
	}
	for _, forbidden := range []string{sensitiveMarker, "?pan=", "?account=", "/v1/cards/card_"} {
		if strings.Contains(metrics, forbidden) {
			t.Fatalf("metrics exposed high-cardinality or sensitive value %q:\n%s", forbidden, metrics)
		}
	}

	logText := logs.String()
	for _, forbidden := range []string{sensitiveMarker, "?pan=", "?account=", `"pan"`, "gateway assertion"} {
		if strings.Contains(strings.ToLower(logText), strings.ToLower(forbidden)) {
			t.Fatalf("structured logs exposed %q:\n%s", forbidden, logText)
		}
	}
	var sawError, sawRequest, sawRecovery bool
	for _, line := range strings.Split(strings.TrimSpace(logText), "\n") {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("invalid structured log line %q: %v", line, err)
		}
		switch entry["event"] {
		case "http_error":
			sawError = entry["errorCode"] == "CARD_UNAUTHORIZED" && entry["causeDigest"] != ""
		case "http_request":
			if entry["route"] == "POST /v1/card/applications" && entry["status"] == float64(http.StatusUnauthorized) {
				sawRequest = true
			}
		case "issuer_availability_changed":
			if entry["available"] == true {
				sawRecovery = true
			}
		}
	}
	if !sawError || !sawRequest || !sawRecovery {
		t.Fatalf("missing correlated observability events: error=%v request=%v recovery=%v logs=%s", sawError, sawRequest, sawRecovery, logText)
	}
}

func TestHTTPAIProviderPropagatesRequestAndTraceContext(t *testing.T) {
	var requestID, traceparent, downstreamAuth string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID = r.Header.Get(RequestIDHeader)
		traceparent = r.Header.Get("traceparent")
		downstreamAuth = r.Header.Get("Authorization")
		writeJSON(w, http.StatusOK, map[string]any{"provider": "Test AI", "model": "card-test", "result": "review draft", "units": 7})
	}))
	t.Cleanup(upstream.Close)

	ctx := context.WithValue(context.Background(), requestIDContextKey, "req_0123456789abcdef")
	ctx = context.WithValue(ctx, traceIDContextKey, "33333333333333333333333333333333")
	ctx = context.WithValue(ctx, spanIDContextKey, "4444444444444444")
	apiKey := strings.Repeat("k", 32)
	provider := &HTTPAIProvider{BaseURL: upstream.URL, APIKey: apiKey, Model: "card-test", Client: upstream.Client()}
	providerName, model, result, units, err := provider.Complete(ctx, "decline_explanation", "Explain the sandbox decline")
	if err != nil {
		t.Fatal(err)
	}
	if providerName != "Test AI" || model != "card-test" || result != "review draft" || units != 7 {
		t.Fatalf("unexpected AI result: %q %q %q %d", providerName, model, result, units)
	}
	if requestID != "req_0123456789abcdef" {
		t.Fatalf("request id was not propagated downstream: %q", requestID)
	}
	if traceparent != "00-33333333333333333333333333333333-4444444444444444-01" {
		t.Fatalf("traceparent was not propagated downstream: %q", traceparent)
	}
	if downstreamAuth != "Bearer "+apiKey {
		t.Fatalf("AI authorization behavior changed unexpectedly")
	}
}

func TestAuditIDsRemainCompatibleAndIntegrityBound(t *testing.T) {
	now := time.Date(2026, 7, 27, 23, 0, 0, 0, time.UTC)
	integrity := bytes.Repeat([]byte{0xc1}, 32)
	statePath := filepath.Join(t.TempDir(), "card-state.json")
	service, err := New(Config{
		StorePath:        statePath,
		IntegrityKey:     integrity,
		GatewayKey:       bytes.Repeat([]byte{0xc2}, 32),
		ProviderEventKey: bytes.Repeat([]byte{0xc3}, 32),
		Provider:         NewSandboxProvider(func() time.Time { return now }),
		Now:              func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = applySandbox(t, service)
	snapshot := snapshotValue(t, service)
	if len(snapshot.Audit) == 0 {
		t.Fatal("sandbox lifecycle did not create audit entries")
	}
	for _, entry := range snapshot.Audit {
		if entry.ID == "" || entry.ID != auditIDFromHash(entry.Hash) {
			t.Fatalf("audit id is missing or not bound to its hash: %+v", entry)
		}
	}

	legacyShape := snapshot
	for index := range legacyShape.Audit {
		legacyShape.Audit[index].ID = ""
	}
	payload, err := json.Marshal(legacyShape)
	if err != nil {
		t.Fatal(err)
	}
	envelopeRaw, err := json.MarshalIndent(stateEnvelope{Version: StateVersion, Payload: payload, HMAC: hmacHex(integrity, payload)}, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, append(envelopeRaw, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(statePath, integrity)
	if err != nil {
		t.Fatalf("state written before audit IDs was not compatible: %v", err)
	}
	var normalized Snapshot
	if err := reopened.View(func(value Snapshot) error {
		normalized = value
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, entry := range normalized.Audit {
		if entry.ID != auditIDFromHash(entry.Hash) {
			t.Fatalf("legacy audit id was not deterministically normalized: %+v", entry)
		}
	}

	invalid := normalized
	invalid.Audit[0].ID = "audit_000000000000000000000000"
	if _, err := encodeStateDocument(invalid, integrity); err == nil {
		t.Fatal("audit id not bound to the audit hash was persisted")
	}
}
