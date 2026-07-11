package aigateway

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
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/api"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const testAccessKey = "local-ai-gateway-access-key"
const testUpstreamKey = "local-ai-gateway-upstream-key"

func TestGatewayRequiresProviderAndAccessKeys(t *testing.T) {
	_, err := New(Config{ChainURL: "http://127.0.0.1:6420", ProviderURL: "https://provider.example", Model: "test"})
	if err == nil || !strings.Contains(err.Error(), "OPENAI_API_KEY") {
		t.Fatalf("expected provider key error, got %v", err)
	}
	_, err = New(Config{ChainURL: "http://127.0.0.1:6420", ProviderURL: "https://provider.example", ProviderAPIKey: "provider-key", Model: "test"})
	if err == nil || !strings.Contains(err.Error(), "YNX_AI_GATEWAY_API_KEY") {
		t.Fatalf("expected access key error, got %v", err)
	}
	_, err = New(Config{ChainURL: "http://127.0.0.1:6420", ProviderURL: "https://provider.example", ProviderAPIKey: "provider-key", Model: "test", AccessAPIKey: testAccessKey})
	if err == nil || !strings.Contains(err.Error(), "YNX_AI_GATEWAY_UPSTREAM_KEY") {
		t.Fatalf("expected upstream key error, got %v", err)
	}
}

func TestGatewayHealthAuthProxyAndAudit(t *testing.T) {
	chainServer := newChainServer(t)
	provider := newProviderServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, provider.URL, auditPath, 20)
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
	if resp.StatusCode != http.StatusOK || !health.OK || health.ChainID != 6423 || health.NativeSymbol != "YNXT" || health.Build.Commit != "abc123" {
		t.Fatalf("unexpected health status=%d body=%+v", resp.StatusCode, health)
	}
	if health.TruthfulStatus != "chain-context-and-provider-backed-ai-gateway" || !health.ProviderConfigured {
		t.Fatalf("health does not identify real gateway dependencies: %+v", health)
	}

	resp, err = http.Get(server.URL + "/ai/stream?session=unauthorized&q=status")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized || resp.Header.Get("X-Request-ID") == "" {
		t.Fatalf("expected unauthorized request with request ID, got %d", resp.StatusCode)
	}
	_ = resp.Body.Close()

	var proposal map[string]any
	doGatewayJSON(t, http.MethodPost, server.URL+"/ai/actions", map[string]any{
		"sessionId": "gateway-session", "requester": "gateway-user", "scope": "sensitive_data", "actionType": "export evidence", "description": "Export protected evidence",
	}, http.StatusCreated, &proposal)
	if proposal["sensitive"] != true || proposal["executable"] != false || proposal["auditHash"] == "" {
		t.Fatalf("unexpected proxied action proposal: %v", proposal)
	}

	metrics, err := http.Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metricsBody, _ := io.ReadAll(metrics.Body)
	_ = metrics.Body.Close()
	if !bytes.Contains(metricsBody, []byte("ynx_ai_gateway_requests_total")) || !bytes.Contains(metricsBody, []byte(`native_symbol="YNXT"`)) {
		t.Fatalf("missing gateway metrics: %s", metricsBody)
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(audit, []byte(`"outcome":"unauthorized"`)) || !bytes.Contains(audit, []byte(`"path":"/ai/actions"`)) || bytes.Contains(audit, []byte(testAccessKey)) {
		t.Fatalf("unexpected audit log: %s", audit)
	}
}

func TestGatewayConcurrentSessionsAreIsolated(t *testing.T) {
	chainServer := newChainServer(t)
	provider := newProviderServer(t)
	auditPath := t.TempDir() + "/audit.jsonl"
	service := newTestService(t, chainServer.URL, provider.URL, auditPath, 100)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	const count = 16
	var wg sync.WaitGroup
	errs := make(chan error, count)
	for i := 0; i < count; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			session := fmt.Sprintf("session-%02d", i)
			query := fmt.Sprintf("query-%02d", i)
			req, _ := http.NewRequest(http.MethodGet, server.URL+"/ai/stream?session="+session+"&q="+query, nil)
			req.Header.Set("X-YNX-AI-Key", testAccessKey)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				errs <- err
				return
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(session)) || !bytes.Contains(body, []byte(query)) {
				errs <- fmt.Errorf("session %s received bad stream status=%d body=%s", session, resp.StatusCode, body)
				return
			}
			other := fmt.Sprintf("query-%02d", (i+1)%count)
			if bytes.Contains(body, []byte(other)) {
				errs <- fmt.Errorf("session %s leaked %s: %s", session, other, body)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}

	audit, err := os.ReadFile(auditPath)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < count; i++ {
		query := fmt.Sprintf("query-%02d", i)
		if bytes.Contains(audit, []byte(query)) {
			t.Fatalf("audit log stored raw prompt %q: %s", query, audit)
		}
		if !bytes.Contains(audit, []byte(PromptHash(query))) {
			t.Fatalf("audit log missing prompt hash for %q", query)
		}
	}
}

func TestGatewayRateLimit(t *testing.T) {
	chainServer := newChainServer(t)
	provider := newProviderServer(t)
	service := newTestService(t, chainServer.URL, provider.URL, t.TempDir()+"/audit.jsonl", 1)
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()

	for i, expected := range []int{http.StatusOK, http.StatusTooManyRequests} {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/ai/stream?session=rate&q=query-%d", server.URL, i), nil)
		req.Header.Set("Authorization", "Bearer "+testAccessKey)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != expected {
			t.Fatalf("request %d expected %d got %d", i, expected, resp.StatusCode)
		}
	}
}

func newChainServer(t *testing.T) *httptest.Server {
	t.Helper()
	devnet := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	server := httptest.NewServer(api.NewServerWithConfig(devnet, api.ServerConfig{AIGatewayUpstreamKey: testUpstreamKey}))
	direct, err := http.Post(server.URL+"/ai/actions", "application/json", strings.NewReader(`{"sessionId":"bypass","requester":"bypass","scope":"status_read","actionType":"summarize","description":"bypass gateway"}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = direct.Body.Close()
	if direct.StatusCode != http.StatusUnauthorized {
		t.Fatalf("configured chain AI route allowed direct bypass: %d", direct.StatusCode)
	}
	t.Cleanup(server.Close)
	return server
}

func newProviderServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer local-provider-key" || r.Header.Get("X-Request-ID") == "" {
			http.Error(w, "bad provider request", http.StatusBadRequest)
			return
		}
		var input providerRequest
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		user := input.Messages[len(input.Messages)-1].Content
		sessionContext := input.Messages[len(input.Messages)-2].Content
		response := providerResponse{}
		response.Choices = append(response.Choices, struct {
			Message providerMessage `json:"message"`
		}{Message: providerMessage{Role: "assistant", Content: "provider answer for " + user + " using " + sessionContext}})
		_ = json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(server.Close)
	return server
}

func newTestService(t *testing.T, chainURL, providerURL, auditPath string, maxRequests int) *Service {
	t.Helper()
	service, err := New(Config{
		ChainURL: chainURL, ProviderURL: providerURL, ProviderAPIKey: "local-provider-key", Model: "local-test-model",
		AccessAPIKey: testAccessKey, UpstreamKey: testUpstreamKey, AuditLog: auditPath, Window: time.Minute, MaxRequests: maxRequests,
	})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func doGatewayJSON(t *testing.T, method, url string, body any, expected int, out any) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-AI-Key", testAccessKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != expected {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected %d got %d: %s", expected, resp.StatusCode, body)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
}
