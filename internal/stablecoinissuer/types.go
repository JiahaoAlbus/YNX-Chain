package stablecoinissuer

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	SchemaVersion       = 1
	MaxRequestBodyBytes = 64 << 10
	MaxListLimit        = 100
)

var (
	ErrNotFound        = errors.New("stablecoin control record not found")
	ErrConflict        = errors.New("stablecoin control request conflicts with existing state")
	ErrInvalid         = errors.New("invalid stablecoin control request")
	ErrNotApproved     = errors.New("stablecoin issuer or asset is not approved")
	identifierPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,127}$`)
	idempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`)
	evidencePattern    = regexp.MustCompile(`^(?:sha256:)?[0-9a-fA-F]{64}$`)
)

type Config struct {
	StatePath string
	APIKey    string
	Now       func() time.Time
}

func (c Config) normalized() (Config, error) {
	c.StatePath = strings.TrimSpace(c.StatePath)
	c.APIKey = strings.TrimSpace(c.APIKey)
	if c.StatePath == "" {
		return Config{}, errors.New("YNX_STABLECOIN_STATE_PATH is required")
	}
	if len(c.APIKey) < 16 {
		return Config{}, errors.New("YNX_STABLECOIN_API_KEY must contain at least 16 characters")
	}
	if c.Now == nil {
		c.Now = func() time.Time { return time.Now().UTC() }
	}
	return c, nil
}

type SubmitIssuerRequest struct {
	IdempotencyKey    string   `json:"idempotencyKey"`
	LegalName         string   `json:"legalName"`
	Jurisdiction      string   `json:"jurisdiction"`
	RegistryReference string   `json:"registryReference"`
	ContactDomain     string   `json:"contactDomain"`
	EvidenceHashes    []string `json:"evidenceHashes"`
}

type ReviewRequest struct {
	IdempotencyKey       string `json:"idempotencyKey"`
	Decision             string `json:"decision"`
	Reviewer             string `json:"reviewer"`
	GovernanceRequestID  string `json:"governanceRequestId"`
	DecisionEvidenceHash string `json:"decisionEvidenceHash"`
	Reason               string `json:"reason"`
}

type GovernanceDecision struct {
	Decision             string `json:"decision"`
	Reviewer             string `json:"reviewer"`
	GovernanceRequestID  string `json:"governanceRequestId"`
	DecisionEvidenceHash string `json:"decisionEvidenceHash"`
	Reason               string `json:"reason"`
	DecidedAt            string `json:"decidedAt"`
}

type Issuer struct {
	ID                string              `json:"id"`
	LegalName         string              `json:"legalName"`
	Jurisdiction      string              `json:"jurisdiction"`
	RegistryReference string              `json:"registryReference"`
	ContactDomain     string              `json:"contactDomain"`
	EvidenceHashes    []string            `json:"evidenceHashes"`
	Status            string              `json:"status"`
	SupportStatus     string              `json:"supportStatus"`
	Decision          *GovernanceDecision `json:"decision,omitempty"`
	Revocation        *GovernanceDecision `json:"revocation,omitempty"`
	CreatedAt         string              `json:"createdAt"`
	UpdatedAt         string              `json:"updatedAt"`
}

type SubmitAssetRequest struct {
	IdempotencyKey    string   `json:"idempotencyKey"`
	IssuerID          string   `json:"issuerId"`
	Symbol            string   `json:"symbol"`
	Name              string   `json:"name"`
	AssetClass        string   `json:"assetClass"`
	Canonicality      string   `json:"canonicality"`
	OriginChain       string   `json:"originChain"`
	ContractReference string   `json:"contractReference"`
	Decimals          int      `json:"decimals"`
	SupplyCeiling     string   `json:"supplyCeiling"`
	ReportedSupply    string   `json:"reportedSupply"`
	MintPolicy        string   `json:"mintPolicy"`
	BurnPolicy        string   `json:"burnPolicy"`
	LegalReviewStatus string   `json:"legalReviewStatus"`
	EvidenceHashes    []string `json:"evidenceHashes"`
}

type Asset struct {
	ID                       string              `json:"id"`
	IssuerID                 string              `json:"issuerId"`
	Symbol                   string              `json:"symbol"`
	Name                     string              `json:"name"`
	AssetClass               string              `json:"assetClass"`
	Canonicality             string              `json:"canonicality"`
	OriginChain              string              `json:"originChain"`
	ContractReference        string              `json:"contractReference"`
	Decimals                 int                 `json:"decimals"`
	SupplyCeiling            string              `json:"supplyCeiling"`
	ReportedSupply           string              `json:"reportedSupply"`
	ReservedMintIntentAmount string              `json:"reservedMintIntentAmount"`
	ReservedBurnIntentAmount string              `json:"reservedBurnIntentAmount"`
	MintPolicy               string              `json:"mintPolicy"`
	BurnPolicy               string              `json:"burnPolicy"`
	LegalReviewStatus        string              `json:"legalReviewStatus"`
	EvidenceHashes           []string            `json:"evidenceHashes"`
	Status                   string              `json:"status"`
	ExecutionEnabled         bool                `json:"executionEnabled"`
	NativeYNXT               bool                `json:"nativeYnxt"`
	Decision                 *GovernanceDecision `json:"decision,omitempty"`
	Revocation               *GovernanceDecision `json:"revocation,omitempty"`
	CreatedAt                string              `json:"createdAt"`
	UpdatedAt                string              `json:"updatedAt"`
}

