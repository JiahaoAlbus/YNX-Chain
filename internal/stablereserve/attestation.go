package stablereserve

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const SchemaVersion = 1

var (
	ErrInvalidAttestation = errors.New("YNX_STABLE_RESERVE_INVALID_ATTESTATION")
	ErrUnknownKey         = errors.New("YNX_STABLE_RESERVE_UNKNOWN_KEY")
	ErrSignature          = errors.New("YNX_STABLE_RESERVE_SIGNATURE_FAILED")
	ErrStale              = errors.New("YNX_STABLE_RESERVE_STALE_ATTESTATION")
	identifierPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,127}$`)
	digestPattern         = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
)

type Attestation struct {
	SchemaVersion          int    `json:"schemaVersion"`
	AttestationID          string `json:"attestationId"`
	Provider               string `json:"provider"`
	Custodian              string `json:"custodian"`
	Asset                  string `json:"asset"`
	Network                string `json:"network"`
	AsOf                   string `json:"asOf"`
	ExpiresAt              string `json:"expiresAt"`
	ReserveUnits           uint64 `json:"reserveUnits"`
	ReportedSupplyUnits    uint64 `json:"reportedSupplyUnits"`
	PendingRedemptionUnits uint64 `json:"pendingRedemptionUnits"`
	EvidenceURL            string `json:"evidenceUrl"`
	EvidenceHash           string `json:"evidenceHash"`
	KeyID                  string `json:"keyId"`
	Signature              string `json:"signature"`
}

type Snapshot struct {
	SchemaVersion           int      `json:"schemaVersion"`
	Source                  string   `json:"source"`
	AsOf                    string   `json:"asOf"`
	Version                 int      `json:"version"`
	AttestationID           string   `json:"attestationId"`
	Provider                string   `json:"provider"`
	Custodian               string   `json:"custodian"`
	Asset                   string   `json:"asset"`
	Network                 string   `json:"network"`
	ReserveUnits            uint64   `json:"reserveUnits"`
	ReportedSupplyUnits     uint64   `json:"reportedSupplyUnits"`
	PendingRedemptionUnits  uint64   `json:"pendingRedemptionUnits"`
	RequiredBackingUnits    uint64   `json:"requiredBackingUnits"`
	ExcessReserveUnits      uint64   `json:"excessReserveUnits"`
	ShortfallUnits          uint64   `json:"shortfallUnits"`
	CoverageBPS             uint64   `json:"coverageBps"`
	Solvent                 bool     `json:"solvent"`
	ExternalReserveAttested bool     `json:"externalReserveAttested"`
	TestnetOnly             bool     `json:"testnetOnly"`
	RealityValue            bool     `json:"realityValue"`
	ProductionReady         bool     `json:"productionReady"`
	ExplorerStatus          string   `json:"explorerStatus"`
	MonitorSeverity         string   `json:"monitorSeverity"`
	Failure                 bool     `json:"failure"`
	FailureCodes            []string `json:"failureCodes"`
	EvidenceURL             string   `json:"evidenceUrl"`
	EvidenceHash            string   `json:"evidenceHash"`
	PayloadHash             string   `json:"payloadHash"`
	KeyID                   string   `json:"keyId"`
	ExpiresAt               string   `json:"expiresAt"`
}

type Verifier struct {
	Keys    map[string]ed25519.PublicKey
	MaxAge  time.Duration
	Now     func() time.Time
	Asset   string
	Network string
}

func (v Verifier) Verify(attestation Attestation) (Snapshot, error) {
	now := time.Now().UTC()
	if v.Now != nil {
		now = v.Now().UTC()
	}
	if v.MaxAge <= 0 {
		return Snapshot{}, fmt.Errorf("%w: max age must be positive", ErrInvalidAttestation)
	}
	if err := validateIdentity(attestation, v.Asset, v.Network); err != nil {
		return Snapshot{}, err
	}
	asOf, err := time.Parse(time.RFC3339Nano, attestation.AsOf)
	if err != nil {
		return Snapshot{}, fmt.Errorf("%w: asOf must be RFC3339", ErrInvalidAttestation)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, attestation.ExpiresAt)
	if err != nil || !expiresAt.After(asOf) {
		return Snapshot{}, fmt.Errorf("%w: expiresAt must be after asOf", ErrInvalidAttestation)
	}
	if asOf.After(now.Add(time.Minute)) || now.Sub(asOf) > v.MaxAge || now.After(expiresAt) {
		return Snapshot{}, fmt.Errorf("%w: attestation is outside its accepted time window", ErrStale)
	}
	key, ok := v.Keys[attestation.KeyID]
	if !ok || len(key) != ed25519.PublicKeySize {
		return Snapshot{}, fmt.Errorf("%w: %s", ErrUnknownKey, attestation.KeyID)
	}
	payload, err := SigningPayload(attestation)
	if err != nil {
		return Snapshot{}, err
	}
	signature, err := base64.RawStdEncoding.DecodeString(attestation.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(key, payload, signature) {
		return Snapshot{}, ErrSignature
	}

	required, overflow := add(attestation.ReportedSupplyUnits, attestation.PendingRedemptionUnits)
	if overflow {
		return Snapshot{}, fmt.Errorf("%w: required backing overflows", ErrInvalidAttestation)
	}
	solvent := attestation.ReserveUnits >= required
	var excess, shortfall uint64
	if solvent {
		excess = attestation.ReserveUnits - required
	} else {
		shortfall = required - attestation.ReserveUnits
	}
	failures := []string{}
	explorerStatus := "fully-backed-testnet-attestation"
	severity := "ok"
	if !solvent {
		failures = append(failures, "YNX_STABLE_RESERVE_SHORTFALL")
		explorerStatus = "reserve-shortfall"
		severity = "critical"
	}
	payloadDigest := sha256.Sum256(payload)
	snapshot := Snapshot{
		SchemaVersion: SchemaVersion, Source: "provider-signed-testnet-reserve-attestation",
		AsOf: asOf.UTC().Format(time.RFC3339Nano), Version: SchemaVersion,
		AttestationID: attestation.AttestationID, Provider: attestation.Provider,
		Custodian: attestation.Custodian, Asset: attestation.Asset, Network: attestation.Network,
		ReserveUnits: attestation.ReserveUnits, ReportedSupplyUnits: attestation.ReportedSupplyUnits,
		PendingRedemptionUnits: attestation.PendingRedemptionUnits, RequiredBackingUnits: required,
		ExcessReserveUnits: excess, ShortfallUnits: shortfall,
		CoverageBPS: coverageBPS(attestation.ReserveUnits, required), Solvent: solvent,
		ExternalReserveAttested: true, TestnetOnly: true, RealityValue: false, ProductionReady: false,
		ExplorerStatus: explorerStatus, MonitorSeverity: severity, Failure: !solvent, FailureCodes: failures,
		EvidenceURL: attestation.EvidenceURL, EvidenceHash: attestation.EvidenceHash,
		PayloadHash: "sha256:" + hex.EncodeToString(payloadDigest[:]), KeyID: attestation.KeyID,
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339Nano),
	}
	if err := ValidateSnapshot(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}

func ValidateSnapshot(snapshot Snapshot) error {
	if snapshot.SchemaVersion != SchemaVersion ||
		snapshot.Source != "provider-signed-testnet-reserve-attestation" ||
		snapshot.Version != SchemaVersion || !snapshot.ExternalReserveAttested ||
		!snapshot.TestnetOnly || snapshot.RealityValue || snapshot.ProductionReady ||
		!identifierPattern.MatchString(snapshot.AttestationID) ||
		!identifierPattern.MatchString(snapshot.Provider) ||
		!identifierPattern.MatchString(snapshot.Custodian) ||
		!identifierPattern.MatchString(snapshot.Asset) ||
		!identifierPattern.MatchString(snapshot.Network) ||
		!identifierPattern.MatchString(snapshot.KeyID) ||
		!digestPattern.MatchString(snapshot.EvidenceHash) ||
		!digestPattern.MatchString(snapshot.PayloadHash) {
		return fmt.Errorf("%w: verified snapshot metadata is invalid", ErrInvalidAttestation)
	}
	asOf, asOfErr := time.Parse(time.RFC3339Nano, snapshot.AsOf)
	expiresAt, expiryErr := time.Parse(time.RFC3339Nano, snapshot.ExpiresAt)
	if asOfErr != nil || expiryErr != nil || !expiresAt.After(asOf) {
		return fmt.Errorf("%w: verified snapshot time is invalid", ErrInvalidAttestation)
	}
	required, overflow := add(snapshot.ReportedSupplyUnits, snapshot.PendingRedemptionUnits)
	if overflow || required != snapshot.RequiredBackingUnits ||
		snapshot.CoverageBPS != coverageBPS(snapshot.ReserveUnits, required) {
		return fmt.Errorf("%w: verified snapshot accounting is invalid", ErrInvalidAttestation)
	}
	if snapshot.ReserveUnits >= required {
		if !snapshot.Solvent || snapshot.Failure || snapshot.ExcessReserveUnits != snapshot.ReserveUnits-required ||
			snapshot.ShortfallUnits != 0 || snapshot.ExplorerStatus != "fully-backed-testnet-attestation" ||
			snapshot.MonitorSeverity != "ok" || len(snapshot.FailureCodes) != 0 {
			return fmt.Errorf("%w: solvent snapshot truth is inconsistent", ErrInvalidAttestation)
		}
	} else if snapshot.Solvent || !snapshot.Failure || snapshot.ExcessReserveUnits != 0 ||
		snapshot.ShortfallUnits != required-snapshot.ReserveUnits ||
		snapshot.ExplorerStatus != "reserve-shortfall" || snapshot.MonitorSeverity != "critical" ||
		len(snapshot.FailureCodes) != 1 || snapshot.FailureCodes[0] != "YNX_STABLE_RESERVE_SHORTFALL" {
		return fmt.Errorf("%w: shortfall snapshot truth is inconsistent", ErrInvalidAttestation)
	}
	return nil
}

func SigningPayload(attestation Attestation) ([]byte, error) {
	attestation.Signature = ""
	if attestation.SchemaVersion != SchemaVersion {
		return nil, fmt.Errorf("%w: unsupported schema version", ErrInvalidAttestation)
	}
	return json.Marshal(attestation)
}

func validateIdentity(attestation Attestation, expectedAsset, expectedNetwork string) error {
	for name, value := range map[string]string{
		"attestationId": attestation.AttestationID,
		"provider":      attestation.Provider,
		"custodian":     attestation.Custodian,
		"asset":         attestation.Asset,
		"network":       attestation.Network,
		"keyId":         attestation.KeyID,
	} {
		if !identifierPattern.MatchString(strings.TrimSpace(value)) {
			return fmt.Errorf("%w: %s is invalid", ErrInvalidAttestation, name)
		}
	}
	if expectedAsset == "" || expectedNetwork == "" ||
		attestation.Asset != expectedAsset || attestation.Network != expectedNetwork {
		return fmt.Errorf("%w: asset or network binding mismatch", ErrInvalidAttestation)
	}
	evidenceURL, err := url.Parse(attestation.EvidenceURL)
	if err != nil || evidenceURL.Scheme != "https" || evidenceURL.Host == "" || evidenceURL.User != nil {
		return fmt.Errorf("%w: evidenceUrl must be an absolute HTTPS URL without credentials", ErrInvalidAttestation)
	}
	if !digestPattern.MatchString(attestation.EvidenceHash) {
		return fmt.Errorf("%w: evidenceHash must be a lowercase SHA-256 digest", ErrInvalidAttestation)
	}
	if attestation.ReserveUnits == 0 || attestation.ReportedSupplyUnits == 0 {
		return fmt.Errorf("%w: reserve and supply must be positive", ErrInvalidAttestation)
	}
	return nil
}

func add(left, right uint64) (uint64, bool) {
	sum := left + right
	return sum, sum < left
}

func coverageBPS(reserve, required uint64) uint64 {
	if required == 0 {
		return 0
	}
	numerator := new(big.Int).SetUint64(reserve)
	numerator.Mul(numerator, big.NewInt(10_000))
	numerator.Div(numerator, new(big.Int).SetUint64(required))
	if !numerator.IsUint64() {
		return ^uint64(0)
	}
	return numerator.Uint64()
}
