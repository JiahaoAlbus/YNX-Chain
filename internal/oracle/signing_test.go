package oracle

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
	"time"
)

func TestObservationSignProducesProviderVerifiableRecord(t *testing.T) {
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	provider := Provider{
		ID: "official-source", Name: "Official source", Endpoint: "https://provider.invalid/ticker", APIVersion: "v1",
		AssetMarketCoverage: []string{"BTC/USD"}, License: "approved", TermsURL: "https://provider.invalid/terms",
		PermittedStorage: "approved", Authentication: "public read plus reporter signature", RateLimit: "1/s",
		TimestampSemantics: "venue time", Precision: "1e-6", Timezone: "UTC", Region: "test", Jurisdiction: "test",
		Cost: "test", Retention: "test", DataRights: "approved", Fallback: "fail closed",
		DecommissionPlan: "disable", Status: "active", ReporterID: "reporter:official-source",
		ReporterPublicKeyHex: hex.EncodeToString(public), WeightPPM: 1_000_000, UpdatedAt: now,
	}
	observation := Observation{
		Schema: SchemaVersion, ID: "official-source-1", ProviderID: provider.ID, ReporterID: provider.ReporterID,
		Sequence: 1, NonceDomain: "ynx-oracle-testnet-v1", Market: "BTC/USD", Type: SpotPrice,
		Value: 67_500_000_000, Scale: 1_000_000, Volume24H: 2_000_000,
		ObservedAt: now.Add(-time.Second), ReceivedAt: now, Source: provider.Endpoint, SourceVersion: provider.APIVersion,
	}
	if err := observation.Sign(private); err != nil {
		t.Fatal(err)
	}
	if err := observation.Verify(provider, "ynx-oracle-testnet-v1"); err != nil {
		t.Fatalf("signed observation rejected: %v", err)
	}
	tampered := observation
	tampered.Value++
	if err := tampered.Verify(provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("tampered signed observation accepted")
	}
}
