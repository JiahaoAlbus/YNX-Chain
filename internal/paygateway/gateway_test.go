package paygateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const (
	testAPIKey      = "local-pay-api-key"
	testUpstreamKey = "local-pay-upstream-key"
	testWebhookKey  = "local-pay-webhook-signing-key"
	testMerchantID  = "merchant_gateway_test"
)

func TestGatewayRequiresDedicatedSecrets(t *testing.T) {
	base := Config{ChainURL: "http://127.0.0.1:6420"}
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_MERCHANT_ID") {
		t.Fatalf("expected merchant error, got %v", err)
	}
	base.MerchantID = testMerchantID
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_API_KEY") {
		t.Fatalf("expected API key error, got %v", err)
	}
	base.APIKey = testAPIKey
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_GATEWAY_UPSTREAM_KEY") {
		t.Fatalf("expected upstream key error, got %v", err)
	}
	base.UpstreamKey = testUpstreamKey
	if _, err := New(base); err == nil || !strings.Contains(err.Error(), "YNX_PAY_WEBHOOK_SIGNING_KEY") {
		t.Fatalf("expected webhook key error, got %v", err)
	}
	base.WebhookSigningKey = testWebhookKey
	base.ChainURL = "http://ynx-chaind:6420"
	if _, err := New(base); err != nil {
		t.Fatalf("expected private service DNS URL to be accepted, got %v", err)
	}
}

func TestGatewayHealthAuthPayFlowAndRedactedAudit(t *testing.T) {
	chainServer := newChainServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, auditPath, 30)
	server := httptest.NewServer(NewServerWithBuild(service, buildinfo.Info{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-11T00:00:00Z"}).Handler())
	defer server.Close()

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health Health
	if err := json.NewDecoder(resp.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !health.OK || health.Service != "ynx-payd" || health.ChainID != 6423 || health.NativeSymbol != "YNXT" || health.Build.Commit != "abc123" || !health.MerchantConfigured || !health.SigningConfigured {
		t.Fatalf("unexpected health status=%d body=%+v", resp.StatusCode, health)
	}

	resp, err = http.Post(server.URL+"/pay/intents", "application/json", strings.NewReader(`{"amount":50,"idempotencyKey":"unauthorized"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("X-Request-ID") == "" {
		t.Fatalf("expected unauthorized with request ID, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	var intent map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"amount": 50, "callbackUrl": "https://merchant.example/callback", "idempotencyKey": "intent-key-1"}, http.StatusCreated, &intent)
	if intent["merchant"] != testMerchantID || intent["currency"] != "YNXT" || intent["id"] == "" {
		t.Fatalf("unexpected intent: %v", intent)
	}
	intentID := intent["id"].(string)
	var replay map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/intents", map[string]any{"amount": 999, "idempotencyKey": "intent-key-1"}, http.StatusCreated, &replay)
	if replay["id"] != intentID || replay["amount"] != intent["amount"] {
		t.Fatalf("idempotency replay changed intent: %v original %v", replay, intent)
	}

	var invoice map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/invoices", map[string]any{"intentId": intentID, "dueInHours": 12, "idempotencyKey": "invoice-key-1"}, http.StatusCreated, &invoice)
	if invoice["intentId"] != intentID || invoice["id"] == "" {
		t.Fatalf("unexpected invoice: %v", invoice)
	}

	var webhook map[string]any
	doPayJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "idempotencyKey": "webhook-key-1"}, http.StatusCreated, &webhook)
	if webhook["signature"] == "" || webhook["algorithm"] != "hmac-sha256" || webhook["replaySafe"] != true {
		t.Fatalf("unexpected webhook signature: %v", webhook)
	}
	doPayJSON(t, http.MethodPost, server.URL+"/pay/webhook-signatures", map[string]any{"intentId": intentID, "eventType": "payment_intent.created", "idempotencyKey": "webhook-key-2", "signingKey": "client-supplied-secret"}, http.StatusBadRequest, nil)

	var events map[string]any
	doPayJSON(t, http.MethodGet, server.URL+"/pay/events?intentId="+intentID, nil, http.StatusOK, &events)
	if len(events["events"].([]any)) < 3 {
		t.Fatalf("expected persistent Pay events, got %v", events)
	}

	metrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, _ := io.ReadAll(metrics.Body)
	_ = metrics.Body.Close()
	if !bytes.Contains(metricsBody, []byte("ynx_pay_gateway_requests_total")) || !bytes.Contains(metricsBody, []byte(`native_symbol="YNXT"`)) {
		t.Fatalf("missing metrics: %s", metricsBody)
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{testAPIKey, testUpstreamKey, testWebhookKey, "client-supplied-secret", "merchant.example/callback"} {
		if bytes.Contains(audit, []byte(secret)) {
			t.Fatalf("audit contains sensitive value %q: %s", secret, audit)
		}
	}
	if !bytes.Contains(audit, []byte(`"outcome":"unauthorized"`)) || !bytes.Contains(audit, []byte(`"outcome":"accepted"`)) || !bytes.Contains(audit, []byte(`"outcome":"proxied"`)) {
		t.Fatalf("audit outcomes missing: %s", audit)
	}
}

func TestGatewayRateLimitAndBodyLimit(t *testing.T) {
	chainServer := newChainServer(t)
	service := newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 1)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	for i, expected := range []int{http.StatusOK, http.StatusTooManyRequests} {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/pay/events?attempt=%d", server.URL, i), nil)
		req.Header.Set("Authorization", "Bearer "+testAPIKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != expected {
			t.Fatalf("request %d expected %d got %d", i, expected, resp.StatusCode)
		}
	}

	service = newTestService(t, chainServer.URL, t.TempDir()+"/audit.jsonl", 5)
	server2 := httptest.NewServer(NewServer(service).Handler())
	defer server2.Close()
	req, _ := http.NewRequest(http.MethodPost, server2.URL+"/pay/intents", strings.NewReader(`{"idempotencyKey":"large","padding":"`+strings.Repeat("x", MaxBodyBytes)+`"}`))
	req.Header.Set("X-YNX-Pay-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resp.StatusCode)
	}
}

func newChainServer(t *testing.T) *httptest.Server {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{PayGatewayUpstreamKey: testUpstreamKey}))
	direct, err := http.Post(server.URL+"/pay/intents", "application/json", strings.NewReader(`{"merchant":"bypass","amount":1,"idempotencyKey":"bypass"}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = direct.Body.Close()
	if direct.StatusCode != http.StatusUnauthorized {
		t.Fatalf("configured chain Pay route allowed direct bypass: %d", direct.StatusCode)
	}
	t.Cleanup(server.Close)
	return server
}

func newTestService(t *testing.T, chainURL, auditPath string, maxRequests int) *Service {
	t.Helper()
	service, err := New(Config{ChainURL: chainURL, MerchantID: testMerchantID, APIKey: testAPIKey, UpstreamKey: testUpstreamKey, WebhookSigningKey: testWebhookKey, AuditLog: auditPath, Window: time.Minute, MaxRequests: maxRequests})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func doPayJSON(t *testing.T, method, target string, body any, expected int, out any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, target, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Pay-Key", testAPIKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		responseBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected %d got %d: %s", expected, resp.StatusCode, responseBody)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
