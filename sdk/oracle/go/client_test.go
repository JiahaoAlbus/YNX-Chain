package oracleclient

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func validPrice(now time.Time) Price {
	return Price{Schema: SchemaVersion, Market: "YNXT/YUSD_TEST", Type: "spot_price", Value: 1_000_000, Scale: 1_000_000,
		Source: "YNX Oracle aggregated provider observations", Version: "weighted-median-mad-v1", AsOf: now.Add(-time.Second), ProducedAt: now,
		Quality:        Quality{Status: "good", SourceCount: 3, RequiredSourceCount: 3, ConfidencePPM: 990_000, CoveragePPM: 1_000_000},
		ObservationIDs: []string{"a", "b", "c"}, ObservationHash: []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)}, LineageHash: strings.Repeat("d", 64)}
}

func TestMachineReadableConsumerVectors(t *testing.T) {
	data, err := os.ReadFile("../../../integration/oracle/v1/consumer-test-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		ConsumerPolicy struct {
			RequestedMarket      string    `json:"requestedMarket"`
			RequestedType        string    `json:"requestedType"`
			Now                  time.Time `json:"now"`
			MaximumAgeSeconds    int       `json:"maximumAgeSeconds"`
			MinimumConfidencePPM int64     `json:"minimumConfidencePpm"`
			MinimumCoveragePPM   int64     `json:"minimumCoveragePpm"`
		} `json:"consumerPolicy"`
		Base  map[string]any `json:"base"`
		Cases []struct {
			ID      string `json:"id"`
			Accept  bool   `json:"accept"`
			Changes []struct {
				Path  string `json:"path"`
				Value any    `json:"value"`
			} `json:"changes"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, test := range vectors.Cases {
		t.Run(test.ID, func(t *testing.T) {
			encoded, _ := json.Marshal(vectors.Base)
			var candidate map[string]any
			if err := json.Unmarshal(encoded, &candidate); err != nil {
				t.Fatal(err)
			}
			for _, change := range test.Changes {
				applyFixtureChange(t, candidate, change.Path, change.Value)
			}
			encoded, _ = json.Marshal(candidate)
			var price Price
			decoder := json.NewDecoder(strings.NewReader(string(encoded)))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&price); err != nil {
				t.Fatal(err)
			}
			err := price.ValidateFor(vectors.ConsumerPolicy.RequestedMarket, vectors.ConsumerPolicy.RequestedType, "weighted-median-mad-v1", vectors.ConsumerPolicy.Now, time.Duration(vectors.ConsumerPolicy.MaximumAgeSeconds)*time.Second, vectors.ConsumerPolicy.MinimumConfidencePPM, vectors.ConsumerPolicy.MinimumCoveragePPM)
			if (err == nil) != test.Accept {
				t.Fatalf("accept=%v err=%v", test.Accept, err)
			}
		})
	}
}

func applyFixtureChange(t *testing.T, target map[string]any, pointer string, value any) {
	t.Helper()
	parts := strings.Split(strings.TrimPrefix(pointer, "/"), "/")
	current := target
	for _, part := range parts[:len(parts)-1] {
		next, ok := current[part].(map[string]any)
		if !ok {
			t.Fatalf("invalid fixture pointer %q", pointer)
		}
		current = next
	}
	current[parts[len(parts)-1]] = value
}

func TestValidateRejectsEveryUnsafeConsumerState(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	tests := map[string]func(*Price){
		"stale":          func(price *Price) { price.Quality.Stale = true },
		"circuit":        func(price *Price) { price.Quality.CircuitBreaker = true },
		"thin":           func(price *Price) { price.Quality.SourceCount = 2 },
		"low confidence": func(price *Price) { price.Quality.ConfidencePPM = 100 },
		"old":            func(price *Price) { price.AsOf = now.Add(-time.Minute) },
		"future":         func(price *Price) { price.AsOf = now.Add(time.Minute) },
		"lineage":        func(price *Price) { price.LineageHash = "invalid" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			price := validPrice(now)
			mutate(&price)
			if err := price.Validate(now, 30*time.Second, 800_000); err == nil {
				t.Fatal("unsafe price accepted")
			}
		})
	}
	if err := validPrice(now).Validate(now, 30*time.Second, 800_000); err != nil {
		t.Fatalf("valid price rejected: %v", err)
	}
}

func validFundingPrice(now time.Time) Price {
	return Price{
		Schema: SchemaVersion, Market: "YNXT/YUSD_TEST", Type: "funding_reference", Value: -200, Scale: 1_000_000,
		Source: "YNX Oracle funding reference derived from premium and basis candidates", Version: DerivativesPolicyVersion,
		AsOf: now.Add(-time.Second), ProducedAt: now,
		Quality:         Quality{Status: "good", SourceCount: 3, RequiredSourceCount: 3, ConfidencePPM: 990_000, CoveragePPM: 1_000_000},
		ObservationIDs:  []string{"premium-a", "premium-b", "premium-c", "basis-a", "basis-b", "basis-c"},
		ObservationHash: []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64), strings.Repeat("d", 64), strings.Repeat("e", 64), strings.Repeat("f", 64)},
		LineageHash:     strings.Repeat("1", 64),
		Derivation: &PriceDerivation{
			Method: "premium_plus_basis_with_governance_clamp", PolicyVersion: DerivativesPolicyVersion,
			ComponentTypes:         []string{"premium_reference", "basis_reference"},
			ComponentLineageHashes: []string{strings.Repeat("2", 64), strings.Repeat("3", 64)},
			FundingWindowSeconds:   28_800, PremiumPPM: -100, BasisPPM: -100,
			RawAdjustmentPPM: -200, AppliedAdjustmentPPM: -200, ClampPPM: 5_000,
		},
	}
}

func TestValidateAcceptsSignedFundingAndRequiresExactDerivation(t *testing.T) {
	now := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	funding := validFundingPrice(now)
	if err := funding.ValidateFor("YNXT/YUSD_TEST", "funding_reference", DerivativesPolicyVersion, now, 30*time.Second, 800_000, 1_000_000); err != nil {
		t.Fatalf("valid signed funding rejected: %v", err)
	}
	zero := funding
	zero.Value = 0
	zero.Derivation = &PriceDerivation{
		Method: "premium_plus_basis_with_governance_clamp", PolicyVersion: DerivativesPolicyVersion,
		ComponentTypes: []string{"premium_reference", "basis_reference"}, ComponentLineageHashes: []string{strings.Repeat("2", 64), strings.Repeat("3", 64)},
		FundingWindowSeconds: 28_800, ClampPPM: 5_000,
	}
	if err := zero.Validate(now, 30*time.Second, 800_000); err != nil {
		t.Fatalf("zero funding rejected: %v", err)
	}

	tests := map[string]func(*Price){
		"missing derivation":  func(price *Price) { price.Derivation = nil },
		"wrong components":    func(price *Price) { price.Derivation.ComponentTypes[0] = "spot_price" },
		"wrong policy":        func(price *Price) { price.Derivation.PolicyVersion = "unknown" },
		"clamped":             func(price *Price) { price.Derivation.Clamped = true },
		"adjustment mismatch": func(price *Price) { price.Derivation.AppliedAdjustmentPPM = -201 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			candidate := validFundingPrice(now)
			mutate(&candidate)
			if err := candidate.Validate(now, 30*time.Second, 800_000); err == nil {
				t.Fatal("unsafe derived value accepted")
			}
		})
	}

	direct := validPrice(now)
	direct.Derivation = funding.Derivation
	if err := direct.Validate(now, 30*time.Second, 800_000); err == nil {
		t.Fatal("direct price with misleading derivation accepted")
	}
}

func validDEXTWAPPrice(now time.Time) Price {
	hashes := []string{
		strings.Repeat("1", 64), strings.Repeat("2", 64), strings.Repeat("3", 64),
		strings.Repeat("4", 64), strings.Repeat("5", 64), strings.Repeat("6", 64),
	}
	return Price{
		Schema: SchemaVersion, Market: "YNXT/YUSD_TEST", Type: "dex_twap", Value: 100_000_000, Scale: 1_000_000,
		Source: "YNX Oracle manipulation-resistant confirmed multi-block DEX TWAP", Version: DEXTWAPPolicyVersion,
		AsOf: now.Add(-time.Second), ProducedAt: now,
		Quality: Quality{Status: "good", SourceCount: 3, RequiredSourceCount: 3, ConfidencePPM: 900_000, CoveragePPM: 1_000_000,
			SourceLimitation: "single DEX pool is not sole settlement authority"},
		ObservationIDs:  []string{"a", "b", "c", "d", "e", "f"},
		ObservationHash: hashes,
		LineageHash:     strings.Repeat("a", 64),
		Derivation: &PriceDerivation{
			Method: "confirmed_multi_block_guarded_twap", PolicyVersion: DEXTWAPPolicyVersion,
			ComponentTypes: []string{"dex_pool_state"}, ComponentLineageHashes: append([]string(nil), hashes...),
			ObservationWindowSeconds: 60, StartBlock: 100, EndBlock: 105, ConfirmationDepth: 2,
			ChainID: "ynx-testnet-1", Pool: "pool-ynxt-yusd-test", ObservationCount: 6, ReporterCount: 3,
			RejectedBlockNumbers: []uint64{103}, MinimumReserve0: "100000000000000000000", MinimumReserve1: "10000000000",
		},
	}
}

func TestValidateDEXTWAPRequiresConfirmedLineage(t *testing.T) {
	now := time.Date(2026, 7, 25, 14, 0, 0, 0, time.UTC)
	price := validDEXTWAPPrice(now)
	if err := price.ValidateFor("YNXT/YUSD_TEST", "dex_twap", DEXTWAPPolicyVersion, now, 30*time.Second, 800_000, 900_000); err != nil {
		t.Fatalf("valid DEX TWAP rejected: %v", err)
	}
	tests := map[string]func(*Price){
		"missing derivation":            func(value *Price) { value.Derivation = nil },
		"provider policy":               func(value *Price) { value.Derivation.PolicyVersion = DerivativesPolicyVersion },
		"wrong component":               func(value *Price) { value.Derivation.ComponentTypes[0] = "spot_price" },
		"short window":                  func(value *Price) { value.Derivation.ObservationWindowSeconds = 0 },
		"insufficient reporters":        func(value *Price) { value.Derivation.ReporterCount = 2 },
		"lineage mismatch":              func(value *Price) { value.Derivation.ComponentLineageHashes[0] = strings.Repeat("f", 64) },
		"rejected block outside window": func(value *Price) { value.Derivation.RejectedBlockNumbers[0] = 999 },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			candidate := validDEXTWAPPrice(now)
			mutate(&candidate)
			if err := candidate.Validate(now, 30*time.Second, 800_000); err == nil {
				t.Fatal("unsafe DEX TWAP accepted")
			}
		})
	}
}

func validReserveRatio(now time.Time) Price {
	hash := strings.Repeat("7", 64)
	return Price{
		Schema: SchemaVersion, Market: "YUSD_TEST/USD", Type: "stablecoin_reserve_ratio",
		Value: 1_020_000, Scale: 1_000_000,
		Source:  "YNX Oracle ratio derived from signed published reserve evidence",
		Version: StablecoinReservePolicyVersion, AsOf: now.Add(-24 * time.Hour), ProducedAt: now,
		Quality: Quality{Status: "good", SourceCount: 1, RequiredSourceCount: 1, ConfidencePPM: 990_000, CoveragePPM: 1_000_000,
			SourceLimitation: "published reserve evidence only; no audit opinion"},
		ObservationIDs: []string{"reserve-evidence-1"}, ObservationHash: []string{hash},
		LineageHash: strings.Repeat("8", 64),
		Derivation: &PriceDerivation{
			Method: "reserve_assets_divided_by_outstanding_claims", PolicyVersion: StablecoinReservePolicyVersion,
			ComponentTypes: []string{"stablecoin_reserve_evidence"}, ComponentLineageHashes: []string{hash},
			AttestationVersion: ReserveAttestationVersion, EvidenceID: "evidence-2026-06",
			IssuerID: "issuer:yusd-test", AttestorID: "attestor:independent-a",
			AssuranceStandard: "ISAE 3000 limited assurance", Jurisdiction: "US", Unit: "USD",
			ReserveAssets: "102000000", OutstandingClaims: "100000000",
			ReportingPeriodEnd: now.Add(-24 * time.Hour), PublishedAt: now.Add(-12 * time.Hour),
			ExpiresAt: now.Add(30 * 24 * time.Hour), DocumentHash: strings.Repeat("a", 64), Conclusion: "unmodified",
			AttestationSignatureHex: strings.Repeat("b", 128),
		},
	}
}

func TestValidateReserveRatioRequiresExactEvidenceDerivation(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	price := validReserveRatio(now)
	if err := price.ValidateFor("YUSD_TEST/USD", "stablecoin_reserve_ratio", StablecoinReservePolicyVersion, now, 35*24*time.Hour, 800_000, 1_000_000); err != nil {
		t.Fatalf("valid reserve ratio rejected: %v", err)
	}
	tests := map[string]func(*Price){
		"missing evidence": func(value *Price) { value.Derivation = nil },
		"provider ratio": func(value *Price) {
			value.Version = DerivativesPolicyVersion
			value.Derivation.PolicyVersion = DerivativesPolicyVersion
		},
		"ratio mismatch":                func(value *Price) { value.Value-- },
		"qualified conclusion":          func(value *Price) { value.Derivation.Conclusion = "qualified" },
		"wrong lineage":                 func(value *Price) { value.Derivation.ComponentLineageHashes[0] = strings.Repeat("f", 64) },
		"issuer is attestor":            func(value *Price) { value.Derivation.AttestorID = value.Derivation.IssuerID },
		"invalid document hash":         func(value *Price) { value.Derivation.DocumentHash = "bad" },
		"invalid attestation signature": func(value *Price) { value.Derivation.AttestationSignatureHex = "bad" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			candidate := validReserveRatio(now)
			mutate(&candidate)
			if err := candidate.Validate(now, 35*24*time.Hour, 800_000); err == nil {
				t.Fatal("unsafe reserve ratio accepted")
			}
		})
	}
}

func TestVerifyReserveAttestationUsesAcceptedAttestorKey(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	price := validReserveRatio(now)
	value := price.Derivation
	payload, err := json.Marshal(reserveAttestationPayload{
		AttestationVersion: value.AttestationVersion,
		EvidenceID:         value.EvidenceID, IssuerID: value.IssuerID, AttestorID: value.AttestorID,
		AssuranceStandard: value.AssuranceStandard, Jurisdiction: value.Jurisdiction, Unit: value.Unit,
		ReserveAssets: value.ReserveAssets, OutstandingClaims: value.OutstandingClaims,
		ReportingPeriodEnd: value.ReportingPeriodEnd.UTC(), PublishedAt: value.PublishedAt.UTC(),
		ExpiresAt: value.ExpiresAt.UTC(), DocumentHash: value.DocumentHash, Conclusion: value.Conclusion,
	})
	if err != nil {
		t.Fatal(err)
	}
	value.AttestationSignatureHex = hex.EncodeToString(ed25519.Sign(private, payload))
	attestor := Attestor{
		ID: value.AttestorID, Name: "Independent attestor", PublicKeyHex: hex.EncodeToString(public), Status: "active",
		AssuranceStandards: []string{value.AssuranceStandard}, Jurisdictions: []string{value.Jurisdiction},
		ValidFrom: now.Add(-365 * 24 * time.Hour), ValidUntil: now.Add(365 * 24 * time.Hour), UpdatedAt: now,
	}
	if err := price.VerifyReserveAttestation(attestor); err != nil {
		t.Fatalf("valid attestation rejected: %v", err)
	}
	tampered := price
	tampered.Derivation = new(PriceDerivation)
	*tampered.Derivation = *price.Derivation
	tampered.Derivation.DocumentHash = strings.Repeat("c", 64)
	if err := tampered.VerifyReserveAttestation(attestor); err == nil {
		t.Fatal("tampered reserve attestation accepted")
	}
	revoked := attestor
	revoked.Status = "revoked"
	if err := price.VerifyReserveAttestation(revoked); err == nil {
		t.Fatal("revoked reserve attestor accepted")
	}
}

func TestClientRequiresTimeoutAndRejectsHTTPOffLoopback(t *testing.T) {
	if _, err := New("http://192.0.2.1", &http.Client{Timeout: time.Second}); err == nil {
		t.Fatal("remote plain HTTP accepted")
	}
	if _, err := New("https://oracle.invalid", &http.Client{}); err == nil {
		t.Fatal("client without timeout accepted")
	}
}

func TestClientFetchesStrictBoundedResponse(t *testing.T) {
	now := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/prices" || request.URL.Query().Get("market") != "YNXT/YUSD_TEST" || request.URL.Query().Get("type") != "spot_price" {
			t.Fatalf("request=%s", request.URL.String())
		}
		_ = json.NewEncoder(response).Encode(validPrice(now))
	}))
	defer server.Close()
	client, err := New(server.URL, &http.Client{Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	price, err := client.Price(context.Background(), "YNXT/YUSD_TEST", "spot_price")
	if err != nil || price.Value != 1_000_000 {
		t.Fatalf("price=%+v err=%v", price, err)
	}
}
