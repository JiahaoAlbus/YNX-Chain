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
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const testAccount = "ynx13mn60llmjqdrj90f7kmud80pcs7ds59qf9cl7m"

type fixedAI struct{}

func (fixedAI) Complete(context.Context, string, string) (string, string, string, int64, error) {
	return "YNX AI Gateway", "provider-test", "Sandbox decline explanation for human review only.", 17, nil
}

func newTestService(t *testing.T, provider IssuerProvider, ai AIProvider) (*Service, []byte, []byte, string) {
	t.Helper()
	now := time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC)
	gatewayKey := bytes.Repeat([]byte{0x32}, 32)
	providerKey := bytes.Repeat([]byte{0x61}, 32)
	path := filepath.Join(t.TempDir(), "card-state.json")
	service, err := New(Config{StorePath: path, IntegrityKey: bytes.Repeat([]byte{0x17}, 32), GatewayKey: gatewayKey, ProviderEventKey: providerKey, Provider: provider, AI: ai, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	return service, gatewayKey, providerKey, path
}

func applySandbox(t *testing.T, s *Service) (Application, Card) {
	t.Helper()
	application, err := s.Apply(context.Background(), testAccount, ApplyInput{EligibilityReference: "kyc_sandbox_verified_01", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "application-key-01"})
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.State(testAccount)
	if err != nil || len(state.Cards) != 1 {
		t.Fatalf("sandbox card missing: %+v %v", state, err)
	}
	return application, state.Cards[0]
}

func TestSandboxLifecycleControlsEventsDisputeAndAI(t *testing.T) {
	s, _, providerKey, _ := newTestService(t, NewSandboxProvider(func() time.Time { return time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC) }), fixedAI{})
	application, card := applySandbox(t, s)
	if application.Status != "issued_sandbox" || card.Network != Network || card.Status != "issued_sandbox" || len(card.Last4) != 4 {
		t.Fatalf("unsafe sandbox issuance: %+v %+v", application, card)
	}
	for i, step := range []struct{ action, want string }{{"activate", "active"}, {"freeze", "frozen"}, {"unfreeze", "active"}} {
		next, err := s.Transition(context.Background(), testAccount, card.ID, step.action, fmt.Sprintf("transition-key-%02d", i))
		if err != nil || next.Status != step.want {
			t.Fatalf("%s: %+v %v", step.action, next, err)
		}
		card = next
	}
	updated, err := s.UpdateControls(context.Background(), testAccount, card.ID, ControlsInput{SpendLimitMinor: 12500, Currency: "usd", Online: true, International: false, ATM: false, AllowedMCC: []string{"5812"}, BlockedMCC: []string{"7995"}, AllowedCountries: []string{"US", "JP"}, IdempotencyKey: "controls-key-01"})
	if err != nil || updated.Controls.Currency != "USD" || updated.Controls.SpendLimitMinor != 12500 {
		t.Fatalf("controls: %+v %v", updated, err)
	}
	if _, err := s.UpdateControls(context.Background(), testAccount, card.ID, ControlsInput{SpendLimitMinor: 1, Currency: "USD", IdempotencyKey: "controls-key-01"}); err != ErrConflict {
		t.Fatalf("idempotency mismatch must conflict: %v", err)
	}
	input := ProviderEventInput{EventID: "provider-event-decline-01", ProviderCardID: card.ProviderCardID, Type: "decline", AmountMinor: 4200, Currency: "USD", Merchant: "Sandbox Books", MCC: "5942", Country: "US", ReasonCode: "spend_limit", OccurredAt: time.Date(2026, 7, 18, 5, 59, 0, 0, time.UTC)}
	raw, _ := json.Marshal(input)
	timestamp := time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC)
	signature := hmacHex(providerKey, []byte(strings.Join([]string{ProviderDomain, timestamp.Format(time.RFC3339Nano), hashBytes(raw)}, "\n")))
	event, err := s.AcceptProviderEvent(input, timestamp, signature)
	if err != nil || event.Type != "decline" {
		t.Fatalf("event: %+v %v", event, err)
	}
	if _, err := s.AcceptProviderEvent(input, timestamp, signature); err != ErrConflict {
		t.Fatalf("provider replay must conflict: %v", err)
	}
	stateAfterEvent, err := s.State(testAccount)
	if err != nil || len(stateAfterEvent.Notifications) != 1 || stateAfterEvent.Notifications[0].EventID != event.ID || stateAfterEvent.Notifications[0].Type != "card_decline" {
		t.Fatalf("provider notification missing: %+v %v", stateAfterEvent.Notifications, err)
	}
	dispute, err := s.OpenDispute(testAccount, card.ID, DisputeInput{EventID: event.ID, Reason: "I do not recognize this sandbox authorization.", IdempotencyKey: "dispute-key-01"})
	if err != nil || dispute.Status != "open" {
		t.Fatalf("dispute: %+v %v", dispute, err)
	}
	run, err := s.RunAI(context.Background(), testAccount, AIRunInput{Workflow: "card_decline_explanation", ContextEventID: event.ID, OutputLanguage: "ar", Permission: "allow_once"})
	if err != nil || run.Status != "review" || run.Draft == "" {
		t.Fatalf("AI review: %+v %v", run, err)
	}
	reviewed, err := s.ReviewAI(testAccount, run.ID, "apply")
	if err != nil || reviewed.Status != "reviewed" {
		t.Fatalf("AI decision: %+v %v", reviewed, err)
	}
	final, _ := s.State(testAccount)
	if final.Cards[0].Status != "active" || final.Cards[0].Controls.SpendLimitMinor != 12500 {
		t.Fatal("AI review mutated financial controls")
	}
	if len(final.Audit) < 10 {
		t.Fatalf("audit incomplete: %d", len(final.Audit))
	}
	replacement, err := s.Transition(context.Background(), testAccount, card.ID, "replace", "replacement-key-01")
	if err != nil || replacement.ReplacementFor != card.ID || replacement.Last4 == card.Last4 {
		t.Fatalf("replacement: %+v %v", replacement, err)
	}
}

