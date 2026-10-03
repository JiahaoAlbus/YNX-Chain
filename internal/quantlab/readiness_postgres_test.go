package quantlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPostgreSQLReadinessRejectsClosedPoolAndRecoversOnReopen(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), DatabaseURL: databaseURL, StateNamespace: "quant-it-readiness-closed-pool"}
	service, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
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
