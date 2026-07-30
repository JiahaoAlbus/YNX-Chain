package oracle

import (
	"testing"
	"time"
)

func providerCandidateWithoutReporter() Provider {
	return Provider{
		ID: "official-source-candidate", Name: "Official source candidate",
		Endpoint: "https://data.test.ynx.invalid/ticker", APIVersion: "candidate-v1",
		AssetMarketCoverage: []string{"BTC/USD"}, License: "review required",
		TermsURL: "https://terms.test.ynx.invalid/source", PermittedStorage: "not approved",
		Authentication: "reporter identity not assigned", RateLimit: "not approved",
		TimestampSemantics: "venue event time", Precision: "1e-6", Timezone: "UTC",
		Region: "provider infrastructure", Jurisdiction: "review required", Cost: "unknown",
		Retention: "not approved", DataRights: "not approved", Fallback: "fail closed",
		DecommissionPlan: "remove candidate", Status: "legal_approval_required",
		UpdatedAt: time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC),
	}
}

func TestInactiveCandidateMayOmitUnassignedReporterAuthority(t *testing.T) {
	provider := providerCandidateWithoutReporter()
	if err := provider.Validate(); err != nil {
		t.Fatalf("inactive source candidate rejected: %v", err)
	}
	provider.Status = "active"
	if err := provider.Validate(); err == nil {
		t.Fatal("active provider without reporter authority accepted")
	}
	provider.Status = "legal_approval_required"
	provider.ReporterID = "reporter:partial"
	if err := provider.Validate(); err == nil {
		t.Fatal("partial inactive reporter authority accepted")
	}
}
