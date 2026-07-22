package bridgegateway

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	SchemaVersion       = 2
	MaxRequestBodyBytes = 64 << 10
	MaxListLimit        = 100
)

var (
	ErrNotFound            = errors.New("bridge transfer not found")
	ErrConflict            = errors.New("bridge request conflicts with existing state")
	ErrInvalid             = errors.New("invalid bridge request")
	ErrUnauthorizedRelayer = errors.New("bridge relayer is not authorized")
	ErrInsufficientQuorum  = errors.New("bridge transfer has insufficient finality or attestations")
	identifierPattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,127}$`)
	idempotencyPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`)
)

type RoutePolicy struct {
	SourceChain        string `json:"sourceChain"`
	DestinationChain   string `json:"destinationChain"`
	SourceAsset        string `json:"sourceAsset"`
	DestinationAsset   string `json:"destinationAsset"`
	MinConfirmations   uint64 `json:"minConfirmations"`
	MaxAmount          string `json:"maxAmount"`
	MaxOutstanding     string `json:"maxOutstanding"`
	AssetBoundary      string `json:"assetBoundary"`
	ExternalSubmission bool   `json:"externalSubmission"`
}

type Config struct {
	StatePath string
	APIKey    string
	Relayers  map[string]ed25519.PublicKey
	Threshold int
	Policies  []RoutePolicy
	Now       func() time.Time
}

func (c Config) normalized() (Config, map[string]uint64, error) {
	c.StatePath = strings.TrimSpace(c.StatePath)
	c.APIKey = strings.TrimSpace(c.APIKey)
	if c.StatePath == "" {
		return Config{}, nil, errors.New("YNX_BRIDGE_STATE_PATH is required")
	}
	if c.APIKey == "" {
		return Config{}, nil, errors.New("YNX_BRIDGE_API_KEY is required")
	}
	if len(c.APIKey) < 16 {
		return Config{}, nil, errors.New("YNX_BRIDGE_API_KEY must contain at least 16 characters")
	}
	if len(c.Relayers) < 2 || c.Threshold < 2 || c.Threshold > len(c.Relayers) {
		return Config{}, nil, errors.New("bridge relayer threshold must be between 2 and the configured relayer count")
	}
	normalizedRelayers := make(map[string]ed25519.PublicKey, len(c.Relayers))
	publicKeys := map[string]struct{}{}
	for name, key := range c.Relayers {
		name = strings.ToLower(strings.TrimSpace(name))
		if !identifierPattern.MatchString(name) || len(key) != ed25519.PublicKeySize || bytes.Equal(key, make([]byte, ed25519.PublicKeySize)) {
			return Config{}, nil, fmt.Errorf("bridge relayer %q is invalid", name)
		}
		if _, exists := normalizedRelayers[name]; exists {
			return Config{}, nil, fmt.Errorf("bridge relayer %q is duplicated", name)
		}
		encodedKey := string(key)
		if _, exists := publicKeys[encodedKey]; exists {
			return Config{}, nil, fmt.Errorf("bridge relayer %q reuses another relayer public key", name)
		}
		publicKeys[encodedKey] = struct{}{}
		normalizedRelayers[name] = append(ed25519.PublicKey(nil), key...)
	}
	c.Relayers = normalizedRelayers
	if len(c.Policies) == 0 {
		return Config{}, nil, errors.New("at least one bridge route policy is required")
	}
	maxAmounts := make(map[string]uint64, len(c.Policies))
	for i := range c.Policies {
		policy := &c.Policies[i]
		policy.SourceChain = normalizeName(policy.SourceChain)
		policy.DestinationChain = normalizeName(policy.DestinationChain)
		policy.SourceAsset = normalizeAsset(policy.SourceAsset)
		policy.DestinationAsset = normalizeAsset(policy.DestinationAsset)
		policy.AssetBoundary = strings.ToLower(strings.TrimSpace(policy.AssetBoundary))
		if !identifierPattern.MatchString(policy.SourceChain) || !identifierPattern.MatchString(policy.DestinationChain) || !identifierPattern.MatchString(policy.SourceAsset) || !identifierPattern.MatchString(policy.DestinationAsset) {
			return Config{}, nil, fmt.Errorf("bridge route policy %d identity is invalid", i)
		}
		if policy.SourceChain == policy.DestinationChain || policy.MinConfirmations == 0 || policy.ExternalSubmission {
			return Config{}, nil, fmt.Errorf("bridge route policy %d must be cross-chain, finalized, and external-submission-disabled", i)
		}
		if policy.AssetBoundary != "canonical-to-represented" && policy.AssetBoundary != "represented-to-canonical" {
			return Config{}, nil, fmt.Errorf("bridge route policy %d asset boundary is invalid", i)
		}
		maximum, err := strconv.ParseUint(strings.TrimSpace(policy.MaxAmount), 10, 64)
		if err != nil || maximum == 0 {
			return Config{}, nil, fmt.Errorf("bridge route policy %d maxAmount is invalid", i)
		}
		policy.MaxAmount = strconv.FormatUint(maximum, 10)
		outstanding := maximum
		if strings.TrimSpace(policy.MaxOutstanding) != "" {
			outstanding, err = strconv.ParseUint(strings.TrimSpace(policy.MaxOutstanding), 10, 64)
			if err != nil || outstanding < maximum {
				return Config{}, nil, fmt.Errorf("bridge route policy %d maxOutstanding is invalid", i)
			}
		}
		policy.MaxOutstanding = strconv.FormatUint(outstanding, 10)
		key := routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset)
		if _, exists := maxAmounts[key]; exists {
			return Config{}, nil, fmt.Errorf("bridge route policy %d is duplicated", i)
		}
		maxAmounts[key] = maximum
	}
	if c.Now == nil {
		c.Now = func() time.Time { return time.Now().UTC() }
	}
	return c, maxAmounts, nil
}

