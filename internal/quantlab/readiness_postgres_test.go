package quantlab

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLReadinessRejectsClosedPoolAndRecoversOnReopen(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), DatabaseURL: databaseURL, StateNamespace: fmt.Sprintf("quant-it-readiness-%d", time.Now().UnixNano())}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	t.Cleanup(func() {
		// The original pool is deliberately closed by this test. Reopen only
		// this exact disposable namespace for cleanup, never delete other rows.
		cleanup, err := New(cfg)
		if err != nil {
			t.Error(err)
			return
		}
		defer cleanup.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := cleanup.store.(*postgresStateStore).db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key=$1`, cfg.StateNamespace); err != nil {
			t.Error(err)
		}
	})
	server := httptest.NewServer(NewServer(service))
	defer server.Close()
	check := func(url string, status int, reason string) {
		t.Helper()
		response, err := server.Client().Get(url + "/ready")
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var payload struct{ Status, Reason string }
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != status || payload.Reason != reason {
			t.Fatalf("readiness=%d payload=%+v", response.StatusCode, payload)
		}
	}
	// A reachable empty namespace is not persisted readiness. Explicitly seed
	// controlled local risk state, then require readable authoritative state.
	check(server.URL, http.StatusServiceUnavailable, "authoritative state is temporarily unavailable")
	if _, err := service.Kill("controlled PostgreSQL readiness seed"); err != nil {
		t.Fatal(err)
	}
	check(server.URL, http.StatusOK, "")
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	// Actual SQL pool closure, not a fabricated StorageStatus toggle. No server
	// restart, outage of a production database, or remote acceptance is claimed.
	check(server.URL, http.StatusServiceUnavailable, "authoritative state is temporarily unavailable")
	reopened, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	recovered := httptest.NewServer(NewServer(reopened))
	defer recovered.Close()
	check(recovered.URL, http.StatusOK, "")
}
