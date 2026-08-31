package exchangeproduct

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthDisclosesFileSnapshotIsNotMultiInstance(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.StateBackend != "file_snapshot" || body.MultiInstance {
		t.Fatalf("storage readiness overclaimed multi-instance support: %+v", body)
	}
}