type CreateTransferRequest struct {
	IdempotencyKey   string `json:"idempotencyKey"`
	SourceChain      string `json:"sourceChain"`
	SourceTxHash     string `json:"sourceTxHash"`
	SourceEventIndex uint64 `json:"sourceEventIndex"`
	SourceAsset      string `json:"sourceAsset"`
	DestinationChain string `json:"destinationChain"`
	DestinationAsset string `json:"destinationAsset"`
	Amount           string `json:"amount"`
	Sender           string `json:"sender"`
	Recipient        string `json:"recipient"`
}

type AttestationRequest struct {
	Relayer         string `json:"relayer"`
	SourceBlockHash string `json:"sourceBlockHash"`
	Confirmations   uint64 `json:"confirmations"`
	Signature       string `json:"signature"`
}

type FinalizeRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
}

type PauseRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Paused         bool   `json:"paused"`
	Reason         string `json:"reason"`
}

type OutcomeRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Outcome        string `json:"outcome"`
	EvidenceRef    string `json:"evidenceRef"`
	ReasonCode     string `json:"reasonCode"`
}

type ReconciliationRequest struct {
	IdempotencyKey   string `json:"idempotencyKey"`
	SourceChain      string `json:"sourceChain"`
	DestinationChain string `json:"destinationChain"`
	SourceAsset      string `json:"sourceAsset"`
	DestinationAsset string `json:"destinationAsset"`
	Locked           string `json:"locked"`
	Burned           string `json:"burned"`
	Minted           string `json:"minted"`
	Released         string `json:"released"`
	EvidenceRef      string `json:"evidenceRef"`
	ObservedAt       string `json:"observedAt"`
}

type Reconciliation struct {
	Route             RoutePolicy `json:"route"`
	Locked            string      `json:"locked"`
	Burned            string      `json:"burned"`
	Minted            string      `json:"minted"`
	Released          string      `json:"released"`
	OutstandingSupply string      `json:"outstandingSupply"`
	ReserveBacking    string      `json:"reserveBacking"`
	Difference        string      `json:"difference"`
	Balanced          bool        `json:"balanced"`
	EvidenceRef       string      `json:"evidenceRef"`
	ObservedAt        string      `json:"observedAt"`
	RecordedAt        string      `json:"recordedAt"`
	Source            string      `json:"source"`
	Verification      string      `json:"verification"`
}

