package oracle

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"sort"
	"time"
)

const StablecoinReservePolicyVersion = "stablecoin-reserve-v1"

type StablecoinReservePolicy struct {
	Version            string        `json:"version"`
	MaximumEvidenceAge time.Duration `json:"maximumEvidenceAge"`
	Scale              int64         `json:"scale"`
}

func DefaultStablecoinReservePolicy() StablecoinReservePolicy {
	return StablecoinReservePolicy{
		Version:            StablecoinReservePolicyVersion,
		MaximumEvidenceAge: 35 * 24 * time.Hour,
		Scale:              1_000_000,
	}
}

func (policy StablecoinReservePolicy) validate() error {
	if policy.Version == "" || policy.MaximumEvidenceAge <= 0 || policy.Scale <= 0 {
		return errors.New("invalid stablecoin reserve policy")
	}
	return nil
}

func deriveStablecoinReserveRatio(now time.Time, market string, observations []Observation, providers map[string]Provider, attestors map[string]Attestor, policy StablecoinReservePolicy) (Price, error) {
	if err := policy.validate(); err != nil {
		return Price{}, err
	}
	now = now.UTC()
	candidates := make([]Observation, 0, len(observations))
	rejected := make([]string, 0)
	for _, observation := range observations {
		provider, exists := providers[observation.ProviderID]
		evidence := observation.ReserveEvidence
		attestor, attestorExists := attestors[evidenceAttestorID(evidence)]
		attestationValid := attestorExists && evidence != nil && attestor.VerifyReserveEvidence(*evidence) == nil
		if !exists || provider.Status != "active" || observation.Type != ReserveEvidence || evidence == nil ||
			!attestationValid ||
			observation.Market != market || !provider.CoversMarket(market) ||
			observation.Source != provider.Endpoint || observation.SourceVersion != provider.APIVersion ||
			evidence.ReportingPeriodEnd.After(now) ||
			now.Sub(evidence.ReportingPeriodEnd) > policy.MaximumEvidenceAge || now.After(evidence.ExpiresAt) {
			rejected = append(rejected, observation.ProviderID)
			continue
		}
		candidates = append(candidates, observation)
	}
	if len(candidates) == 0 {
		result := failedReservePrice(now, market, policy, "no current unmodified reserve evidence")
		result.Quality.RejectedSources = rejected
		return result, errors.New(result.Quality.Failure)
	}
	sort.Slice(candidates, func(i, j int) bool {
		left, right := candidates[i].ReserveEvidence, candidates[j].ReserveEvidence
		if !left.ReportingPeriodEnd.Equal(right.ReportingPeriodEnd) {
			return left.ReportingPeriodEnd.After(right.ReportingPeriodEnd)
		}
		if !left.PublishedAt.Equal(right.PublishedAt) {
			return left.PublishedAt.After(right.PublishedAt)
		}
		return candidates[i].Hash < candidates[j].Hash
	})
	selected := candidates[0]
	evidence := selected.ReserveEvidence
	for _, candidate := range candidates {
		other := candidate.ReserveEvidence
		if !other.ReportingPeriodEnd.Equal(evidence.ReportingPeriodEnd) {
			break
		}
		if other.Conclusion != "unmodified" {
			result := failedReservePrice(now, market, policy, "latest reserve evidence conclusion is not unmodified")
			result.Quality.Status = "divergent"
			result.Quality.Stale = false
			result.Quality.RejectedSources = append(rejected, candidate.ProviderID)
			return result, errors.New(result.Quality.Failure)
		}
		if other.IssuerID != evidence.IssuerID || other.Unit != evidence.Unit ||
			other.ReserveAssets != evidence.ReserveAssets || other.OutstandingClaims != evidence.OutstandingClaims {
			result := failedReservePrice(now, market, policy, "conflicting reserve evidence for the latest reporting period")
			result.Quality.Status = "divergent"
			result.Quality.Stale = false
			result.Quality.RejectedSources = rejected
			return result, errors.New(result.Quality.Failure)
		}
	}
	assets, assetsOK := new(big.Int).SetString(evidence.ReserveAssets, 10)
	claims, claimsOK := new(big.Int).SetString(evidence.OutstandingClaims, 10)
	if !assetsOK || !claimsOK || assets.Sign() <= 0 || claims.Sign() <= 0 {
		return failedReservePrice(now, market, policy, "reserve evidence arithmetic is invalid"), errors.New("reserve evidence arithmetic is invalid")
	}
	ratio := new(big.Int).Mul(assets, big.NewInt(policy.Scale))
	ratio.Div(ratio, claims)
	if !ratio.IsInt64() || ratio.Sign() < 0 {
		return failedReservePrice(now, market, policy, "reserve ratio is outside the supported range"), errors.New("reserve ratio is outside the supported range")
	}
	age := now.Sub(evidence.ReportingPeriodEnd)
	confidence := int64(1_000_000)
	if age > 0 {
		agePenalty := new(big.Int).Mul(big.NewInt(age.Nanoseconds()), big.NewInt(250_000))
		agePenalty.Div(agePenalty, big.NewInt(policy.MaximumEvidenceAge.Nanoseconds()))
		if agePenalty.IsInt64() {
			confidence -= agePenalty.Int64()
		}
	}
	if confidence < 0 {
		confidence = 0
	}
	lineageDigest := sha256.Sum256([]byte(policy.Version + "\n" + selected.Hash + "\n" + evidence.DocumentHash))
	result := Price{
		Schema: SchemaVersion, Market: market, Type: StablecoinReserve, Value: ratio.Int64(), Scale: policy.Scale,
		Source: "YNX Oracle ratio derived from signed published reserve evidence", Version: policy.Version,
		AsOf: evidence.ReportingPeriodEnd.UTC(), ProducedAt: now,
		Quality: Quality{
			Status: "good", SourceCount: 1, RequiredSourceCount: 1, RejectedSources: rejected,
			SourceLimitation: "published reserve evidence only; YNX Oracle does not provide an audit opinion or mint/burn authority",
			ConfidencePPM:    confidence, CoveragePPM: 1_000_000,
		},
		ObservationIDs: []string{selected.ID}, ObservationHash: []string{selected.Hash},
		LineageHash: hex.EncodeToString(lineageDigest[:]),
		Derivation: &PriceDerivation{
			Method: "reserve_assets_divided_by_outstanding_claims", PolicyVersion: policy.Version,
			ComponentTypes: []DataType{ReserveEvidence}, ComponentLineageHashes: []string{selected.Hash},
			AttestationVersion: evidence.AttestationVersion, EvidenceID: evidence.EvidenceID,
			IssuerID: evidence.IssuerID, AttestorID: evidence.AttestorID,
			AssuranceStandard: evidence.AssuranceStandard, Jurisdiction: evidence.Jurisdiction, Unit: evidence.Unit,
			ReserveAssets: evidence.ReserveAssets, OutstandingClaims: evidence.OutstandingClaims,
			ReportingPeriodEnd: evidence.ReportingPeriodEnd.UTC(), PublishedAt: evidence.PublishedAt.UTC(),
			ExpiresAt: evidence.ExpiresAt.UTC(), DocumentHash: evidence.DocumentHash, Conclusion: evidence.Conclusion,
			AttestationSignatureHex: evidence.AttestationSignatureHex,
		},
	}
	return result, nil
}

func evidenceAttestorID(evidence *StablecoinReserveEvidence) string {
	if evidence == nil {
		return ""
	}
	return evidence.AttestorID
}

func failedReservePrice(now time.Time, market string, policy StablecoinReservePolicy, failure string) Price {
	return Price{
		Schema: SchemaVersion, Market: market, Type: StablecoinReserve,
		Source: "YNX Oracle stablecoin reserve ratio unavailable", Version: policy.Version, ProducedAt: now.UTC(),
		Quality: Quality{Status: "unavailable", Stale: true, RequiredSourceCount: 1, RejectedSources: []string{}, CircuitBreaker: true, Failure: failure},
	}
}