type RevokeRequest struct {
	IdempotencyKey       string `json:"idempotencyKey"`
	Reviewer             string `json:"reviewer"`
	GovernanceRequestID  string `json:"governanceRequestId"`
	DecisionEvidenceHash string `json:"decisionEvidenceHash"`
	Reason               string `json:"reason"`
}

type CreateIntentRequest struct {
	IdempotencyKey    string `json:"idempotencyKey"`
	IssuerID          string `json:"issuerId"`
	Operation         string `json:"operation"`
	Amount            string `json:"amount"`
	Account           string `json:"account"`
	ExternalReference string `json:"externalReference"`
	EvidenceHash      string `json:"evidenceHash"`
}

type Intent struct {
	ID                string `json:"id"`
	AssetID           string `json:"assetId"`
	IssuerID          string `json:"issuerId"`
	Operation         string `json:"operation"`
	Amount            string `json:"amount"`
	Account           string `json:"account"`
	ExternalReference string `json:"externalReference"`
	EvidenceHash      string `json:"evidenceHash"`
	Status            string `json:"status"`
	ExecutionEnabled  bool   `json:"executionEnabled"`
	CreatedAt         string `json:"createdAt"`
}

type MutationResult[T any] struct {
	Record   T    `json:"record"`
	Replayed bool `json:"replayed"`
}

type AuditEvent struct {
	Sequence   uint64 `json:"sequence"`
	At         string `json:"at"`
	Action     string `json:"action"`
	ObjectType string `json:"objectType"`
	ObjectID   string `json:"objectId"`
	DetailHash string `json:"detailHash"`
	Previous   string `json:"previous"`
	Hash       string `json:"hash"`
}

func normalizeEvidence(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !evidencePattern.MatchString(value) {
		return "", fmt.Errorf("%w: evidence hash must be a SHA-256 digest", ErrInvalid)
	}
	value = strings.ToLower(value)
	if !strings.HasPrefix(value, "sha256:") {
		value = "sha256:" + value
	}
	return value, nil
}

func normalizeEvidenceList(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > 16 {
		return nil, fmt.Errorf("%w: between 1 and 16 evidence hashes are required", ErrInvalid)
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized, err := normalizeEvidence(value)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[normalized]; exists {
			return nil, fmt.Errorf("%w: duplicate evidence hash", ErrInvalid)
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result, nil
}

func parsePositiveAmount(value string) (uint64, string, error) {
	amount, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil || amount == 0 {
		return 0, "", fmt.Errorf("%w: amount must be a positive uint64 decimal string", ErrInvalid)
	}
	return amount, strconv.FormatUint(amount, 10), nil
}

func isNativeYNXT(request SubmitAssetRequest) bool {
	compact := func(value string) string {
		value = strings.ToLower(strings.TrimSpace(value))
		return strings.NewReplacer("-", "", "_", "", " ", "", ".", "").Replace(value)
	}
	reservedExact := map[string]struct{}{
		"ynx": {}, "ynxt": {}, "native": {}, "nativeynxt": {}, "ynxnative": {}, "gas": {}, "gasasset": {},
		"resource": {}, "resourcebalance": {}, "validatorstake": {}, "protocoltreasury": {}, "treasury": {},
	}
	reservedFragments := []string{"nativeynxt", "ynxtnative", "gasasset", "gasbalance", "resourcebalance", "resourcecredit", "validatorstake", "validatorbond", "protocoltreasury"}
	for _, value := range []string{request.Symbol, request.Name, request.AssetClass, request.OriginChain, request.ContractReference} {
		candidate := compact(value)
		if _, exists := reservedExact[candidate]; exists || strings.Contains(candidate, "ynxt") {
			return true
		}
		for _, fragment := range reservedFragments {
			if strings.Contains(candidate, fragment) {
				return true
			}
		}
	}
	return false
}

func validLegalReviewStatus(value string) bool {
	switch value {
	case "pending_external_review", "issuer_attested", "independent_review_complete":
		return true
	default:
		return false
	}
}

const timeFormat = "2006-01-02T15:04:05.000000000Z"
