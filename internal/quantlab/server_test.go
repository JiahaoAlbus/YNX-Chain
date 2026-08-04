package quantlab

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

func TestHTTPWriteBoundaryAndStrictSchema(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	body := `{"reason":"operator test"}`
	r, _ := http.Post(server.URL+"/v1/risk/kill", "application/json", strings.NewReader(body))
	if r.StatusCode != 403 {
		t.Fatalf("missing boundary=%d", r.StatusCode)
	}
	req, _ := http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 200 {
		t.Fatalf("local boundary=%d", r.StatusCode)
	}
	proxied, _ := http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(body))
	proxied.Header.Set("Content-Type", "application/json")
	proxied.Header.Set("X-YNX-Preview-Mode", "local-paper")
	proxied.Header.Set("X-Forwarded-For", "198.51.100.8")
	r, _ = server.Client().Do(proxied)
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("proxied local boundary=%d", r.StatusCode)
	}
	req, _ = http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"operator test","unknown":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 400 {
		t.Fatalf("unknown field=%d", r.StatusCode)
	}
}

func TestPublicResearchIsRemoteSafeAndDoesNotMutateSharedState(t *testing.T) {
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "shared.json"), MarketData: fixtureMarket{bars: bars()}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewRoleServer(service, "research"))
	defer server.Close()
	payload := `{"strategy":{"ID":"public-ma","Name":"Public MA","Family":"transparent","License":"Apache-2.0","Seed":7,"Params":{"fast":3,"slow":8}},"assumptions":{"FeeBPS":10,"SlippageBPS":5,"LatencyBars":1,"ParticipationBPS":1000,"Seed":7,"TrainEnd":10,"WalkForwardWindows":3}}`
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/public/research/backtests/from-market", strings.NewReader(payload))
	req.Header.Set("Origin", "https://quant.ynxweb4.com")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("status=%d body=%s", response.StatusCode, body)
	}
	if len(service.Snapshot()["experiments"].(map[string]Experiment)) != 0 {
		t.Fatal("public research mutated shared service state")
	}
	status, err := server.Client().Get(server.URL + "/v1/public/status")
	if err != nil {
		t.Fatal(err)
	}
	defer status.Body.Close()
	var document map[string]any
	if json.NewDecoder(status.Body).Decode(&document) != nil || document["mode"] != "public_stateless_research" {
		t.Fatalf("status document=%v", document)
	}
}

func TestPublicResearchSupportsConcurrentIsolatedUsers(t *testing.T) {
	service, err := New(Config{StatePath: filepath.Join(t.TempDir(), "shared.json"), MarketData: fixtureMarket{bars: bars()}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewRoleServer(service, "research"))
	defer server.Close()
	payload := `{"strategy":{"ID":"concurrent-ma","Name":"Concurrent MA","Family":"transparent","License":"Apache-2.0","Seed":7,"Params":{"fast":3,"slow":8}},"assumptions":{"FeeBPS":10,"SlippageBPS":5,"LatencyBars":1,"ParticipationBPS":1000,"Seed":7,"TrainEnd":10,"WalkForwardWindows":3}}`
	var wait sync.WaitGroup
	errors := make(chan error, 50)
	for index := 0; index < 50; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response, requestErr := http.Post(server.URL+"/v1/public/research/backtests/from-market", "application/json", strings.NewReader(payload))
			if requestErr != nil {
				errors <- requestErr
				return
			}
			defer response.Body.Close()
			if response.StatusCode != http.StatusCreated {
				errors <- fmt.Errorf("status=%d", response.StatusCode)
			}
		}()
	}
	wait.Wait()
	close(errors)
	for requestErr := range errors {
		t.Fatal(requestErr)
	}
	if len(service.Snapshot()["experiments"].(map[string]Experiment)) != 0 {
		t.Fatal("concurrent public research mutated shared state")
	}
}

func TestWebSocketSnapshotCarriesAuthorityMetadata(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewRoleServer(s, "research"))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/stream"
	headers := http.Header{}
	headers.Set("X-YNX-Request-ID", "websocket-request-1")
	headers.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	connection, _, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_, payload, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope["type"] != "snapshot" || envelope["source"] != "ynx-quant-authoritative-local-state" || envelope["confidence"] != "authoritative" || envelope["version"] != Version || envelope["requestId"] != "websocket-request-1" || envelope["traceId"] != "4bf92f3577b34da6a3ce929d0e0e4736" || envelope["asOf"] == nil || envelope["data"] == nil {
		t.Fatalf("bad envelope: %#v", envelope)
	}
}

