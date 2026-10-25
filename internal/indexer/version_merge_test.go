package indexer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestMergedIndexerVersionPreservesBothParentContracts(t *testing.T) {
	build := buildinfo.Info{Commit: "fixed-merge-commit", Release: "integration", BuildTime: "2026-10-18T00:00:00Z"}
	limits := Limits{MaxConcurrent: 3, MaxRequestsPerSec: 25, QueueWait: 42 * time.Millisecond}
	// /version is process metadata and must remain available without loading
	// the index or reaching Chain RPC. Both parents register this same GET path.
	server, err := NewServerWithBuildCursorKeyAndLimits(nil, build, nil, limits)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/version", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("merged version route returned %d: %s", recorder.Code, recorder.Body.String())
	}
	var got struct {
		Service       string         `json:"service"`
		SchemaVersion int            `json:"schemaVersion"`
		Build         buildinfo.Info `json:"build"`
		StartedAt     time.Time      `json:"startedAt"`
		Limits        struct {
			MaxConcurrent     int    `json:"maxConcurrent"`
			MaxRequestsPerSec int    `json:"maxRequestsPerSec"`
			QueueWait         string `json:"queueWait"`
		} `json:"limits"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Service != "ynx-indexerd" || got.SchemaVersion != 2 || got.Build != build || !got.StartedAt.Equal(server.startedAt) {
		t.Fatalf("lost shared version identity contract: %+v", got)
	}
	if got.Limits.MaxConcurrent != limits.MaxConcurrent || got.Limits.MaxRequestsPerSec != limits.MaxRequestsPerSec || got.Limits.QueueWait != limits.QueueWait.String() {
		t.Fatalf("lost protocol parent's actual admission limits: %+v", got.Limits)
	}
	post := httptest.NewRecorder()
	server.Handler().ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/version", nil))
	if post.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET-only version route changed: POST returned %d", post.Code)
	}
}
