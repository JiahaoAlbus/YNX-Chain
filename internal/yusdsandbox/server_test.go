package yusdsandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestServerAuthStrictJSONAndTruthfulHealth(t *testing.T) {
	service, _ := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), APIKey: "test-yusd-api-key-123456"})
	server := httptest.NewServer(NewServer(service).Handler())
	defer server.Close()
	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var health map[string]any
	json.NewDecoder(resp.Body).Decode(&health)
	resp.Body.Close()
	if health["testnetOnly"] != true || health["realityValue"] != false || health["externalReserveAttested"] != false || health["productionReady"] != false {
		t.Fatalf("health overclaimed: %+v", health)
	}
	payload, _ := json.Marshal(MutationRequest{IdempotencyKey: "reserve-0001", Amount: 1000, EvidenceHash: strings.Repeat("d", 64)})
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/yusd/reserve-deposits", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response, _ := http.DefaultClient.Do(request)
	if response.StatusCode != 401 {
		t.Fatalf("unauthorized status=%d", response.StatusCode)
	}
	response.Body.Close()
	request, _ = http.NewRequest(http.MethodPost, server.URL+"/yusd/reserve-deposits", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-YUSD-Sandbox-Key", "test-yusd-api-key-123456")
	response, _ = http.DefaultClient.Do(request)
	if response.StatusCode != 201 {
		t.Fatalf("authorized status=%d", response.StatusCode)
	}
	response.Body.Close()
	request, _ = http.NewRequest(http.MethodPost, server.URL+"/yusd/reserve-deposits", bytes.NewReader(append(payload, []byte(`{}`)...)))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-YUSD-Sandbox-Key", "test-yusd-api-key-123456")
	response, _ = http.DefaultClient.Do(request)
	if response.StatusCode != 400 {
		t.Fatalf("multiple JSON status=%d", response.StatusCode)
	}
	response.Body.Close()
}