func TestServiceRolesExposeOnlyOwnedMutationRoutes(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	cases := []struct{ role, allowed, denied string }{
		{"research", "/v1/backtests", "/v1/risk/kill"},
		{"paper", "/v1/paper/orders", "/v1/backtests"},
		{"risk", "/v1/risk/kill", "/v1/paper/orders"},
	}
	for _, tc := range cases {
		t.Run(tc.role, func(t *testing.T) {
			server := httptest.NewServer(NewRoleServer(s, tc.role))
			defer server.Close()
			for path, wantNotFound := range map[string]bool{tc.allowed: false, tc.denied: true} {
				req, _ := http.NewRequest("POST", server.URL+path, strings.NewReader(`{}`))
				req.Header.Set("X-YNX-Preview-Mode", "local-paper")
				response, err := server.Client().Do(req)
				if err != nil {
					t.Fatal(err)
				}
				_ = response.Body.Close()
				if (response.StatusCode == http.StatusNotFound) != wantNotFound {
					t.Fatalf("path=%s status=%d wantNotFound=%v", path, response.StatusCode, wantNotFound)
				}
			}
		})
	}
}

func TestRequestTraceErrorIDsAndStructuredLogsAreRedacted(t *testing.T) {
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	var logs bytes.Buffer
	server := httptest.NewServer(NewObservedRoleServer(service, "all", &logs))
	defer server.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/missing?token=must-not-appear", nil)
	req.Header.Set("X-YNX-Request-ID", "caller-request-123")
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound || response.Header.Get("X-YNX-Request-ID") != "caller-request-123" || response.Header.Get("X-YNX-Trace-ID") != "4bf92f3577b34da6a3ce929d0e0e4736" || response.Header.Get("X-YNX-Error-ID") == "" {
		t.Fatalf("status=%d headers=%v", response.StatusCode, response.Header)
	}
	var problem map[string]string
	if json.NewDecoder(response.Body).Decode(&problem) != nil || problem["requestId"] != "caller-request-123" || problem["errorId"] != response.Header.Get("X-YNX-Error-ID") || problem["error"] != "route_not_found" {
		t.Fatalf("problem=%v", problem)
	}
	if strings.Contains(logs.String(), "must-not-appear") || strings.Contains(logs.String(), "token=") {
		t.Fatalf("query leaked: %s", logs.String())
	}
	var entry map[string]any
	if json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &entry) != nil || entry["msg"] != "quant_http_request" || entry["requestId"] != "caller-request-123" || entry["route"] != "/" || entry["status"].(float64) != 404 || entry["errorId"] == "" {
		t.Fatalf("log=%v raw=%s", entry, logs.String())
	}
}

func TestInvalidCorrelationIDIsReplacedAndMetricsExposeAlertSignals(t *testing.T) {
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewObservedRoleServer(service, "risk", io.Discard))
	defer server.Close()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"metrics test"}`))
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	req.Header.Set("X-YNX-Request-ID", "../../unsafe")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	generated := response.Header.Get("X-YNX-Request-ID")
	if response.StatusCode != http.StatusOK || generated == "../../unsafe" || !validCorrelationID(generated) {
		t.Fatalf("status=%d requestID=%q", response.StatusCode, generated)
	}
	metricsResponse, err := server.Client().Get(server.URL + "/metrics")
	if err != nil {
		t.Fatal(err)
	}
	metrics, _ := io.ReadAll(metricsResponse.Body)
	_ = metricsResponse.Body.Close()
	text := string(metrics)
	for _, expected := range []string{"ynx_quant_http_requests_total 1", "ynx_quant_kill_switch_activations_total 1", "ynx_quant_kill_switch_active 1", "ynx_quant_reconciliation_delta 0", "ynx_quant_execution_pending_unknown 0", "ynx_quant_build_info"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing %q in %s", expected, text)
		}
	}
}

func TestHostileHTTPAndWebSocketProbesFailClosedWithoutInternalErrors(t *testing.T) {
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	server := httptest.NewServer(NewObservedRoleServer(service, "all", io.Discard))
	defer server.Close()

	hostileOrigin, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"must not run"}`))
	hostileOrigin.Header.Set("X-YNX-Preview-Mode", "local-paper")
	hostileOrigin.Header.Set("Origin", "https://hostile.invalid")
	response, err := server.Client().Do(hostileOrigin)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusForbidden || service.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatalf("origin status=%d", response.StatusCode)
	}

	oversized, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/risk/kill", strings.NewReader(strings.Repeat("x", (8<<20)+1)))
	oversized.Header.Set("X-YNX-Preview-Mode", "local-paper")
	response, err = server.Client().Do(oversized)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), `"error":"invalid_json"`) || strings.Contains(strings.ToLower(string(body)), "too large") {
		t.Fatalf("oversized status=%d body=%s", response.StatusCode, body)
	}

	headers := http.Header{}
	headers.Set("Origin", "https://hostile.invalid")
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/stream"
	connection, handshake, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if connection != nil {
		_ = connection.Close()
	}
	if err == nil || handshake == nil || handshake.StatusCode != http.StatusForbidden {
		t.Fatalf("websocket err=%v response=%v", err, handshake)
	}
}
