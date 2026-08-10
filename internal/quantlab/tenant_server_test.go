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
	if err != nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing tenant status=%v err=%v", response.StatusCode, err)
	}
	response.Body.Close()
}