func TestProviderUnavailablePendingRejectedAndNoSensitiveData(t *testing.T) {
	s, _, _, _ := newTestService(t, UnavailableProvider{ProviderName: "issuer-not-configured"}, nil)
	application, err := s.Apply(context.Background(), testAccount, ApplyInput{EligibilityReference: "external_kyc_reference_01", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "application-unavailable-01"})
	if err != nil || application.Status != "provider_unavailable" {
		t.Fatalf("unavailable: %+v %v", application, err)
	}
	state, _ := s.State(testAccount)
	if len(state.Cards) != 0 || state.Eligibility == nil || state.Eligibility.Status != "provider_unavailable" {
		t.Fatalf("unavailable state fabricated card: %+v", state)
	}
	s2, _, _, _ := newTestService(t, NewSandboxProvider(nil), nil)
	pending, err := s2.Apply(context.Background(), testAccount, ApplyInput{EligibilityReference: "manual_review_reference_01", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "application-pending-01"})
	if err != nil || pending.Status != "pending_review" {
		t.Fatalf("pending review: %+v %v", pending, err)
	}
	rejected, err := s2.Apply(context.Background(), testAccount, ApplyInput{EligibilityReference: "kyc_rejected_reference_01", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "application-rejected-01"})
	if err != nil || rejected.Status != "rejected" {
		t.Fatalf("rejected: %+v %v", rejected, err)
	}
	raw, _ := json.Marshal(state)
	lower := strings.ToLower(string(raw))
	testPAN := strings.Repeat("4111", 4)
	for _, forbidden := range []string{testPAN, "cvv", "pin\"", "trackdata", "magneticstripe", "passportimage", "identitydocument"} {
		if strings.Contains(lower, forbidden) {
			t.Fatalf("sensitive field leaked: %s", forbidden)
		}
	}
}

func TestHealthReadinessAndVersionExposeTruthfulDependencyState(t *testing.T) {
	unavailable, _, _, _ := newTestService(t, UnavailableProvider{ProviderName: "issuer-not-configured"}, nil)
	server := httptest.NewServer(NewServer(unavailable, buildinfo.Info{Commit: "card-commit", Release: "card-release", BuildTime: "2026-07-18T06:00:00Z"}).Handler())
	defer server.Close()

	assertJSONStatus := func(path string, wantStatus int, assertions func(map[string]any)) {
		t.Helper()
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != wantStatus {
			t.Fatalf("%s status = %d, want %d", path, response.StatusCode, wantStatus)
		}
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		assertions(body)
	}

	assertJSONStatus("/health", http.StatusOK, func(body map[string]any) {
		if body["ok"] != true || body["status"] != "degraded" || body["issuerAvailable"] != false || body["cardCapability"] != "provider_unavailable" {
			t.Fatalf("health fabricated issuer readiness: %+v", body)
		}
	})
	assertJSONStatus("/ready", http.StatusServiceUnavailable, func(body map[string]any) {
		if body["ready"] != false || body["failureSemantics"] != "fail_closed" || body["sensitiveDataMode"] != "provider_hosted" {
			t.Fatalf("readiness did not fail closed: %+v", body)
		}
	})
	assertJSONStatus("/version", http.StatusOK, func(body map[string]any) {
		build, ok := body["build"].(map[string]any)
		if !ok || build["commit"] != "card-commit" || body["stateVersion"] != float64(StateVersion) {
			t.Fatalf("version response incomplete: %+v", body)
		}
	})

	sandbox, _, _, _ := newTestService(t, NewSandboxProvider(nil), nil)
	sandboxServer := httptest.NewServer(NewServer(sandbox, buildinfo.Info{}).Handler())
	defer sandboxServer.Close()
	response, err := http.Get(sandboxServer.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("sandbox readiness status = %d", response.StatusCode)
	}
}

