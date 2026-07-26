package bridgegateway

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

const (
	SchemaVersion       = 7
	StateMachineVersion = "ynx.bridge.lifecycle.v1"
	MaxRequestBodyBytes = 64 << 10
	MaxListLimit        = 100
)

var (
	ErrNotFound              = errors.New("bridge transfer not found")
	ErrConflict              = errors.New("bridge request conflicts with existing state")
	ErrInvalid               = errors.New("invalid bridge request")
	ErrUnauthorizedRelayer   = errors.New("bridge relayer is not authorized")
	ErrInsufficientQuorum    = errors.New("bridge transfer has insufficient finality or attestations")
	identifierPattern        = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{2,127}$`)
	idempotencyPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`)
	accountDigestPattern     = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	circleCCTPTestnetDomains = map[string]uint32{
		"ethereum-sepolia":    0,
		"avalanche-fuji":      1,
		"op-sepolia":          2,
		"arbitrum-sepolia":    3,
		"solana-devnet":       5,
		"base-sepolia":        6,
		"polygon-amoy":        7,
		"unichain-sepolia":    10,
		"linea-sepolia":       11,
		"codex-testnet":       12,
		"sonic-testnet":       13,
		"world-chain-sepolia": 14,
		"monad-testnet":       15,
		"sei-testnet":         16,
		"hyperevm-testnet":    19,
		"ink-sepolia":         21,
		"plume-testnet":       22,
		"starknet-sepolia":    25,
		"arc-testnet":         26,
		"stellar-testnet":     27,
		"edge-testnet":        28,
		"injective-testnet":   29,
		"morph-hoodi":         30,
		"pharos-testnet":      31,
	}
)

type RoutePolicy struct {
	Provider                  string `json:"provider,omitempty"`
	Classification            string `json:"classification"`
	SourceChain               string `json:"sourceChain"`
	DestinationChain          string `json:"destinationChain"`
	SourceAsset               string `json:"sourceAsset"`
	DestinationAsset          string `json:"destinationAsset"`
	SourceAssetClass          string `json:"sourceAssetClass"`
	DestinationAssetClass     string `json:"destinationAssetClass"`
	MinConfirmations          uint64 `json:"minConfirmations"`
	MaxAmount                 string `json:"maxAmount"`
	MaxOutstanding            string `json:"maxOutstanding"`
	DailyLimit                string `json:"dailyLimit,omitempty"`
	UserOutstandingLimit      string `json:"userOutstandingLimit,omitempty"`
	LargeTransferThreshold    string `json:"largeTransferThreshold,omitempty"`
	LargeTransferDelaySeconds uint64 `json:"largeTransferDelaySeconds,omitempty"`
	AssetBoundary             string `json:"assetBoundary"`
	ExternalSubmission        bool   `json:"externalSubmission"`
}

type RouteAssetEndpoint struct {
	Chain            string  `json:"chain"`
	Asset            string  `json:"asset"`
	AssetClass       string  `json:"assetClass"`
	Symbol           *string `json:"symbol"`
	Decimals         *uint8  `json:"decimals"`
	Contract         *string `json:"contract"`
	ContractVerified bool    `json:"contractVerified"`
	ExplorerURL      *string `json:"explorerUrl"`
}

type RouteFeeDisclosure struct {
	Status         string  `json:"status"`
	Currency       *string `json:"currency"`
	SourceGas      *string `json:"sourceGas"`
	DestinationGas *string `json:"destinationGas"`
	ProviderFee    *string `json:"providerFee"`
	YNXFee         *string `json:"ynxFee"`
	HiddenSpread   bool    `json:"hiddenSpread"`
}

type RouteSlippageDisclosure struct {
	Status     string  `json:"status"`
	MaximumBPS *uint64 `json:"maximumBps"`
}

type RouteTimingDisclosure struct {
	Status              string  `json:"status"`
	EstimatedMinSeconds *uint64 `json:"estimatedMinSeconds"`
	EstimatedMaxSeconds *uint64 `json:"estimatedMaxSeconds"`
}

type RouteFinalityDisclosure struct {
	SourceConfirmations uint64  `json:"sourceConfirmations"`
	DestinationRule     *string `json:"destinationRule"`
	ProofVerification   string  `json:"proofVerification"`
}

type RouteRefundDisclosure struct {
	Available bool    `json:"available"`
	Mode      string  `json:"mode"`
	SLA       *string `json:"sla"`
}

type RouteCatalogEntry struct {
	ID                        string                  `json:"id"`
	Provider                  string                  `json:"provider"`
	Classification            string                  `json:"classification"`
	Availability              string                  `json:"availability"`
	FailureStatus             string                  `json:"failureStatus"`
	ProviderHealth            string                  `json:"providerHealth"`
	Source                    RouteAssetEndpoint      `json:"source"`
	Destination               RouteAssetEndpoint      `json:"destination"`
	Fees                      RouteFeeDisclosure      `json:"fees"`
	Slippage                  RouteSlippageDisclosure `json:"slippage"`
	Timing                    RouteTimingDisclosure   `json:"timing"`
	Finality                  RouteFinalityDisclosure `json:"finality"`
	Refund                    RouteRefundDisclosure   `json:"refund"`
	Risk                      []string                `json:"risk"`
	Limits                    RoutePolicy             `json:"limits"`
	Executable                bool                    `json:"executable"`
	ExternalSubmissionEnabled bool                    `json:"externalSubmissionEnabled"`
	UserSigning               string                  `json:"userSigning"`
	CredentialBoundary        string                  `json:"credentialBoundary"`
}

