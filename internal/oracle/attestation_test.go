package oracle

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestReserveAttestationFailsClosedWithoutTrustedAttestor(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)
	service := testService(t, &now, source)
	created, err := service.Ingest(reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified"))
	if created || !errors.Is(err, ErrAttestorNotRegistered) || len(service.store.Replay("YNXT/YUSD_TEST", ReserveEvidence, now)) != 0 {
		t.Fatalf("unregistered attestor evidence persisted: created=%v err=%v", created, err)
	}
}

func TestReserveAttestationRejectsTamperWrongAuthorityAndRevocation(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)

	t.Run("tamper", func(t *testing.T) {
		service := testService(t, &now, source)
		configureAttestors(t, service, attestor)
		observation := reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified")
		observation.ReserveEvidence.ReserveAssets = "999000000"
		observation = source.signed(t, observation)
		created, err := service.Ingest(observation)
		if created || err == nil || !strings.Contains(err.Error(), "signature rejected") {
			t.Fatalf("tampered attestation accepted: created=%v err=%v", created, err)
		}
	})

	t.Run("wrong jurisdiction", func(t *testing.T) {
		service := testService(t, &now, source)
		configureAttestors(t, service, attestor)
		observation := reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified")
		observation.ReserveEvidence.Jurisdiction = "SG"
		observation = source.signed(t, observation)
		created, err := service.Ingest(observation)
		if created || err == nil || !strings.Contains(err.Error(), "outside attestor authority") {
			t.Fatalf("out-of-authority attestation accepted: created=%v err=%v", created, err)
		}
	})

	t.Run("revoked", func(t *testing.T) {
		service := testService(t, &now, source)
		revoked := attestor
		revoked.registry.Status = "revoked"
		revoked.registry.RevocationReason = "key compromise"
		configureAttestors(t, service, revoked)
		created, err := service.Ingest(reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified"))
		if created || !errors.Is(err, ErrAttestorInactive) {
			t.Fatalf("revoked attestor accepted: created=%v err=%v", created, err)
		}
	})
}

func TestAttestorRegistryIsPublicAndHealthVersioned(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)
	service := testService(t, &now, source)
	configureAttestors(t, service, attestor)
	health := service.PublicHealth()
	if health.AttestorCount != 1 || health.ActiveAttestorCount != 1 || health.Dependencies["attestorRegistry"] != "loaded" {
		t.Fatalf("attestor health missing: %+v", health)
	}
	server, err := NewServer(service, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/attestors", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"attestor:independent-a"`) ||
		!strings.Contains(response.Body.String(), `"publicKeyHex"`) {
		t.Fatalf("attestor registry response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAttestorRevocationInvalidatesPreviouslyAcceptedReserveEvidence(t *testing.T) {
	now := time.Date(2026, 7, 26, 10, 0, 0, 0, time.UTC)
	source := reporter(t, "source-a", 1_000_000, now)
	attestor := reserveAttestor(t, "attestor:independent-a", now)
	service := testService(t, &now, source)
	configureAttestors(t, service, attestor)
	if _, err := service.Ingest(reserveObservation(t, source, attestor, 1, now, "102000000", "100000000", "unmodified")); err != nil {
		t.Fatal(err)
	}
	revoked := attestor.registry
	revoked.Status = "revoked"
	revoked.RevocationReason = "key compromise"
	service.mu.Lock()
	service.attestors[revoked.ID] = revoked
	service.mu.Unlock()
	price, err := service.Price("YNXT/YUSD_TEST", StablecoinReserve)
	if err == nil || price.Quality.Status != "last_good_stale" || !price.Quality.CircuitBreaker ||
		price.Quality.Failure != "no current unmodified reserve evidence" {
		t.Fatalf("revoked historical evidence remained authoritative: price=%+v err=%v", price, err)
	}
}
