package indexer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

func TestHealthReturnsWarmingWithoutWaitingForStoreLock(t *testing.T) {
	store := NewStore(t.TempDir() + "/indexer-db.json")
	store.mu.Lock()
	defer store.mu.Unlock()

	server := NewServerWithBuild(&Indexer{store: store}, buildinfo.Info{Commit: "abc123", Release: "ynx-indexer-abc123"})
	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.Handler().ServeHTTP(response, request)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(250 * time.Millisecond):
		t.Fatal("health check waited behind the store load lock")
	}
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("warming health returned %d", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	dependencies := payload["dependencies"].(map[string]any)
	chainRPC := dependencies["chainRpc"].(map[string]any)
	if payload["ok"] != false || chainRPC["status"] != "warming" {
		t.Fatalf("health did not report truthful warming state: %+v", payload)
	}
}