type RouteCatalog struct {
	SchemaVersion int                 `json:"schemaVersion"`
	Source        string              `json:"source"`
	AsOf          string              `json:"asOf"`
	Coverage      string              `json:"coverage"`
	Routes        []RouteCatalogEntry `json:"routes"`
}

type ProviderIncident struct {
	ID         string `json:"id"`
	OccurredAt string `json:"occurredAt"`
	Status     string `json:"status"`
	Summary    string `json:"summary"`
	Evidence   string `json:"evidence"`
}

type ProviderRegistryEntry struct {
	ID                        string                  `json:"id"`
	Provider                  string                  `json:"provider"`
	Product                   string                  `json:"product"`
	Classification            string                  `json:"classification"`
	RouteID                   string                  `json:"routeId"`
	SourceChain               string                  `json:"sourceChain"`
	DestinationChain          string                  `json:"destinationChain"`
	SupportedAssets           []string                `json:"supportedAssets"`
	SourceContract            *string                 `json:"sourceContract"`
	DestinationContract       *string                 `json:"destinationContract"`
	APIVersion                string                  `json:"apiVersion"`
	SDKVersion                string                  `json:"sdkVersion"`
	Authentication            string                  `json:"authentication"`
	RateLimit                 string                  `json:"rateLimit"`
	Fees                      RouteFeeDisclosure      `json:"fees"`
	Slippage                  RouteSlippageDisclosure `json:"slippage"`
	EstimatedTime             RouteTimingDisclosure   `json:"estimatedTime"`
	Finality                  RouteFinalityDisclosure `json:"finality"`
	RefundPolicy              RouteRefundDisclosure   `json:"refundPolicy"`
	RecoveryProcess           string                  `json:"recoveryProcess"`
	Limits                    RoutePolicy             `json:"limits"`
	Jurisdiction              string                  `json:"jurisdiction"`
	License                   string                  `json:"license"`
	Terms                     string                  `json:"terms"`
	DataRetention             string                  `json:"dataRetention"`
	DataRights                string                  `json:"dataRights"`
	CustodyModel              string                  `json:"custodyModel"`
	SecurityModel             string                  `json:"securityModel"`
	AuditStatus               string                  `json:"auditStatus"`
	IncidentHistory           []ProviderIncident      `json:"incidentHistory"`
	IncidentHistoryComplete   bool                    `json:"incidentHistoryComplete"`
	Health                    string                  `json:"health"`
	LastSuccess               *string                 `json:"lastSuccess"`
	LastFailure               *string                 `json:"lastFailure"`
	Fallback                  string                  `json:"fallback"`
	DecommissionPlan          string                  `json:"decommissionPlan"`
	TestnetStatus             string                  `json:"testnetStatus"`
	ProductionStatus          string                  `json:"productionStatus"`
	CredentialsRequired       bool                    `json:"credentialsRequired"`
	CredentialsConfigured     bool                    `json:"credentialsConfigured"`
	RouteSupportEvidence      *string                 `json:"routeSupportEvidence"`
	AgreementEvidence         *string                 `json:"agreementEvidence"`
	OperationalReviewEvidence *string                 `json:"operationalReviewEvidence"`
	OutageMode                string                  `json:"outageMode"`
	RouteSupportVerified      bool                    `json:"routeSupportVerified"`
	OperationalReviewApproved bool                    `json:"operationalReviewApproved"`
	AgreementApproved         bool                    `json:"agreementApproved"`
	ContractsConfigured       bool                    `json:"contractsConfigured"`
	RouteAvailable            bool                    `json:"routeAvailable"`
	Executable                bool                    `json:"executable"`
	FailureStatus             string                  `json:"failureStatus"`
}

type ProviderRegistry struct {
	SchemaVersion int                     `json:"schemaVersion"`
	Source        string                  `json:"source"`
	AsOf          string                  `json:"asOf"`
	Coverage      string                  `json:"coverage"`
	Providers     []ProviderRegistryEntry `json:"providers"`
}

