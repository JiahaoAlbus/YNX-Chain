package quantlab

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestTenantServerIsolatesGuestPaperAndAuditState(t *testing.T) {
	handler, err := NewTenantServer(Config{StatePath: filepath.Join(t.TempDir(), "quant.json")}, "all")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer server.Close()
	tenantA, tenantB := strings.Repeat("a", 64), strings.Repeat("b", 64)

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/risk/kill", bytes.NewBufferString(`{"reason":"isolated tenant drill"}`))
	request.Header.Set(TenantHeader, tenantA)
	request.Header.Set("X-YNX-Preview-Mode", "local-paper")
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("kill status=%v err=%v", response.StatusCode, err)
	}
	response.Body.Close()

	readKill := func(tenant string) bool {
		t.Helper()
		request, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/snapshot", nil)
		request.Header.Set(TenantHeader, tenant)
		request.Header.Set("X-YNX-Preview-Mode", "local-paper")
		response, err := http.DefaultClient.Do(request)
		if err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("snapshot status=%v err=%v", response.StatusCode, err)
		}
		defer response.Body.Close()
		var snapshot struct {
			Paper PaperState `json:"paper"`
		}
		if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot.Paper.KillSwitch
	}
	if !readKill(tenantA) || readKill(tenantB) {
		t.Fatal("tenant state crossed browser bindings")
	}
	response, err = http.Get(server.URL + "/v1/snapshot")
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("missing tenant status=%v err=%v", response.StatusCode, err)
	}
	response.Body.Close()
}

func TestPublicSnapshotAndResearchDoNotCreateTenantOrExposeLegacyState(t *testing.T) {
	handler, err := NewTenantServer(Config{StatePath: filepath.Join(t.TempDir(), "quant.json")}, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer handler.Close()
	for _, route := range []string{"/v1/snapshot", "/v1/public/status"} {
		request := httptest.NewRequest(http.MethodGet, route, nil)
		request.RemoteAddr = "127.0.0.1:9000"
		request.Header.Set("X-Forwarded-For", "198.51.100.3")
		request.Header.Set("X-YNX-Preview-Mode", "local-paper")
		request.Header.Set(TenantHeader, strings.Repeat("c", 64))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatal(response.Code)
		}
		if route == "/v1/snapshot" && (!strings.Contains(response.Body.String(), `"statefulPreview":false`) || strings.Contains(response.Body.String(), `"Cash"`)) {
			t.Fatal("public snapshot exposed a funded/stateful workspace")
		}
	}
	if len(handler.servers) != 0 {
		t.Fatal("public reads created a durable tenant")
	}
}
