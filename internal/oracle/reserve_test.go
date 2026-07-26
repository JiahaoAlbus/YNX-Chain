package oracle

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type testAttestor struct {
	registry Attestor
	private  ed25519.PrivateKey
}

func reserveAttestor(t *testing.T, id string, now time.Time) testAttestor {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	value := Attestor{
		ID: id, Name: "Independent reserve attestor " + id, PublicKeyHex: hex.EncodeToString(public), Status: "active",
		AssuranceStandards: []string{"ISAE 3000 limited assurance"}, Jurisdictions: []string{"US"},
		ValidFrom: now.Add(-365 * 24 * time.Hour), ValidUntil: now.Add(365 * 24 * time.Hour), UpdatedAt: now,
	}
	if err := value.Validate(); err != nil {
		t.Fatal(err)
	}
	return testAttestor{registry: value, private: private}
}

func configureAttestors(t *testing.T, service *Service, values ...testAttestor) {
	t.Helper()
	registry := make([]Attestor, 0, len(values))
	for _, value := range values {
		registry = append(registry, value.registry)
	}
	if err := service.ConfigureAttestors(registry); err != nil {
		t.Fatal(err)
	}
}

func reserveObservation(t *testing.T, source testReporter, signer testAttestor, sequence uint64, now time.Time, assets, claims, conclusion string) Observation {
	t.Helper()
	observation := structuredBase(source, sequence, ReserveEvidence, now)
	observation.ReserveEvidence = &StablecoinReserveEvidence{
		AttestationVersion: ReserveAttestationVersion,
		EvidenceID:         "evidence-2026-06", IssuerID: "issuer:yusd-test", AttestorID: signer.registry.ID,
		AssuranceStandard: "ISAE 3000 limited assurance", Jurisdiction: "US", Unit: "USD",
		ReserveAssets: assets, OutstandingClaims: claims,
		ReportingPeriodEnd: now.Add(-24 * time.Hour), PublishedAt: now.Add(-12 * time.Hour),
		ExpiresAt: now.Add(30 * 24 * time.Hour), DocumentHash: strings.Repeat("a", 64), Conclusion: conclusion,
	}
	payload, err := observation.ReserveEvidence.AttestationSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	observation.ReserveEvidence.AttestationSignatureHex = hex.EncodeToString(ed25519.Sign(signer.private, payload))
	return source.signed(t, observation)
}

func TestProviderCannotPublishReserveRatioDirectly(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	observation := scalarObservation(t, source, 1, StablecoinReserve, 1_020_000, 1_000_000, now)
	if err := observation.Verify(source.provider, "ynx-oracle-testnet-v1"); err == nil {
		t.Fatal("provider-published reserve ratio accepted")
	}
}

func TestServiceDerivesReserveRatioFromCurrentUnmodifiedEvidence(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)
	service := testService(t, &now, source)
	configureAttestors(t, service, attestor)
	observation := reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified")
	if _, err := service.Ingest(observation); err != nil {
		t.Fatal(err)
	}
	price, err := service.Price("YNXT/YUSD_TEST", StablecoinReserve)
	if err != nil {
		t.Fatal(err)
	}
	if price.Value != 1_020_000 || price.Scale != 1_000_000 || price.Version != StablecoinReservePolicyVersion ||
		price.Derivation == nil || price.Derivation.Method != "reserve_assets_divided_by_outstanding_claims" ||
		price.Derivation.ReserveAssets != "102000000" || price.Derivation.OutstandingClaims != "100000000" ||
		price.Derivation.DocumentHash != strings.Repeat("a", 64) || price.Derivation.Conclusion != "unmodified" ||
		price.Derivation.AttestationSignatureHex == "" ||
		price.Quality.Status != "good" || price.Quality.SourceLimitation == "" || len(price.LineageHash) != 64 {
		t.Fatalf("reserve ratio=%+v", price)
	}
	health := service.PublicHealth()
	if health.StablecoinReservePolicyVersion != StablecoinReservePolicyVersion ||
		health.Dependencies["stablecoinReservePolicy"] != StablecoinReservePolicyVersion {
		t.Fatalf("reserve policy absent from health: %+v", health)
	}
}

func TestStablecoinReserveEndpointReturnsDerivedEvidence(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)
	service := testService(t, &now, source)
	configureAttestors(t, service, attestor)
	if _, err := service.Ingest(reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified")); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(service, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/v1/stablecoin/reserve?market=YNXT/YUSD_TEST", nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var price Price
	if err := json.Unmarshal(response.Body.Bytes(), &price); err != nil {
		t.Fatal(err)
	}
	if price.Type != StablecoinReserve || price.Value != 1_020_000 || price.Derivation == nil {
		t.Fatalf("endpoint price=%+v", price)
	}
}

func TestReserveRatioFailsClosedForQualifiedExpiredOrConflictingEvidence(t *testing.T) {
	now := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	first := reporter(t, "source-a", 1_000_000, now)
	second := reporter(t, "source-b", 1_000_000, now)
	firstAttestor := reserveAttestor(t, "attestor:independent-a", now)
	secondAttestor := reserveAttestor(t, "attestor:independent-b", now)

	t.Run("qualified", func(t *testing.T) {
		service := testService(t, &now, first)
		configureAttestors(t, service, firstAttestor)
		if _, err := service.Ingest(reserveObservation(t, first, firstAttestor, 1, now, "102000000", "100000000", "qualified")); err != nil {
			t.Fatal(err)
		}
		price, err := service.Price("YNXT/YUSD_TEST", StablecoinReserve)
		if err == nil || !price.Quality.CircuitBreaker || price.Quality.Status != "divergent" ||
			price.Quality.Failure != "latest reserve evidence conclusion is not unmodified" {
			t.Fatalf("qualified evidence accepted: price=%+v err=%v", price, err)
		}
	})

	t.Run("expired", func(t *testing.T) {
		observation := reserveObservation(t, first, firstAttestor, 1, now, "102000000", "100000000", "unmodified")
		observation.ReserveEvidence.ExpiresAt = now.Add(-time.Hour)
		observation = first.signed(t, observation)
		if err := observation.Verify(first.provider, "ynx-oracle-testnet-v1"); err == nil {
			t.Fatal("expired evidence accepted at admission")
		}
	})

	t.Run("conflict", func(t *testing.T) {
		service := testService(t, &now, first, second)
		configureAttestors(t, service, firstAttestor, secondAttestor)
		left := reserveObservation(t, first, firstAttestor, 1, now, "102000000", "100000000", "unmodified")
		right := reserveObservation(t, second, secondAttestor, 1, now, "99000000", "100000000", "unmodified")
		right.ReserveEvidence.DocumentHash = strings.Repeat("b", 64)
		payload, err := right.ReserveEvidence.AttestationSigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		right.ReserveEvidence.AttestationSignatureHex = hex.EncodeToString(ed25519.Sign(secondAttestor.private, payload))
		right = second.signed(t, right)
		if _, err := service.Ingest(left); err != nil {
			t.Fatal(err)
		}
		if _, err := service.Ingest(right); err != nil {
			t.Fatal(err)
		}
		price, err := service.Price("YNXT/YUSD_TEST", StablecoinReserve)
		if err == nil || price.Quality.Status != "last_good_stale" || !price.Quality.Stale || !price.Quality.CircuitBreaker ||
			price.Quality.Failure != "conflicting reserve evidence for the latest reporting period" {
			t.Fatalf("conflicting evidence accepted: price=%+v err=%v", price, err)
		}
	})
}