type ProviderRouteConfig struct {
	Provider                  string  `json:"provider"`
	Adapter                   string  `json:"adapter"`
	Environment               string  `json:"environment"`
	BaseURL                   string  `json:"baseUrl"`
	SourceChain               string  `json:"sourceChain"`
	DestinationChain          string  `json:"destinationChain"`
	SourceAsset               string  `json:"sourceAsset"`
	DestinationAsset          string  `json:"destinationAsset"`
	SourceDomain              *uint32 `json:"sourceDomain"`
	DestinationDomain         *uint32 `json:"destinationDomain"`
	SourceSymbol              string  `json:"sourceSymbol"`
	DestinationSymbol         string  `json:"destinationSymbol"`
	SourceDecimals            *uint8  `json:"sourceDecimals"`
	DestinationDecimals       *uint8  `json:"destinationDecimals"`
	SourceTokenContract       string  `json:"sourceTokenContract"`
	DestinationTokenContract  string  `json:"destinationTokenContract"`
	SourceContract            string  `json:"sourceContract"`
	DestinationContract       string  `json:"destinationContract"`
	SourceExplorerURL         string  `json:"sourceExplorerUrl"`
	DestinationExplorerURL    string  `json:"destinationExplorerUrl"`
	FinalityThreshold         uint32  `json:"finalityThreshold"`
	EstimatedMinSeconds       uint64  `json:"estimatedMinSeconds"`
	EstimatedMaxSeconds       uint64  `json:"estimatedMaxSeconds"`
	RouteSupportVerified      bool    `json:"routeSupportVerified"`
	ContractsVerified         bool    `json:"contractsVerified"`
	AgreementApproved         bool    `json:"agreementApproved"`
	OperationalReviewApproved bool    `json:"operationalReviewApproved"`
	RouteSupportEvidenceURL   string  `json:"routeSupportEvidenceUrl"`
	AgreementEvidenceURL      string  `json:"agreementEvidenceUrl"`
	OperationalReviewURL      string  `json:"operationalReviewUrl"`
	License                   string  `json:"license"`
	TermsURL                  string  `json:"termsUrl"`
	Jurisdiction              string  `json:"jurisdiction"`
	DataRetention             string  `json:"dataRetention"`
	DataRights                string  `json:"dataRights"`
	Fallback                  string  `json:"fallback"`
	OutageMode                string  `json:"outageMode"`
}

type AssetCatalogEntry struct {
	ID                              string   `json:"id"`
	Chain                           string   `json:"chain"`
	Asset                           string   `json:"asset"`
	AssetClass                      string   `json:"assetClass"`
	Canonicality                    string   `json:"canonicality"`
	Symbol                          *string  `json:"symbol"`
	Decimals                        *uint8   `json:"decimals"`
	Contract                        *string  `json:"contract"`
	ContractVerified                bool     `json:"contractVerified"`
	ExplorerURL                     *string  `json:"explorerUrl"`
	AllowlistedForCoordinatorIntent bool     `json:"allowlistedForCoordinatorIntent"`
	Availability                    string   `json:"availability"`
	MovementModes                   []string `json:"movementModes"`
	SupplyAuthority                 string   `json:"supplyAuthority"`
	ReserveEvidence                 string   `json:"reserveEvidence"`
	ExternalExecutionEnabled        bool     `json:"externalExecutionEnabled"`
	RouteIDs                        []string `json:"routeIds"`
	Risk                            []string `json:"risk"`
}

type AssetCatalog struct {
	SchemaVersion int                 `json:"schemaVersion"`
	Source        string              `json:"source"`
	AsOf          string              `json:"asOf"`
	Coverage      string              `json:"coverage"`
	Assets        []AssetCatalogEntry `json:"assets"`
}

type StatusReconciliation struct {
	State                   string  `json:"state"`
	RecordCount             int     `json:"recordCount"`
	LatestRecordedAt        *string `json:"latestRecordedAt"`
	IndependentVerification bool    `json:"independentVerification"`
	Coverage                string  `json:"coverage"`
}

type StatusCapabilities struct {
	ReadOnlyEvidence       bool `json:"readOnlyEvidence"`
	QuoteGeneration        bool `json:"quoteGeneration"`
	QuoteExecution         bool `json:"quoteExecution"`
	WalletReviewGeneration bool `json:"walletReviewGeneration"`
	SourceSubmission       bool `json:"sourceSubmission"`
	DestinationMintRelease bool `json:"destinationMintRelease"`
	RefundExecution        bool `json:"refundExecution"`
	DisputeRecording       bool `json:"disputeRecording"`
	EmergencyExitExecution bool `json:"emergencyExitExecution"`
}

type StatusSupport struct {
	Configured      bool    `json:"configured"`
	SupportURL      *string `json:"supportUrl"`
	PrivacyURL      *string `json:"privacyUrl"`
	SecurityURL     *string `json:"securityUrl"`
	PublicStatusURL *string `json:"publicStatusUrl"`
}