type RouteExposure struct {
	Route                  RoutePolicy     `json:"route"`
	CoordinatorOutstanding string          `json:"coordinatorOutstanding"`
	TransferCount          int             `json:"transferCount"`
	LastReconciliation     *Reconciliation `json:"lastReconciliation,omitempty"`
}

type Transparency struct {
	SchemaVersion             int             `json:"schemaVersion"`
	Source                    string          `json:"source"`
	AsOf                      string          `json:"asOf"`
	Coverage                  string          `json:"coverage"`
	LiveBridge                bool            `json:"liveBridge"`
	ExternalSubmissionEnabled bool            `json:"externalSubmissionEnabled"`
	Safety                    SafetyState     `json:"safety"`
	Routes                    []RouteExposure `json:"routes"`
}

type Attestation struct {
	Relayer         string `json:"relayer"`
	SourceBlockHash string `json:"sourceBlockHash"`
	Confirmations   uint64 `json:"confirmations"`
	PayloadHash     string `json:"payloadHash"`
	Signature       string `json:"signature"`
	AttestedAt      string `json:"attestedAt"`
}

type Transfer struct {
	ID                        string                 `json:"id"`
	Status                    string                 `json:"status"`
	Phase                     string                 `json:"phase"`
	IntentDigest              string                 `json:"intentDigest"`
	SourceChain               string                 `json:"sourceChain"`
	SourceTxHash              string                 `json:"sourceTxHash"`
	SourceEventIndex          uint64                 `json:"sourceEventIndex"`
	SourceAsset               string                 `json:"sourceAsset"`
	DestinationChain          string                 `json:"destinationChain"`
	DestinationAsset          string                 `json:"destinationAsset"`
	Amount                    string                 `json:"amount"`
	Sender                    string                 `json:"sender"`
	Recipient                 string                 `json:"recipient"`
	AssetBoundary             string                 `json:"assetBoundary"`
	RequiredConfirmations     uint64                 `json:"requiredConfirmations"`
	RequiredAttestations      int                    `json:"requiredAttestations"`
	SourceBlockHash           string                 `json:"sourceBlockHash,omitempty"`
	Attestations              map[string]Attestation `json:"attestations"`
	CreatedAt                 string                 `json:"createdAt"`
	UpdatedAt                 string                 `json:"updatedAt"`
	FinalizationID            string                 `json:"finalizationId,omitempty"`
	FinalizedAt               string                 `json:"finalizedAt,omitempty"`
	OutcomeEvidenceRef        string                 `json:"outcomeEvidenceRef,omitempty"`
	FailureReasonCode         string                 `json:"failureReasonCode,omitempty"`
	PreviousPhase             string                 `json:"previousPhase,omitempty"`
	ExternalSubmissionEnabled bool                   `json:"externalSubmissionEnabled"`
}

type SafetyState struct {
	Paused    bool   `json:"paused"`
	Reason    string `json:"reason,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type MutationResult struct {
	Transfer Transfer `json:"transfer"`
	Replayed bool     `json:"replayed"`
}

type AuditEvent struct {
	Sequence   uint64 `json:"sequence"`
	At         string `json:"at"`
	Action     string `json:"action"`
	TransferID string `json:"transferId"`
	DetailHash string `json:"detailHash"`
	Previous   string `json:"previous"`
	Hash       string `json:"hash"`
}

func normalizeName(value string) string { return strings.ToLower(strings.TrimSpace(value)) }
func normalizeAsset(value string) string {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "YNXT") {
		return "YNXT"
	}
	return strings.ToLower(value)
}
func routeKey(sourceChain, destinationChain, sourceAsset, destinationAsset string) string {
	return strings.Join([]string{normalizeName(sourceChain), normalizeName(destinationChain), normalizeAsset(sourceAsset), normalizeAsset(destinationAsset)}, "|")
}