func TestGatewayAssertionExactBindingReplayTamperAndStrictJSON(t *testing.T) {
	s, gatewayKey, _, _ := newTestService(t, NewSandboxProvider(nil), nil)
	server := httptest.NewServer(NewServer(s, buildinfo.Info{Commit: "test-commit", Release: "test"}).Handler())
	defer server.Close()
	body := []byte(`{"eligibilityReference":"kyc_sandbox_verified_02","legalConsentVersion":"card-testnet-v1","idempotencyKey":"gateway-application-01"}`)
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications", bytes.NewReader(body))
	assertion := testAssertion("gateway-nonce-0001")
	signRequest(t, request, body, assertion, gatewayKey)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("Gateway request: %d", response.StatusCode)
	}
	_ = response.Body.Close()
	replay, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications", bytes.NewReader(body))
	signRequest(t, replay, body, assertion, gatewayKey)
	response, _ = http.DefaultClient.Do(replay)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replay accepted: %d", response.StatusCode)
	}
	_ = response.Body.Close()
	tampered, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications", bytes.NewReader(body))
	bad := testAssertion("gateway-nonce-0002")
	bad.ClientID = "ynx-pay-v1"
	signRequest(t, tampered, body, bad, gatewayKey)
	response, _ = http.DefaultClient.Do(tampered)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cross-product assertion accepted: %d", response.StatusCode)
	}
	_ = response.Body.Close()
	testPAN := strings.Repeat("4111", 4)
	unknown := []byte(fmt.Sprintf(`{"eligibilityReference":"kyc_sandbox_verified_03","legalConsentVersion":"card-testnet-v1","idempotencyKey":"gateway-application-02","pan":%q}`, testPAN))
	strict, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/card/applications", bytes.NewReader(unknown))
	signRequest(t, strict, unknown, testAssertion("gateway-nonce-0003"), gatewayKey)
	response, _ = http.DefaultClient.Do(strict)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown sensitive field accepted: %d", response.StatusCode)
	}
	_ = response.Body.Close()
}

func TestRestartTamperAndConcurrentIdempotency(t *testing.T) {
	now := time.Date(2026, 7, 18, 6, 0, 0, 0, time.UTC)
	integrity := bytes.Repeat([]byte{0x17}, 32)
	gateway := bytes.Repeat([]byte{0x32}, 32)
	providerKey := bytes.Repeat([]byte{0x61}, 32)
	path := filepath.Join(t.TempDir(), "state.json")
	config := Config{StorePath: path, IntegrityKey: integrity, GatewayKey: gateway, ProviderEventKey: providerKey, Provider: NewSandboxProvider(func() time.Time { return now }), Now: func() time.Time { return now }}
	s, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan Application, 12)
	errorsCh := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := s.Apply(context.Background(), testAccount, ApplyInput{EligibilityReference: "kyc_sandbox_concurrent_01", LegalConsentVersion: "card-testnet-v1", IdempotencyKey: "concurrent-application-01"})
			results <- out
			errorsCh <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errorsCh)
	id := ""
	for err := range errorsCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	for result := range results {
		if id == "" {
			id = result.ID
		} else if result.ID != id {
			t.Fatalf("idempotency produced multiple applications")
		}
	}
	restarted, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	state, err := restarted.State(testAccount)
	if err != nil || len(state.Applications) != 1 || len(state.Cards) != 1 {
		t.Fatalf("restart state: %+v %v", state, err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)/2] ^= 1
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(config); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered state accepted: %v", err)
	}
}

func testAssertion(nonce string) GatewayAssertion {
	return GatewayAssertion{Account: testAccount, SessionID: "gateway-session-00000001", DeviceID: "device-key-reference-0001", ProductID: ProductID, ClientID: ClientID, BundleID: BundleID, Callback: Callback, ChainID: "ynx_6423-1", Scopes: append([]string(nil), CardScopes...), RequestDigest: strings.Repeat("a", 64), IssuedAt: time.Date(2026, 7, 18, 5, 59, 0, 0, time.UTC), ExpiresAt: time.Date(2026, 7, 18, 6, 4, 0, 0, time.UTC), Nonce: nonce}
}
func signRequest(t *testing.T, request *http.Request, body []byte, a GatewayAssertion, key []byte) {
	t.Helper()
	signature, err := SignGatewayRequest(key, request, body, a)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-YNX-Account", a.Account)
	request.Header.Set("X-YNX-Session-ID", a.SessionID)
	request.Header.Set("X-YNX-Device-ID", a.DeviceID)
	request.Header.Set("X-YNX-Product", a.ProductID)
	request.Header.Set("X-YNX-Client", a.ClientID)
	request.Header.Set("X-YNX-Bundle", a.BundleID)
	request.Header.Set("X-YNX-Callback", a.Callback)
	request.Header.Set("X-YNX-Chain", a.ChainID)
	request.Header.Set("X-YNX-Scopes", strings.Join(a.Scopes, " "))
	request.Header.Set("X-YNX-Request-Digest", a.RequestDigest)
	request.Header.Set("X-YNX-Issued-At", a.IssuedAt.Format(time.RFC3339Nano))
	request.Header.Set("X-YNX-Expires-At", a.ExpiresAt.Format(time.RFC3339Nano))
	request.Header.Set("X-YNX-Nonce", a.Nonce)
	request.Header.Set("X-YNX-Gateway-Signature", signature)
	request.Header.Set("Content-Type", "application/json")
}
