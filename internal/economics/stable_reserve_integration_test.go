package economics

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/stablereserve"
)

func TestStableReserveIntegrationMapsVerifiedTruth(t *testing.T) {
	verifier, attestation := stableReserveFixture(t, 1_200_000_000)
	result, err := BuildStableReserveIntegration(integrationFixtureSourceCommit, verifier, attestation)
	if err != nil {
		t.Fatal(err)
	}
	if result.Envelope.EventType != StableReserveAttestedEventType ||
		result.Explorer.Metrics["coverageBps"] != 12_000 ||
		result.Explorer.Labels["externalReserveAttested"] != "true" ||
		result.Explorer.Labels["productionReady"] != "false" ||
		len(result.Monitor) != 3 || result.Monitor[2].Status != "pass" ||
		result.ReleaseStates.IntegratedCentral || result.ReleaseStates.DeployedPublic {
		t.Fatalf("integration overclaimed or lost reserve truth: %+v", result)
	}
	if err := ValidateStableReserveIntegration(result); err != nil {
		t.Fatal(err)
	}

	replayed, err := BuildStableReserveIntegration(integrationFixtureSourceCommit, verifier, attestation)
	if err != nil || replayed.IntegrationHash != result.IntegrationHash {
		t.Fatalf("integration replay changed: %v first=%s second=%s", err, result.IntegrationHash, replayed.IntegrationHash)
	}
}

func TestStableReserveIntegrationMapsShortfallToFailedCriticalMonitor(t *testing.T) {
	verifier, attestation := stableReserveFixture(t, 900_000_000)
	result, err := BuildStableReserveIntegration(integrationFixtureSourceCommit, verifier, attestation)
	if err != nil {
		t.Fatal(err)
	}
	var coverage EconomicsMonitorCheck
	for _, check := range result.Monitor {
		if check.Check == "stable_reserve_coverage" {
			coverage = check
		}
	}
	if coverage.Status != "fail" || coverage.Severity != "critical" ||
		result.Explorer.Labels["status"] != "reserve-shortfall" ||
		result.Explorer.Metrics["shortfallUnits"] != 100_000_000 {
		t.Fatalf("shortfall was hidden: projection=%+v monitor=%+v", result.Explorer, coverage)
	}
}

func TestStableReserveIntegrationRejectsProjectionTamper(t *testing.T) {
	verifier, attestation := stableReserveFixture(t, 1_200_000_000)
	result, err := BuildStableReserveIntegration(integrationFixtureSourceCommit, verifier, attestation)
	if err != nil {
		t.Fatal(err)
	}
	result.Explorer.Metrics["reserveUnits"]++
	result.Explorer.ID = economicsExplorerProjectionID(result.Explorer)
	result.Explorer.AuditHash = economicsExplorerProjectionHash(result.Explorer)
	result.IntegrationHash = stableReserveIntegrationHash(result)
	assertRuntimeErrorCode(t, ValidateStableReserveIntegration(result), CodeIntegrationInvalidProjection)
}

func stableReserveFixture(t *testing.T, reserve uint64) (stablereserve.Verifier, stablereserve.Attestation) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 26, 2, 0, 0, 0, time.UTC)
	attestation := stablereserve.Attestation{
		SchemaVersion: stablereserve.SchemaVersion, AttestationID: "attestation-integration-0001",
		Provider: "reviewed-testnet-provider", Custodian: "reviewed-testnet-custodian",
		Asset: "YUSD", Network: "ynx-testnet", AsOf: now.Format(time.RFC3339Nano),
		ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), ReserveUnits: reserve,
		ReportedSupplyUnits: 800_000_000, PendingRedemptionUnits: 200_000_000,
		EvidenceURL:  "https://attestations.testnet.invalid/yusd/integration",
		EvidenceHash: "sha256:" + strings.Repeat("b", 64), KeyID: "testnet-reserve-key-01",
	}
	payload, err := stablereserve.SigningPayload(attestation)
	if err != nil {
		t.Fatal(err)
	}
	attestation.Signature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
	return stablereserve.Verifier{
		Keys: map[string]ed25519.PublicKey{attestation.KeyID: publicKey}, MaxAge: 10 * time.Minute,
		Now: func() time.Time { return now }, Asset: "YUSD", Network: "ynx-testnet",
	}, attestation
}
