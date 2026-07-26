package explorer

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
	"github.com/JiahaoAlbus/YNX-Chain/internal/stablereserve"
)

func TestStableReserveEndpointFailsClosedWithoutFreshInput(t *testing.T) {
	handler := NewServerWithBuild(nil, buildinfo.Info{Commit: strings.Repeat("a", 40)}).Handler()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/stable/reserve", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Failure      bool            `json:"failure"`
		FailureCodes []string        `json:"failureCodes"`
		Release      map[string]bool `json:"release"`
	}
	if json.NewDecoder(response.Body).Decode(&body) != nil || !body.Failure ||
		len(body.FailureCodes) != 1 || body.FailureCodes[0] != "YNX_STABLE_RESERVE_UNAVAILABLE" {
		t.Fatalf("unavailable response is not truthful: %+v", body)
	}
	if !body.Release["implementedLocal"] || !body.Release["testedLocal"] {
		t.Fatalf("unavailable provider erased adapter implementation truth: %+v", body.Release)
	}
	for _, key := range []string{"installedLocal", "integratedCentral", "deployedStaging", "deployedPublic", "downloadHosted", "productionSigned", "storeReleased"} {
		if body.Release[key] {
			t.Fatalf("local adapter promoted release state %s: %+v", key, body.Release)
		}
	}
}

func TestStableReservePublicAdapterTruthDoesNotClaimProviderAvailability(t *testing.T) {
	release, err := StableReserveAdapterReleaseStates("public_testnet")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServerWithBuildAndStableReserveRelease(nil, buildinfo.Info{Commit: strings.Repeat("9", 40)}, nil, release, "public_testnet")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/stable/reserve", nil))
	var body struct {
		Failure             bool                               `json:"failure"`
		SourceCommit        string                             `json:"sourceCommit"`
		AdapterReleaseClass string                             `json:"adapterReleaseClass"`
		Release             economics.IntegrationReleaseStates `json:"release"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusServiceUnavailable || !body.Failure ||
		body.SourceCommit != strings.Repeat("9", 40) || body.AdapterReleaseClass != "public_testnet" ||
		!body.Release.ImplementedLocal || !body.Release.TestedLocal || !body.Release.IntegratedCentral ||
		!body.Release.DeployedStaging || !body.Release.DeployedPublic ||
		body.Release.ProductionSigned || body.Release.StoreReleased {
		t.Fatalf("adapter/provider release truth is inconsistent: %+v", body)
	}
	if _, err := StableReserveAdapterReleaseStates("production"); err == nil {
		t.Fatal("unsupported release class was accepted")
	}
}

func TestLoadStableReserveIntegrationFromProviderFile(t *testing.T) {
	integration := explorerReserveIntegration(t, 1_200_000_000)
	var event economics.StableReserveEvent
	if err := json.Unmarshal(integration.Envelope.Payload, &event); err != nil {
		t.Fatal(err)
	}
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	attestation := stablereserve.Attestation{
		SchemaVersion: 1, AttestationID: "attestation-loader-0001",
		Provider: "reviewed-testnet-provider", Custodian: "reviewed-testnet-custodian",
		Asset: "YUSD", Network: "ynx-testnet", AsOf: now.Format(time.RFC3339Nano),
		ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), ReserveUnits: event.Snapshot.ReserveUnits,
		ReportedSupplyUnits: 800_000_000, PendingRedemptionUnits: 200_000_000,
		EvidenceURL:  "https://attestations.testnet.invalid/yusd/loader",
		EvidenceHash: "sha256:" + strings.Repeat("e", 64), KeyID: "testnet-reserve-key-loader",
	}
	payload, _ := stablereserve.SigningPayload(attestation)
	attestation.Signature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	raw, _ := json.Marshal(attestation)
	path := t.TempDir() + "/reserve.json"
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	loaded, err := LoadStableReserveIntegration(path, base64.RawStdEncoding.EncodeToString(publicKey), attestation.KeyID, "YUSD", "ynx-testnet", strings.Repeat("f", 40), time.Hour)
	if err != nil || loaded.Explorer.Metrics["coverageBps"] != 12_000 {
		t.Fatalf("load failed: integration=%+v err=%v", loaded, err)
	}
}

func TestStableReserveEndpointAndMetricsExposeVerifiedShortfall(t *testing.T) {
	integration := explorerReserveIntegration(t, 900_000_000)
	server := NewServerWithBuildAndStableReserve(nil, buildinfo.Info{Commit: integration.SourceCommit}, &integration)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/stable/reserve", nil)
	request.Header.Set("X-Request-ID", "stable-reserve-request-0001")
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("X-Request-ID") != "stable-reserve-request-0001" {
		t.Fatalf("status=%d id=%q body=%s", response.Code, response.Header().Get("X-Request-ID"), response.Body.String())
	}
	var body struct {
		Failure bool                               `json:"failure"`
		Reserve stablereserve.Snapshot             `json:"reserve"`
		Monitor []economics.EconomicsMonitorCheck  `json:"monitor"`
		Release economics.IntegrationReleaseStates `json:"release"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Failure || body.Reserve.Solvent || body.Reserve.ShortfallUnits != 100_000_000 ||
		body.Release.IntegratedCentral || body.Release.DeployedPublic {
		t.Fatalf("shortfall response overclaimed: %+v", body)
	}
	metrics := server.stableReserveMetricsPrometheus(time.Date(2026, 7, 26, 2, 1, 0, 0, time.UTC))
	for _, expected := range []string{
		"ynx_explorer_stable_reserve_attestation_available{asset=\"YUSD\",network=\"ynx-testnet\",provider=\"reviewed-testnet-provider\"} 1",
		"ynx_explorer_stable_reserve_solvent{asset=\"YUSD\",network=\"ynx-testnet\",provider=\"reviewed-testnet-provider\"} 0",
		"ynx_explorer_stable_reserve_coverage_bps{asset=\"YUSD\",network=\"ynx-testnet\",provider=\"reviewed-testnet-provider\"} 9000",
		"ynx_explorer_stable_reserve_shortfall_units{asset=\"YUSD\",network=\"ynx-testnet\",provider=\"reviewed-testnet-provider\"} 100000000",
	} {
		if !strings.Contains(metrics, expected) {
			t.Fatalf("metrics missing %q:\n%s", expected, metrics)
		}
	}
}

func explorerReserveIntegration(t *testing.T, reserve uint64) economics.StableReserveIntegration {
	t.Helper()
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().UTC()
	attestation := stablereserve.Attestation{
		SchemaVersion: 1, AttestationID: "attestation-explorer-0001",
		Provider: "reviewed-testnet-provider", Custodian: "reviewed-testnet-custodian",
		Asset: "YUSD", Network: "ynx-testnet", AsOf: now.Format(time.RFC3339Nano),
		ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), ReserveUnits: reserve,
		ReportedSupplyUnits: 800_000_000, PendingRedemptionUnits: 200_000_000,
		EvidenceURL:  "https://attestations.testnet.invalid/yusd/explorer",
		EvidenceHash: "sha256:" + strings.Repeat("c", 64), KeyID: "testnet-reserve-key-01",
	}
	payload, _ := stablereserve.SigningPayload(attestation)
	attestation.Signature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	integration, err := economics.BuildStableReserveIntegration(strings.Repeat("d", 40), stablereserve.Verifier{
		Keys: map[string]ed25519.PublicKey{attestation.KeyID: publicKey}, MaxAge: time.Hour,
		Now: func() time.Time { return now }, Asset: "YUSD", Network: "ynx-testnet",
	}, attestation)
	if err != nil {
		t.Fatal(err)
	}
	return integration
}
