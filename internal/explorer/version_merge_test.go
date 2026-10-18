package explorer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestExplorerVersionPreservesBuildSchemaAndActualLimits(t *testing.T) {
	limits := Limits{MaxConcurrent: 3, MaxRequestsPerSec: 17, MaxStreamClients: 5, QueueWait: 23 * time.Millisecond}
	server := NewServerWithBuildAndLimits(nil, buildinfo.Info{Commit: "integration-fixture", Release: "ynx-chain-fixture"}, limits)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/version", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("version returned %d: %s", response.Code, response.Body.String())
	}
	var result struct {
		Service       string         `json:"service"`
		SchemaVersion int            `json:"schemaVersion"`
		Build         buildinfo.Info `json:"build"`
		StartedAt     time.Time      `json:"startedAt"`
		Limits        struct {
			MaxConcurrent     int    `json:"maxConcurrent"`
			MaxRequestsPerSec int    `json:"maxRequestsPerSec"`
			MaxStreamClients  int    `json:"maxStreamClients"`
			QueueWait         string `json:"queueWait"`
		} `json:"limits"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Service != "ynx-explorerd" || result.SchemaVersion != 2 || result.Build.Commit != "integration-fixture" || result.Build.Release != "ynx-chain-fixture" || !result.StartedAt.Equal(server.startedAt) {
		t.Fatalf("version lost original process identity: %s", response.Body.String())
	}
	if result.Limits.MaxConcurrent != limits.MaxConcurrent || result.Limits.MaxRequestsPerSec != limits.MaxRequestsPerSec || result.Limits.MaxStreamClients != limits.MaxStreamClients || result.Limits.QueueWait != limits.QueueWait.String() {
		t.Fatalf("version lost configured admission/stream limits: %s", response.Body.String())
	}
}
