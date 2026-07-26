package stablereserve

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestVerifierProducesExplorerAndMonitorTruth(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 26, 1, 0, 0, 0, time.UTC)
	attestation := validAttestation(now)
	sign(t, &attestation, privateKey)
	verifier := Verifier{
		Keys:   map[string]ed25519.PublicKey{"testnet-reserve-key-01": publicKey},
		MaxAge: 10 * time.Minute, Now: func() time.Time { return now },
		Asset: "YUSD", Network: "ynx-testnet",
	}

	snapshot, err := verifier.Verify(attestation)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.ExternalReserveAttested || !snapshot.Solvent || snapshot.CoverageBPS != 12_000 ||
		snapshot.ExcessReserveUnits != 200_000_000 || snapshot.ShortfallUnits != 0 ||
		snapshot.ExplorerStatus != "fully-backed-testnet-attestation" || snapshot.MonitorSeverity != "ok" ||
		!snapshot.TestnetOnly || snapshot.RealityValue || snapshot.ProductionReady || snapshot.Failure {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
	if !strings.HasPrefix(snapshot.PayloadHash, "sha256:") || len(snapshot.PayloadHash) != 71 {
		t.Fatalf("unexpected payload hash: %q", snapshot.PayloadHash)
	}
}

func TestVerifierSurfacesSignedReserveShortfall(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Date(2026, 7, 26, 1, 0, 0, 0, time.UTC)
	attestation := validAttestation(now)
	attestation.ReserveUnits = 900_000_000
	sign(t, &attestation, privateKey)

	snapshot, err := (Verifier{
		Keys:   map[string]ed25519.PublicKey{attestation.KeyID: publicKey},
		MaxAge: 10 * time.Minute, Now: func() time.Time { return now },
		Asset: "YUSD", Network: "ynx-testnet",
	}).Verify(attestation)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Solvent || !snapshot.Failure || snapshot.ShortfallUnits != 100_000_000 ||
		snapshot.CoverageBPS != 9_000 || snapshot.ExplorerStatus != "reserve-shortfall" ||
		snapshot.MonitorSeverity != "critical" || len(snapshot.FailureCodes) != 1 ||
		snapshot.FailureCodes[0] != "YNX_STABLE_RESERVE_SHORTFALL" {
		t.Fatalf("shortfall was not surfaced: %+v", snapshot)
	}
}

func TestVerifierRejectsTamperWrongBindingAndStaleEvidence(t *testing.T) {
	publicKey, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Date(2026, 7, 26, 1, 0, 0, 0, time.UTC)
	base := validAttestation(now)
	sign(t, &base, privateKey)
	verifier := Verifier{
		Keys:   map[string]ed25519.PublicKey{base.KeyID: publicKey},
		MaxAge: 10 * time.Minute, Now: func() time.Time { return now },
		Asset: "YUSD", Network: "ynx-testnet",
	}

	tampered := base
	tampered.ReserveUnits++
	if _, err := verifier.Verify(tampered); !errors.Is(err, ErrSignature) {
		t.Fatalf("tamper error = %v", err)
	}
	wrongNetwork := base
	wrongNetwork.Network = "other-testnet"
	if _, err := verifier.Verify(wrongNetwork); !errors.Is(err, ErrInvalidAttestation) {
		t.Fatalf("binding error = %v", err)
	}
	stale := validAttestation(now.Add(-11 * time.Minute))
	stale.ExpiresAt = now.Add(time.Hour).Format(time.RFC3339Nano)
	sign(t, &stale, privateKey)
	if _, err := verifier.Verify(stale); !errors.Is(err, ErrStale) {
		t.Fatalf("stale error = %v", err)
	}
	unknownKey := base
	unknownKey.KeyID = "testnet-reserve-key-02"
	sign(t, &unknownKey, privateKey)
	if _, err := verifier.Verify(unknownKey); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("unknown key error = %v", err)
	}
}

func validAttestation(asOf time.Time) Attestation {
	return Attestation{
		SchemaVersion:          SchemaVersion,
		AttestationID:          "attestation-2026-07-26-0001",
		Provider:               "reviewed-testnet-provider",
		Custodian:              "reviewed-testnet-custodian",
		Asset:                  "YUSD",
		Network:                "ynx-testnet",
		AsOf:                   asOf.Format(time.RFC3339Nano),
		ExpiresAt:              asOf.Add(time.Hour).Format(time.RFC3339Nano),
		ReserveUnits:           1_200_000_000,
		ReportedSupplyUnits:    800_000_000,
		PendingRedemptionUnits: 200_000_000,
		EvidenceURL:            "https://attestations.testnet.invalid/yusd/2026-07-26",
		EvidenceHash:           "sha256:" + strings.Repeat("a", 64),
		KeyID:                  "testnet-reserve-key-01",
	}
}

func sign(t *testing.T, attestation *Attestation, privateKey ed25519.PrivateKey) {
	t.Helper()
	payload, err := SigningPayload(*attestation)
	if err != nil {
		t.Fatal(err)
	}
	attestation.Signature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(privateKey, payload))
}