type ProductStatus struct {
	SchemaVersion                    int                  `json:"schemaVersion"`
	Source                           string               `json:"source"`
	AsOf                             string               `json:"asOf"`
	Coverage                         string               `json:"coverage"`
	CoordinatorState                 string               `json:"coordinatorState"`
	ExternalBridgeState              string               `json:"externalBridgeState"`
	FailureStatus                    string               `json:"failureStatus"`
	Paused                           bool                 `json:"paused"`
	RouteCount                       int                  `json:"routeCount"`
	ProviderCount                    int                  `json:"providerCount"`
	AvailableProviderCount           int                  `json:"availableProviderCount"`
	AssetCount                       int                  `json:"assetCount"`
	TransferCount                    int                  `json:"transferCount"`
	OpenExposureTransferCount        int                  `json:"openExposureTransferCount"`
	ProviderConnection               string               `json:"providerConnection"`
	ExternalSubmissionEnabled        bool                 `json:"externalSubmissionEnabled"`
	UserAssetMovementEnabled         bool                 `json:"userAssetMovementEnabled"`
	OfficialStablecoinRouteAvailable bool                 `json:"officialStablecoinRouteAvailable"`
	DeployedPublic                   bool                 `json:"deployedPublic"`
	Reconciliation                   StatusReconciliation `json:"reconciliation"`
	Capabilities                     StatusCapabilities   `json:"capabilities"`
	Support                          StatusSupport        `json:"support"`
	Build                            buildinfo.Info       `json:"build"`
}

type StateDefinition struct {
	ID                        string `json:"id"`
	Terminal                  bool   `json:"terminal"`
	DestinationAssetAvailable bool   `json:"destinationAssetAvailable"`
	Description               string `json:"description"`
}

type StateTransition struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Condition string `json:"condition"`
}

type StateMachineDescriptor struct {
	Version       string            `json:"version"`
	Source        string            `json:"source"`
	AsOf          string            `json:"asOf"`
	States        []StateDefinition `json:"states"`
	Transitions   []StateTransition `json:"transitions"`
	LegacyAliases map[string]string `json:"legacyAliases"`
}

type Config struct {
	StatePath       string
	APIKey          string
	GatewayAPIKey   string
	QuoteSealKey    string
	Relayers        map[string]ed25519.PublicKey
	Threshold       int
	Policies        []RoutePolicy
	ProviderRoutes  []ProviderRouteConfig
	ProviderClient  *http.Client
	Now             func() time.Time
	RateLimitWindow time.Duration
	RateLimitMax    int
	RetentionPeriod time.Duration
	QuoteTTL        time.Duration
}

