package oracle

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const ReserveAttestationVersion = "reserve-attestation-ed25519-v1"

type Attestor struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	PublicKeyHex       string    `json:"publicKeyHex"`
	Status             string    `json:"status"`
	AssuranceStandards []string  `json:"assuranceStandards"`
	Jurisdictions      []string  `json:"jurisdictions"`
	ValidFrom          time.Time `json:"validFrom"`
	ValidUntil         time.Time `json:"validUntil"`
	UpdatedAt          time.Time `json:"updatedAt"`
	RevocationReason   string    `json:"revocationReason,omitempty"`
}

func (attestor Attestor) Validate() error {
	if !reporterPattern.MatchString(attestor.ID) || strings.TrimSpace(attestor.Name) == "" ||
		(attestor.Status != "active" && attestor.Status != "inactive" && attestor.Status != "revoked") ||
		len(attestor.AssuranceStandards) == 0 || len(attestor.Jurisdictions) == 0 ||
		attestor.ValidFrom.IsZero() || !attestor.ValidUntil.After(attestor.ValidFrom) ||
		attestor.UpdatedAt.IsZero() ||
		(attestor.Status == "revoked" && strings.TrimSpace(attestor.RevocationReason) == "") {
		return fmt.Errorf("%w: incomplete attestor registry entry", errInvalid)
	}
	key, err := hex.DecodeString(attestor.PublicKeyHex)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: attestor public key", errInvalid)
	}
	if duplicateOrBlank(attestor.AssuranceStandards) || duplicateOrBlank(attestor.Jurisdictions) {
		return fmt.Errorf("%w: attestor coverage", errInvalid)
	}
	return nil
}

func duplicateOrBlank(values []string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return true
		}
		if _, exists := seen[value]; exists {
			return true
		}
		seen[value] = struct{}{}
	}
	return false
}

func (attestor Attestor) covers(standard, jurisdiction string) bool {
	return containsExact(attestor.AssuranceStandards, standard) && containsExact(attestor.Jurisdictions, jurisdiction)
}

func containsExact(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

type reserveAttestationPayload struct {
	AttestationVersion string    `json:"attestationVersion"`
	EvidenceID         string    `json:"evidenceId"`
	IssuerID           string    `json:"issuerId"`
	AttestorID         string    `json:"attestorId"`
	AssuranceStandard  string    `json:"assuranceStandard"`
	Jurisdiction       string    `json:"jurisdiction"`
	Unit               string    `json:"unit"`
	ReserveAssets      string    `json:"reserveAssets"`
	OutstandingClaims  string    `json:"outstandingClaims"`
	ReportingPeriodEnd time.Time `json:"reportingPeriodEnd"`
	PublishedAt        time.Time `json:"publishedAt"`
	ExpiresAt          time.Time `json:"expiresAt"`
	DocumentHash       string    `json:"documentHash"`
	Conclusion         string    `json:"conclusion"`
}

func (evidence StablecoinReserveEvidence) AttestationSigningBytes() ([]byte, error) {
	return json.Marshal(reserveAttestationPayload{
		AttestationVersion: evidence.AttestationVersion,
		EvidenceID:         evidence.EvidenceID, IssuerID: evidence.IssuerID, AttestorID: evidence.AttestorID,
		AssuranceStandard: evidence.AssuranceStandard, Jurisdiction: evidence.Jurisdiction, Unit: evidence.Unit,
		ReserveAssets: evidence.ReserveAssets, OutstandingClaims: evidence.OutstandingClaims,
		ReportingPeriodEnd: evidence.ReportingPeriodEnd.UTC(), PublishedAt: evidence.PublishedAt.UTC(),
		ExpiresAt: evidence.ExpiresAt.UTC(), DocumentHash: evidence.DocumentHash, Conclusion: evidence.Conclusion,
	})
}

func (attestor Attestor) VerifyReserveEvidence(evidence StablecoinReserveEvidence) error {
	if err := attestor.Validate(); err != nil {
		return err
	}
	if attestor.Status != "active" {
		return ErrAttestorInactive
	}
	if evidence.AttestationVersion != ReserveAttestationVersion || evidence.AttestorID != attestor.ID ||
		!attestor.covers(evidence.AssuranceStandard, evidence.Jurisdiction) ||
		evidence.PublishedAt.Before(attestor.ValidFrom) || evidence.PublishedAt.After(attestor.ValidUntil) {
		return errors.New("reserve attestation is outside attestor authority")
	}
	signature, err := hex.DecodeString(evidence.AttestationSignatureHex)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("reserve attestation signature encoding")
	}
	key, _ := hex.DecodeString(attestor.PublicKeyHex)
	payload, err := evidence.AttestationSigningBytes()
	if err != nil || !ed25519.Verify(ed25519.PublicKey(key), payload, signature) {
		return errors.New("reserve attestation signature rejected")
	}
	return nil
}
