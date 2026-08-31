package quantlab

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	req, _ = http.NewRequest("POST", server.URL+"/v1/risk/kill", strings.NewReader(`{"reason":"operator test","unknown":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	r, _ = server.Client().Do(req)
	if r.StatusCode != 400 {
		t.Fatalf("unknown field=%d", r.StatusCode)
	}
}

func TestHealthAndVersionDiscloseFilesystemSnapshotIsNotMultiInstance(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	for _, path := range []string{"/health", "/version"} {
		response, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Storage struct {
				Backend                      string `json:"backend"`
				RestartPersistent            bool   `json:"restartPersistent"`
				CrossProcessSharedFilesystem bool   `json:"crossProcessSharedFilesystem"`
				MultiInstance                bool   `json:"multiInstance"`
				ProductionDatabaseRequired   bool   `json:"productionDatabaseRequired"`
			} `json:"storage"`
		}
		err = json.NewDecoder(response.Body).Decode(&payload)
		_ = response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusOK || payload.Storage.Backend != "filesystem_json_snapshot" || !payload.Storage.RestartPersistent || !payload.Storage.CrossProcessSharedFilesystem || payload.Storage.MultiInstance || !payload.Storage.ProductionDatabaseRequired {
			t.Fatalf("path=%s status=%d storage=%+v", path, response.StatusCode, payload.Storage)
		}
	}
}

func TestSnapshotDisclosesSourceCoverageAndSingleHostDegradation(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/v1/snapshot")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload struct {
		SourceMetadata SnapshotSourceMetadata `json:"sourceMetadata"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || payload.SourceMetadata.Source != "ynx-quant-authoritative-local-state" || payload.SourceMetadata.Classification != "testnet" || payload.SourceMetadata.Status != "degraded_single_host" || payload.SourceMetadata.Coverage == "" || payload.SourceMetadata.AsOf.IsZero() {
		t.Fatalf("status=%d metadata=%+v", response.StatusCode, payload.SourceMetadata)
	}
	if multiInstance, _ := payload.SourceMetadata.Storage["multiInstance"].(bool); multiInstance {
		t.Fatalf("filesystem snapshot overclaimed multi-instance state: %+v", payload.SourceMetadata.Storage)
	}
}

func TestReadyRejectsFilesystemSnapshotForDeployableQuantService(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload struct {
		Status  string `json:"status"`
		Storage struct {
			Backend       string `json:"backend"`
			MultiInstance bool   `json:"multiInstance"`
		} `json:"storage"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusServiceUnavailable || payload.Status != "not_ready" || payload.Storage.Backend != "filesystem_json_snapshot" || payload.Storage.MultiInstance {
		t.Fatalf("filesystem readiness overclaimed deployability: status=%d payload=%+v", response.StatusCode, payload)
	}
}

func TestReadyAcceptsMultiInstancePostgresStore(t *testing.T) {
	service := &Service{store: conflictQuantStateStore{}, state: newQuantState()}
	server := httptest.NewServer(NewServer(service))
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var payload struct {
		Status  string `json:"status"`
		Storage struct {
			Backend       string `json:"backend"`
			MultiInstance bool   `json:"multiInstance"`
		} `json:"storage"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || payload.Status != "ready" || payload.Storage.Backend != "postgresql" || !payload.Storage.MultiInstance {
		t.Fatalf("durable readiness was not reported: status=%d payload=%+v", response.StatusCode, payload)
	}
}

func TestTenantServerExposesHeaderlessReadinessWithoutOpeningTenantState(t *testing.T) {
	tenantServer, err := NewTenantServer(Config{StatePath: filepath.Join(t.TempDir(), "s.json")}, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer tenantServer.Close()
	server := httptest.NewServer(tenantServer)
	defer server.Close()
	response, err := server.Client().Get(server.URL + "/ready")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status=%d", response.StatusCode)
	}
	tenantServer.mu.Lock()
	defer tenantServer.mu.Unlock()
	if len(tenantServer.servers) != 0 {
		t.Fatalf("readiness opened tenant state: %d", len(tenantServer.servers))
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

func TestWebSocketReconcilesDurableQuantStateChanges(t *testing.T) {
	s, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "s.json")})
	quantServer := NewRoleServer(s, "all")
	quantServer.streamPollInterval = 5 * time.Millisecond
	server := httptest.NewServer(quantServer)
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/stream"
	connection, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	_, firstPayload, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var first map[string]any
	if err := json.Unmarshal(firstPayload, &first); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Kill("stream reconciliation test"); err != nil {
		t.Fatal(err)
	}
	connection.SetReadDeadline(time.Now().Add(time.Second))
	_, secondPayload, err := connection.ReadMessage()
	if err != nil {
		t.Fatal(err)
	}
	var second map[string]any
	if err := json.Unmarshal(secondPayload, &second); err != nil {
		t.Fatal(err)
	}
	if second["type"] != "reconciled" || second["eventId"] == first["eventId"] {
		t.Fatalf("missing durable reconciliation: first=%#v second=%#v", first, second)
	}
	data, ok := second["data"].(map[string]any)
	if !ok {
		t.Fatalf("reconciled snapshot data missing: %#v", second)
	}
	paper, ok := data["paper"].(map[string]any)
	if !ok || paper["KillSwitch"] != true {
		t.Fatalf("reconciled state did not include durable kill switch: %#v", data)
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
	for _, expected := range []string{"ynx_quant_http_requests_total 1", "ynx_quant_kill_switch_activations_total 1", "ynx_quant_kill_switch_active 1", "ynx_quant_reconciliation_delta 0", "ynx_quant_execution_pending_unknown 0", "ynx_quant_storage_backend_info{backend=\"filesystem_json_snapshot\",multi_instance=\"false\"} 1", "ynx_quant_build_info"} {
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