func (c Config) normalized() (Config, map[string]uint64, error) {
	c.StatePath = strings.TrimSpace(c.StatePath)
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.GatewayAPIKey = strings.TrimSpace(c.GatewayAPIKey)
	c.QuoteSealKey = strings.TrimSpace(c.QuoteSealKey)
	if c.StatePath == "" {
		return Config{}, nil, errors.New("YNX_BRIDGE_STATE_PATH is required")
	}
	if c.APIKey == "" {
		return Config{}, nil, errors.New("YNX_BRIDGE_API_KEY is required")
	}
	if len(c.APIKey) < 16 {
		return Config{}, nil, errors.New("YNX_BRIDGE_API_KEY must contain at least 16 characters")
	}
	if len(c.GatewayAPIKey) < 16 {
		return Config{}, nil, errors.New("YNX_BRIDGE_GATEWAY_API_KEY must contain at least 16 characters")
	}
	if c.GatewayAPIKey == c.APIKey {
		return Config{}, nil, errors.New("YNX_BRIDGE_GATEWAY_API_KEY must be distinct from the operator API key")
	}
	if len(c.QuoteSealKey) < 32 {
		return Config{}, nil, errors.New("YNX_BRIDGE_QUOTE_SEAL_KEY must contain at least 32 characters")
	}
	if c.QuoteSealKey == c.APIKey || c.QuoteSealKey == c.GatewayAPIKey {
		return Config{}, nil, errors.New("YNX_BRIDGE_QUOTE_SEAL_KEY must be distinct from Bridge access keys")
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
	assetClasses := map[string]string{}
	assetCanonicality := map[string]string{}
	for i := range c.Policies {
		policy := &c.Policies[i]
		policy.SourceChain = normalizeName(policy.SourceChain)
		policy.Provider = normalizeName(policy.Provider)
		policy.DestinationChain = normalizeName(policy.DestinationChain)
		policy.SourceAsset = normalizeAsset(policy.SourceAsset)
		policy.DestinationAsset = normalizeAsset(policy.DestinationAsset)
		policy.SourceAssetClass = normalizeName(policy.SourceAssetClass)
		policy.DestinationAssetClass = normalizeName(policy.DestinationAssetClass)
		policy.AssetBoundary = strings.ToLower(strings.TrimSpace(policy.AssetBoundary))
		policy.Classification = normalizeName(policy.Classification)
		if !identifierPattern.MatchString(policy.Provider) || !identifierPattern.MatchString(policy.SourceChain) || !identifierPattern.MatchString(policy.DestinationChain) || !identifierPattern.MatchString(policy.SourceAsset) || !identifierPattern.MatchString(policy.DestinationAsset) {
			return Config{}, nil, fmt.Errorf("bridge route policy %d identity is invalid", i)
		}
		if policy.SourceChain == policy.DestinationChain || policy.MinConfirmations == 0 || policy.ExternalSubmission {
			return Config{}, nil, fmt.Errorf("bridge route policy %d must be cross-chain, finalized, and external-submission-disabled", i)
		}
		if policy.AssetBoundary != "canonical-to-represented" && policy.AssetBoundary != "represented-to-canonical" && policy.AssetBoundary != "canonical-to-canonical" {
			return Config{}, nil, fmt.Errorf("bridge route policy %d asset boundary is invalid", i)
		}
		classifications := map[string]bool{"official-stablecoin-transfer-candidate": true, "proof-based-canonical-bridge-candidate": true, "external-bridge-adapter": true, "route-aggregator": true, "manual-operator-testnet-transfer": true}
		if !classifications[policy.Classification] {
			return Config{}, nil, fmt.Errorf("bridge route policy %d classification is invalid", i)
		}
		assetClassifications := map[string]bool{"testnet-stablecoin": true, "wrapped-test-asset": true, "ynxt-bridge-candidate": true, "other-testnet-asset-candidate": true}
		if !assetClassifications[policy.SourceAssetClass] || !assetClassifications[policy.DestinationAssetClass] {
			return Config{}, nil, fmt.Errorf("bridge route policy %d asset classification is invalid", i)
		}
		for assetKey, class := range map[string]string{policy.SourceChain + "|" + policy.SourceAsset: policy.SourceAssetClass, policy.DestinationChain + "|" + policy.DestinationAsset: policy.DestinationAssetClass} {
			if existing, ok := assetClasses[assetKey]; ok && existing != class {
				return Config{}, nil, fmt.Errorf("bridge route policy %d conflicts with asset classification", i)
			}
			assetClasses[assetKey] = class
		}
		for assetKey, canonicality := range map[string]string{policy.SourceChain + "|" + policy.SourceAsset: sourceCanonicality(policy.AssetBoundary), policy.DestinationChain + "|" + policy.DestinationAsset: destinationCanonicality(policy.AssetBoundary)} {
			if existing, ok := assetCanonicality[assetKey]; ok && existing != canonicality {
				return Config{}, nil, fmt.Errorf("bridge route policy %d conflicts with asset canonicality", i)
			}
			assetCanonicality[assetKey] = canonicality
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
		daily := outstanding
		if strings.TrimSpace(policy.DailyLimit) != "" {
			daily, err = strconv.ParseUint(strings.TrimSpace(policy.DailyLimit), 10, 64)
			if err != nil || daily == 0 {
				return Config{}, nil, fmt.Errorf("bridge route policy %d dailyLimit is invalid", i)
			}
		}
		policy.DailyLimit = strconv.FormatUint(daily, 10)
		userLimit := outstanding
		if strings.TrimSpace(policy.UserOutstandingLimit) != "" {
			userLimit, err = strconv.ParseUint(strings.TrimSpace(policy.UserOutstandingLimit), 10, 64)
			if err != nil || userLimit == 0 {
				return Config{}, nil, fmt.Errorf("bridge route policy %d userOutstandingLimit is invalid", i)
			}
		}
		policy.UserOutstandingLimit = strconv.FormatUint(userLimit, 10)
		largeThreshold := maximum
		if strings.TrimSpace(policy.LargeTransferThreshold) != "" {
			largeThreshold, err = strconv.ParseUint(strings.TrimSpace(policy.LargeTransferThreshold), 10, 64)
			if err != nil || largeThreshold == 0 || largeThreshold > maximum {
				return Config{}, nil, fmt.Errorf("bridge route policy %d largeTransferThreshold is invalid", i)
			}
		}
		if largeThreshold < maximum && policy.LargeTransferDelaySeconds == 0 {
			return Config{}, nil, fmt.Errorf("bridge route policy %d largeTransferDelaySeconds is required", i)
		}
		policy.LargeTransferThreshold = strconv.FormatUint(largeThreshold, 10)
		key := routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset)
		if _, exists := maxAmounts[key]; exists {
			return Config{}, nil, fmt.Errorf("bridge route policy %d is duplicated", i)
		}
		maxAmounts[key] = maximum
	}
	providerRoutes := make(map[string]struct{}, len(c.ProviderRoutes))
	providerAssets := make(map[string]string)
	for i := range c.ProviderRoutes {
		route := &c.ProviderRoutes[i]
		route.Provider = normalizeName(route.Provider)
		route.Adapter = normalizeName(route.Adapter)
		route.Environment = normalizeName(route.Environment)
		route.BaseURL = strings.TrimRight(strings.TrimSpace(route.BaseURL), "/")
		route.SourceChain = normalizeName(route.SourceChain)
		route.DestinationChain = normalizeName(route.DestinationChain)
		route.SourceAsset = normalizeAsset(route.SourceAsset)
		route.DestinationAsset = normalizeAsset(route.DestinationAsset)
		route.SourceSymbol = strings.ToUpper(strings.TrimSpace(route.SourceSymbol))
		route.DestinationSymbol = strings.ToUpper(strings.TrimSpace(route.DestinationSymbol))
		route.SourceTokenContract = strings.TrimSpace(route.SourceTokenContract)
		route.DestinationTokenContract = strings.TrimSpace(route.DestinationTokenContract)
		route.SourceContract = strings.TrimSpace(route.SourceContract)
		route.DestinationContract = strings.TrimSpace(route.DestinationContract)
		route.SourceExplorerURL = strings.TrimSpace(route.SourceExplorerURL)
		route.DestinationExplorerURL = strings.TrimSpace(route.DestinationExplorerURL)
		route.RouteSupportEvidenceURL = strings.TrimSpace(route.RouteSupportEvidenceURL)
		route.AgreementEvidenceURL = strings.TrimSpace(route.AgreementEvidenceURL)
		route.OperationalReviewURL = strings.TrimSpace(route.OperationalReviewURL)
		route.License = strings.TrimSpace(route.License)
		route.TermsURL = strings.TrimSpace(route.TermsURL)
		route.Jurisdiction = strings.TrimSpace(route.Jurisdiction)
		route.DataRetention = strings.TrimSpace(route.DataRetention)
		route.DataRights = strings.TrimSpace(route.DataRights)
		route.Fallback = strings.TrimSpace(route.Fallback)
		route.OutageMode = strings.TrimSpace(route.OutageMode)
		key := routeKey(route.SourceChain, route.DestinationChain, route.SourceAsset, route.DestinationAsset)
		policyIndex := -1
		for j := range c.Policies {
			policy := c.Policies[j]
			if routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset) == key {
				policyIndex = j
				break
			}
		}
		if policyIndex < 0 || c.Policies[policyIndex].Provider != route.Provider {
			return Config{}, nil, fmt.Errorf("bridge provider route %d does not match an owned route policy", i)
		}
		if _, exists := providerRoutes[key]; exists {
			return Config{}, nil, fmt.Errorf("bridge provider route %d is duplicated", i)
		}
		providerRoutes[key] = struct{}{}
		if route.Adapter != "circle-cctp-v2" || route.Environment != "testnet" || route.BaseURL != "https://iris-api-sandbox.circle.com" {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must use the official Circle CCTP V2 testnet API", i)
		}
		if route.SourceDomain == nil || route.DestinationDomain == nil || *route.SourceDomain == *route.DestinationDomain {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must bind distinct official CCTP domains", i)
		}
		sourceDomain, sourceSupported := circleCCTPTestnetDomains[route.SourceChain]
		destinationDomain, destinationSupported := circleCCTPTestnetDomains[route.DestinationChain]
		if !sourceSupported || !destinationSupported || sourceDomain != *route.SourceDomain || destinationDomain != *route.DestinationDomain {
			return Config{}, nil, fmt.Errorf("bridge provider route %d chain/domain pair is not in the inspected official CCTP testnet domain table", i)
		}
		policy := c.Policies[policyIndex]
		if policy.Classification != "official-stablecoin-transfer-candidate" || policy.SourceAssetClass != "testnet-stablecoin" || policy.DestinationAssetClass != "testnet-stablecoin" {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must bind an official testnet stablecoin candidate policy", i)
		}
		if policy.AssetBoundary != "canonical-to-canonical" {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must preserve native stablecoin canonicality", i)
		}
		if route.SourceSymbol != "USDC" || route.DestinationSymbol != "USDC" || route.SourceDecimals == nil || route.DestinationDecimals == nil || *route.SourceDecimals != 6 || *route.DestinationDecimals != 6 {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must bind native USDC metadata", i)
		}
		if !identifierPattern.MatchString(route.SourceTokenContract) || !identifierPattern.MatchString(route.DestinationTokenContract) || !identifierPattern.MatchString(route.SourceContract) || !identifierPattern.MatchString(route.DestinationContract) || !validProviderEvidenceURL(route.SourceExplorerURL) || !validProviderEvidenceURL(route.DestinationExplorerURL) {
			return Config{}, nil, fmt.Errorf("bridge provider route %d must bind token/bridge contracts and explorer evidence", i)
		}
		if route.FinalityThreshold != 1000 && route.FinalityThreshold != 2000 {
			return Config{}, nil, fmt.Errorf("bridge provider route %d finality threshold must be 1000 or 2000", i)
		}
		if route.EstimatedMinSeconds == 0 || route.EstimatedMaxSeconds < route.EstimatedMinSeconds {
			return Config{}, nil, fmt.Errorf("bridge provider route %d timing bounds are invalid", i)
		}
		if route.RouteSupportVerified && !validProviderEvidenceURL(route.RouteSupportEvidenceURL) {
			return Config{}, nil, fmt.Errorf("bridge provider route %d verified route support requires HTTPS evidence", i)
		}
		if route.AgreementApproved && (!validProviderEvidenceURL(route.AgreementEvidenceURL) || !validProviderEvidenceURL(route.TermsURL) || route.License == "") {
			return Config{}, nil, fmt.Errorf("bridge provider route %d approved agreement requires terms, license, and HTTPS evidence", i)
		}
		if route.OperationalReviewApproved && (!validProviderEvidenceURL(route.OperationalReviewURL) || route.Jurisdiction == "" || route.DataRetention == "" || route.DataRights == "" || route.Fallback == "" || route.OutageMode == "") {
			return Config{}, nil, fmt.Errorf("bridge provider route %d approved operational review requires complete evidence and policy", i)
		}
		for assetKey, metadata := range map[string]string{
			route.SourceChain + "|" + route.SourceAsset:           fmt.Sprintf("%s|%d|%s|%s", route.SourceSymbol, *route.SourceDecimals, route.SourceTokenContract, route.SourceExplorerURL),
			route.DestinationChain + "|" + route.DestinationAsset: fmt.Sprintf("%s|%d|%s|%s", route.DestinationSymbol, *route.DestinationDecimals, route.DestinationTokenContract, route.DestinationExplorerURL),
		} {
			if existing, ok := providerAssets[assetKey]; ok && existing != metadata {
				return Config{}, nil, fmt.Errorf("bridge provider route %d conflicts with provider asset metadata", i)
			}
			providerAssets[assetKey] = metadata
		}
	}
	if c.Now == nil {
		c.Now = func() time.Time { return time.Now().UTC() }
	}
	if c.RateLimitWindow == 0 {
		c.RateLimitWindow = time.Minute
	}
	if c.RateLimitMax == 0 {
		c.RateLimitMax = 5000
	}
	if c.RateLimitWindow < time.Second || c.RateLimitWindow > time.Hour || c.RateLimitMax < 1 || c.RateLimitMax > 100000 {
		return Config{}, nil, errors.New("bridge rate limit must use a 1s-1h window and max 1-100000")
	}
	if c.RetentionPeriod == 0 {
		c.RetentionPeriod = 7 * 365 * 24 * time.Hour
	}
	if c.RetentionPeriod < 24*time.Hour || c.RetentionPeriod > 10*365*24*time.Hour {
		return Config{}, nil, errors.New("bridge retention period must be between 24h and 10 years")
	}
	if c.QuoteTTL == 0 {
		c.QuoteTTL = 5 * time.Minute
	}
	if c.QuoteTTL < 30*time.Second || c.QuoteTTL > 15*time.Minute {
		return Config{}, nil, errors.New("bridge quote ttl must be between 30s and 15m")
	}
	return c, maxAmounts, nil
}

