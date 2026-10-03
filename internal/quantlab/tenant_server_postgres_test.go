package quantlab

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPostgreSQLTenantServerKeepsRiskStateIsolatedAcrossHTTPUsers(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if databaseURL == "" {
		t.Skip("YNX_QUANT_POSTGRES_TEST_URL is not configured")
	}
	namespace := "quant-http-it-" + strings.ToLower(strings.ReplaceAll(t.Name(), "/", "-"))
	handler, err := NewTenantServer(Config{
		StatePath:      filepath.Join(t.TempDir(), "state.json"),
		DatabaseURL:    databaseURL,
		StateNamespace: namespace,
	}, "all")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := handler.Close(); err != nil {
			t.Error(err)
		}
	})
	store := handler.baseService.store.(*postgresStateStore)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := store.db.ExecContext(ctx, `DELETE FROM ynx_quant_state WHERE state_key = $1 OR state_key LIKE $2`, namespace, namespace+":tenant:%"); err != nil {
			t.Error(err)
		}
	})
	server := httptest.NewServer(handler)
	defer server.Close()
	tenantA := strings.Repeat("a", 64)
	tenantB := strings.Repeat("b", 64)
	kill := func(tenant string) *http.Response {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/risk/kill", bytes.NewBufferString(`{"reason":"isolated postgres tenant test"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set(TenantHeader, tenant)
		req.Header.Set("X-YNX-Preview-Mode", "local-paper")
		req.Header.Set("Content-Type", "application/json")
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	response := kill(tenantA)
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		t.Fatalf("tenant A kill status=%d", response.StatusCode)
	}
	_ = response.Body.Close()
	snapshot := func(tenant string) PaperState {
		req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/snapshot", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set(TenantHeader, tenant)
		req.Header.Set("X-YNX-Preview-Mode", "local-paper")
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("tenant=%s status=%d", tenant, response.StatusCode)
		}
		var payload struct {
			Paper PaperState `json:"paper"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.Paper
	}
	if !snapshot(tenantA).KillSwitch {
		t.Fatal("tenant A kill switch was not persisted")
	}
	if snapshot(tenantB).KillSwitch {
		t.Fatal("tenant B observed tenant A risk state")
	}
	response, err = server.Client().Get(server.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var health struct {
		Ready   bool           `json:"ready"`
		Storage map[string]any `json:"storage"`
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !health.Ready || health.Storage["backend"] != "postgresql" || health.Storage["multiInstance"] != true {
		t.Fatalf("health status=%d storage=%#v", response.StatusCode, health.Storage)
	}
	handler.mu.Lock()
	before := len(handler.servers)
	handler.maxOpen = before // all actual workspace slots are already occupied
	handler.mu.Unlock()
	for _, route := range []string{"/health", "/ready", "/version", "/metrics"} {
		request, err := http.NewRequest(http.MethodGet, server.URL+route, nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set(TenantHeader, strings.Repeat("d", 64))
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("service diagnostic blocked at tenant capacity: %s status=%d", route, response.StatusCode)
		}
	}
	handler.mu.Lock()
	after := len(handler.servers)
	handler.mu.Unlock()
	if after != before {
		t.Fatalf("PostgreSQL diagnostics allocated workspace: before=%d after=%d", before, after)
	}
}
