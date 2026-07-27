package explorer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
	"github.com/JiahaoAlbus/YNX-Chain/internal/yusdsandbox"
)

func TestYUSDSandboxPublicProjectionExposesOnlyTruthfulReadState(t *testing.T) {
	now := time.Now().UTC()
	upstream := yusdProjectionUpstream(t, now, true)
	defer upstream.Close()
	projection, err := NewYUSDSandboxProjection(upstream.URL, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithBuildAndStableReserveRelease(
		nil,
		buildinfo.Info{Commit: strings.Repeat("a", 40), Release: "ynx-economics-explorer-aaaaaaaaaaaa"},
		nil,
		economics.IntegrationReleaseStates{IntegratedCentral: true, DeployedStaging: true, DeployedPublic: true},
		"public_testnet",
	)
	server.SetYUSDSandboxProjection(projection)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/stable/yusd-sandbox", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("public YUSD state must not be cached: %q", response.Header().Get("Cache-Control"))
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	sandbox, _ := payload["sandbox"].(map[string]any)
	build, _ := payload["sandboxBuild"].(map[string]any)
	release, _ := payload["release"].(map[string]any)
	if payload["failure"] != false || payload["adapterReleaseClass"] != "public_testnet" ||
		sandbox["realityValue"] != false || sandbox["externalReserveAttested"] != false ||
		sandbox["solvent"] != true || sandbox["reconciled"] != true ||
		build["commit"] != strings.Repeat("b", 40) || release["deployedPublic"] != true {
		t.Fatalf("invalid public YUSD projection: %s", response.Body.String())
	}
}

func TestYUSDSandboxPublicProjectionFailsClosed(t *testing.T) {
	now := time.Now().UTC()
	upstream := yusdProjectionUpstream(t, now, false)
	defer upstream.Close()
	projection, err := NewYUSDSandboxProjection(upstream.URL, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithBuildAndStableReserveRelease(
		nil, buildinfo.Info{Commit: strings.Repeat("c", 40)},
		nil, economics.IntegrationReleaseStates{DeployedPublic: true}, "public_testnet",
	)
	server.SetYUSDSandboxProjection(projection)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/stable/yusd-sandbox", nil))
	if response.Code != http.StatusServiceUnavailable ||
		!strings.Contains(response.Body.String(), "YNX_YUSD_SANDBOX_UNAVAILABLE") ||
		strings.Contains(response.Body.String(), `"sandbox"`) {
		t.Fatalf("invalid upstream did not fail closed: %d %s", response.Code, response.Body.String())
	}
}

func TestYUSDSandboxProjectionRequiresLoopbackOrigin(t *testing.T) {
	for _, value := range []string{
		"https://127.0.0.1:6490",
		"http://localhost:6490",
		"http://127.0.0.1:6490/yusd/snapshot",
		"http://user@127.0.0.1:6490",
		"http://127.0.0.1",
	} {
		if _, err := NewYUSDSandboxProjection(value, 5*time.Second); err == nil {
			t.Fatalf("unsafe upstream accepted: %s", value)
		}
	}
}

func yusdProjectionUpstream(t *testing.T, now time.Time, valid bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/health":
			health := map[string]any{
				"service": "ynx-yusd-sandboxd", "testnetOnly": true, "realityValue": false,
				"externalReserveAttested": false, "externalExecutionEnabled": false,
				"productionReady": false, "failure": false,
				"build": buildinfo.Info{Commit: strings.Repeat("b", 40), Release: "ynx-yusd-sandbox-bbbbbbbbbbbb", BuildTime: now.Format(time.RFC3339)},
			}
			if !valid {
				health["realityValue"] = true
			}
			_ = json.NewEncoder(w).Encode(health)
		case "/yusd/snapshot":
			_ = json.NewEncoder(w).Encode(yusdsandbox.Snapshot{
				SchemaVersion: 1, Product: "YUSD Sandbox", Network: "YNX Testnet", Symbol: "YUSD",
				Decimals: 6, Source: "ynx-yusd-sandbox-persistent-ledger", AsOf: now, Version: 1,
				ReserveUnits: 4_600_000, SupplyUnits: 600_000, RequiredBackingUnits: 600_000,
				ExcessReserveUnits: 4_000_000, Solvent: true, Reconciled: true, ProviderStatus: "available",
				AccountDailyLimit: yusdsandbox.AccountDailyLimit, GlobalDailyLimit: yusdsandbox.GlobalDailyLimit,
			})
		default:
			http.NotFound(w, request)
		}
	}))
}