func validProviderEvidenceURL(raw string) bool {
	parsed, err := url.Parse(raw)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == ""
}

type QuoteRequest struct {
	SourceChain      string `json:"sourceChain"`
	SourceAsset      string `json:"sourceAsset"`
	DestinationChain string `json:"destinationChain"`
	DestinationAsset string `json:"destinationAsset"`
	Amount           string `json:"amount"`
	Sender           string `json:"sender"`
	Recipient        string `json:"recipient"`
}

type Quote struct {
	SchemaVersion       int                     `json:"schemaVersion"`
	Source              string                  `json:"source"`
	AsOf                string                  `json:"asOf"`
	Coverage            string                  `json:"coverage"`
	ID                  string                  `json:"id"`
	Digest              string                  `json:"quoteDigest"`
	Nonce               string                  `json:"nonce"`
	ExpiresAt           string                  `json:"expiresAt"`
	RouteID             string                  `json:"routeId"`
	Provider            string                  `json:"provider"`
	Classification      string                  `json:"classification"`
	SourceEndpoint      RouteAssetEndpoint      `json:"sourceEndpoint"`
	DestinationEndpoint RouteAssetEndpoint      `json:"destinationEndpoint"`
	Amount              string                  `json:"amount"`
	Sender              string                  `json:"sender"`
	Recipient           string                  `json:"recipient"`
	Fees                RouteFeeDisclosure      `json:"fees"`
	Slippage            RouteSlippageDisclosure `json:"slippage"`
	Timing              RouteTimingDisclosure   `json:"timing"`
	Finality            RouteFinalityDisclosure `json:"finality"`
	Refund              RouteRefundDisclosure   `json:"refund"`
	Risk                []string                `json:"risk"`
	Limits              RoutePolicy             `json:"limits"`
	Availability        string                  `json:"availability"`
	FailureStatus       string                  `json:"failureStatus"`
	Executable          bool                    `json:"executable"`
	UserSigning         string                  `json:"userSigning"`
	CredentialBoundary  string                  `json:"credentialBoundary"`
}

