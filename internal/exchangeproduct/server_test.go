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

func TestReadyRejectsFileSnapshotForDeployableVenue(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Status        string `json:"status"`
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "not_ready" || body.StateBackend != "file_snapshot" || body.MultiInstance {
		t.Fatalf("file snapshot readiness overclaimed deployability: %+v", body)
	}
}

func TestReadyAcceptsMultiInstanceDurableStore(t *testing.T) {
	service := &Service{store: conflictStateStore{}, state: newState()}
	server := NewServer(service)
	request := httptest.NewRequest(http.MethodGet, "/ready", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Status        string `json:"status"`
		StateBackend  string `json:"stateBackend"`
		MultiInstance bool   `json:"multiInstance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ready" || body.StateBackend != "postgresql" || !body.MultiInstance {
		t.Fatalf("durable backend readiness was not reported: %+v", body)
	}
}

func TestPublicReadsDiscloseSourceCoverageAndFileBackendDegradation(t *testing.T) {
	service, _, _ := newTestService(t)
	server := NewServer(service)
	for _, path := range []string{"/v1/markets", "/v1/orderbook", "/v1/market-data/trades"} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d body=%s", path, response.Code, response.Body.String())
		}
		var body struct {
			SourceMetadata SourceMetadata `json:"sourceMetadata"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.SourceMetadata.Authority != "YNX-owned deterministic order state" || body.SourceMetadata.Classification != "testnet" || body.SourceMetadata.Status != "degraded_single_host" || body.SourceMetadata.MultiInstance || body.SourceMetadata.Coverage == "" || body.SourceMetadata.AsOf.IsZero() {
			t.Fatalf("path=%s invalid source metadata: %+v", path, body.SourceMetadata)
		}
	}
}