type GatewaySessionContext struct {
	Product   string
	SessionID string
	Account   string
	DeviceID  string
	Scope     string
	ExpiresAt time.Time
}

type WalletReviewRequest struct {
	Quote Quote `json:"quote"`
}

type WalletReview struct {
	SchemaVersion           int                     `json:"schemaVersion"`
	Source                  string                  `json:"source"`
	AsOf                    string                  `json:"asOf"`
	Coverage                string                  `json:"coverage"`
	ID                      string                  `json:"id"`
	ReviewDigest            string                  `json:"reviewDigest"`
	QuoteDigest             string                  `json:"quoteDigest"`
	QuoteExpiresAt          string                  `json:"quoteExpiresAt"`
	Product                 string                  `json:"product"`
	Account                 string                  `json:"account"`
	DeviceID                string                  `json:"deviceId"`
	SessionID               string                  `json:"sessionId"`
	SessionExpiresAt        string                  `json:"sessionExpiresAt"`
	RouteID                 string                  `json:"routeId"`
	Provider                string                  `json:"provider"`
	Classification          string                  `json:"classification"`
	SourceEndpoint          RouteAssetEndpoint      `json:"sourceEndpoint"`
	DestinationEndpoint     RouteAssetEndpoint      `json:"destinationEndpoint"`
	Amount                  string                  `json:"amount"`
	Sender                  string                  `json:"sender"`
	Recipient               string                  `json:"recipient"`
	Fees                    RouteFeeDisclosure      `json:"fees"`
	Slippage                RouteSlippageDisclosure `json:"slippage"`
	Timing                  RouteTimingDisclosure   `json:"timing"`
	Finality                RouteFinalityDisclosure `json:"finality"`
	Refund                  RouteRefundDisclosure   `json:"refund"`
	Risk                    []string                `json:"risk"`
	Limits                  RoutePolicy             `json:"limits"`
	Status                  string                  `json:"status"`
	ApprovalAllowed         bool                    `json:"approvalAllowed"`
	WalletSignatureRequired bool                    `json:"walletSignatureRequired"`
	SourceSubmissionAllowed bool                    `json:"sourceSubmissionAllowed"`
	FailureStatus           string                  `json:"failureStatus"`
	CredentialBoundary      string                  `json:"credentialBoundary"`
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

type ProofVerificationRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	ProofType      string `json:"proofType"`
	ProofDigest    string `json:"proofDigest"`
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

type DataDeletionRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	Account        string `json:"account"`
	Reason         string `json:"reason"`
}

type DataDeletionExecuteRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
}

type DataRequest struct {
	ID                   string `json:"id"`
	Status               string `json:"status"`
	Account              string `json:"account,omitempty"`
	AccountDigest        string `json:"accountDigest"`
	Reason               string `json:"reason"`
	RequestedAt          string `json:"requestedAt"`
	EligibleAt           string `json:"eligibleAt,omitempty"`
	CompletedAt          string `json:"completedAt,omitempty"`
	MatchedTransfers     int    `json:"matchedTransfers"`
	OutstandingTransfers int    `json:"outstandingTransfers"`
	RetentionPolicy      string `json:"retentionPolicy"`
	Source               string `json:"source"`
}

type AccountDataExport struct {
	SchemaVersion    int           `json:"schemaVersion"`
	Source           string        `json:"source"`
	AsOf             string        `json:"asOf"`
	Coverage         string        `json:"coverage"`
	Account          string        `json:"account"`
	RetentionPolicy  string        `json:"retentionPolicy"`
	Transfers        []Transfer    `json:"transfers"`
	DeletionRequests []DataRequest `json:"deletionRequests"`
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

type LifecycleEvent struct {
	Sequence    uint64 `json:"sequence"`
	Phase       string `json:"phase"`
	At          string `json:"at"`
	EvidenceRef string `json:"evidenceRef,omitempty"`
	ReasonCode  string `json:"reasonCode,omitempty"`
	Source      string `json:"source"`
	Coverage    string `json:"coverage"`
}

type Transfer struct {
	ID                        string                 `json:"id"`
	Status                    string                 `json:"status"`
	Phase                     string                 `json:"phase"`
	StateMachineVersion       string                 `json:"stateMachineVersion,omitempty"`
	RouteID                   string                 `json:"routeId,omitempty"`
	MessageID                 string                 `json:"messageId,omitempty"`
	NonceDomain               string                 `json:"nonceDomain,omitempty"`
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
	ProofType                 string                 `json:"proofType,omitempty"`
	ProofDigest               string                 `json:"proofDigest,omitempty"`
	ProofVerificationStatus   string                 `json:"proofVerificationStatus,omitempty"`
	ProofVerifiedAt           string                 `json:"proofVerifiedAt,omitempty"`
	DestinationTxHash         string                 `json:"destinationTxHash,omitempty"`
	DestinationConfirmedAt    string                 `json:"destinationConfirmedAt,omitempty"`
	DestinationAvailableAt    string                 `json:"destinationAvailableAt,omitempty"`
	DestinationAssetAvailable bool                   `json:"destinationAssetAvailable"`
	NotBefore                 string                 `json:"notBefore,omitempty"`
	LargeTransferDelayApplied bool                   `json:"largeTransferDelayApplied,omitempty"`
	OutcomeEvidenceRef        string                 `json:"outcomeEvidenceRef,omitempty"`
	FailureReasonCode         string                 `json:"failureReasonCode,omitempty"`
	PreviousPhase             string                 `json:"previousPhase,omitempty"`
	Lifecycle                 []LifecycleEvent       `json:"lifecycle"`
	ExposureStatus            string                 `json:"exposureStatus"`
	ExternalSubmissionEnabled bool                   `json:"externalSubmissionEnabled"`
	SenderRedacted            bool                   `json:"senderRedacted,omitempty"`
	RecipientRedacted         bool                   `json:"recipientRedacted,omitempty"`
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
func normalizeAccount(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(strings.ToLower(value), "0x") || strings.HasPrefix(strings.ToLower(value), "ynx1") {
		return strings.ToLower(value)
	}
	return value
}
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
