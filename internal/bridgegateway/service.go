package bridgegateway

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Service struct {
	mu                 sync.Mutex
	cfg                Config
	startedAt          string
	maxAmounts         map[string]uint64
	maxOutstanding     map[string]uint64
	policies           map[string]RoutePolicy
	state              persistentState
	providerRoutes     map[string]ProviderRouteConfig
	providerClient     *http.Client
	providerMu         sync.Mutex
	providerStates     map[string]providerRuntimeState
	providerProbeStart sync.Once
	rateMu             sync.Mutex
	seen               map[string][]time.Time
	rateLimitDenied    uint64
}

type Health struct {
	OK                        bool              `json:"ok"`
	Degraded                  bool              `json:"degraded"`
	Service                   string            `json:"service"`
	SchemaVersion             int               `json:"schemaVersion"`
	StateMachineVersion       string            `json:"stateMachineVersion"`
	StartedAt                 string            `json:"startedAt"`
	NativeSymbol              string            `json:"nativeSymbol"`
	Persistence               string            `json:"persistence"`
	StateIntegrity            string            `json:"stateIntegrity"`
	ProviderStatus            string            `json:"providerStatus"`
	ContractStatus            string            `json:"contractStatus"`
	ReconciliationStatus      string            `json:"reconciliationStatus"`
	LastSuccessfulTransfer    *string           `json:"lastSuccessfulTransfer"`
	LastReconciliation        *string           `json:"lastReconciliation"`
	Dependencies              map[string]string `json:"dependencies"`
	RouteCount                int               `json:"routeCount"`
	ProviderCount             int               `json:"providerCount"`
	AvailableProviderCount    int               `json:"availableProviderCount"`
	RelayerCount              int               `json:"relayerCount"`
	RequiredAttestations      int               `json:"requiredAttestations"`
	TransferCount             int               `json:"transferCount"`
	ReadyCount                int               `json:"readyCount"`
	FinalizedLocalCount       int               `json:"finalizedLocalCount"`
	AuditEventCount           int               `json:"auditEventCount"`
	ExternalSubmissionEnabled bool              `json:"externalSubmissionEnabled"`
	LiveBridge                bool              `json:"liveBridge"`
	TruthfulStatus            string            `json:"truthfulStatus"`
	Safety                    SafetyState       `json:"safety"`
	RateLimit                 string            `json:"rateLimit"`
	RateLimitDenied           uint64            `json:"rateLimitDenied"`
	RetentionPolicy           string            `json:"retentionPolicy"`
	Build                     buildinfo.Info    `json:"build"`
}

func ValidateConfig(cfg Config) error {
	_, _, err := cfg.normalized()
	return err
}

func New(cfg Config) (*Service, error) {
	normalized, maxAmounts, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	_, statErr := os.Stat(normalized.StatePath)
	stateExists := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("stat bridge state: %w", statErr)
	}
	state, err := loadState(normalized.StatePath)
	if err != nil {
		return nil, err
	}
	needsSave := !stateExists || state.Integrity == ""
	policies := make(map[string]RoutePolicy, len(normalized.Policies))
	for _, policy := range normalized.Policies {
		policies[routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset)] = policy
	}
	maxOutstanding := make(map[string]uint64, len(normalized.Policies))
	for _, policy := range normalized.Policies {
		value, _ := strconv.ParseUint(policy.MaxOutstanding, 10, 64)
		maxOutstanding[routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset)] = value
	}
	providerRoutes := make(map[string]ProviderRouteConfig, len(normalized.ProviderRoutes))
	for _, route := range normalized.ProviderRoutes {
		providerRoutes[routeKey(route.SourceChain, route.DestinationChain, route.SourceAsset, route.DestinationAsset)] = route
	}
	service := &Service{
		cfg: normalized, startedAt: normalized.Now().UTC().Format(timeFormat),
		maxAmounts: maxAmounts, maxOutstanding: maxOutstanding, policies: policies, state: state,
		providerRoutes: providerRoutes, providerClient: newProviderHTTPClient(normalized.ProviderClient), providerStates: map[string]providerRuntimeState{},
		seen: map[string][]time.Time{},
	}
	migrated := false
	for id, transfer := range service.state.Transfers {
		transferMigrated := false
		if transfer.Phase == "" {
			switch transfer.Status {
			case "pending_attestations":
				transfer.Phase = phaseSourceSubmitted
			case "ready_for_local_finalization":
				transfer.Phase = phaseSourceFinalized
			case "finalized_local":
				transfer.Phase = phaseProofAttestationAvailable
			default:
				return nil, fmt.Errorf("bridge persisted transfer %s has unknown legacy status", id)
			}
			transferMigrated = true
		}
		if transfer.StateMachineVersion == "" {
			route := routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset)
			transfer.StateMachineVersion = "ynx.bridge.lifecycle.legacy.v0"
			if policy, ok := policies[route]; ok {
				transfer.RouteID = routeCatalogID(route, policy)
			}
			transfer.MessageID = "msg_" + hashText("ynx-bridge-message-v1|" + transfer.SourceChain + "|" + transfer.SourceTxHash + "|" + strconv.FormatUint(transfer.SourceEventIndex, 10) + "|" + transfer.IntentDigest)[:32]
			transfer.NonceDomain = "nonce_" + hashText(route)[:24]
			transfer.Phase = canonicalOutcome(transfer.Phase)
			transfer.PreviousPhase = canonicalOutcome(transfer.PreviousPhase)
			for index := range transfer.Lifecycle {
				transfer.Lifecycle[index].Phase = canonicalOutcome(transfer.Lifecycle[index].Phase)
			}
			switch transfer.ExposureStatus {
			case "destination-confirmed":
				transfer.ExposureStatus = "destination-confirmed-legacy"
			case "refund-recovered":
				transfer.ExposureStatus = "refunded"
			}
			transfer.DestinationAssetAvailable = false
			if transfer.Phase == phaseProofAttestationAvailable || transfer.Phase == phaseDestinationActionSubmitted || transfer.Phase == phaseDestinationActionConfirmed || transfer.Phase == phaseDisputed {
				transfer.ProofVerificationStatus = "legacy-not-explicitly-verified"
			}
			transferMigrated = true
		}
		if len(transfer.Lifecycle) == 0 {
			migrateLifecycle(&transfer)
			transferMigrated = true
		}
		if transfer.ExposureStatus == "" {
			migrateExposureStatus(&transfer)
			transferMigrated = true
		}
		if transferMigrated {
			service.state.Transfers[id] = transfer
			migrated = true
		}
	}
	if _, err := service.validateStateLocked(); err != nil {
		return nil, err
	}
	if needsSave || migrated {
		if err := saveState(normalized.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	service.probeConfiguredProviderConnectivity()
	return service, nil
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	if value == "" || len(value) != len(s.cfg.APIKey) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func (s *Service) AuthorizedGateway(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	if value == "" || len(value) != len(s.cfg.GatewayAPIKey) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.GatewayAPIKey)) == 1
}

func (s *Service) Allow(remoteAddr, accessKey string, now time.Time) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		host = strings.TrimSpace(remoteAddr)
	}
	key := host + "|" + hashText(strings.TrimSpace(strings.TrimPrefix(accessKey, "Bearer ")))
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	cutoff := now.UTC().Add(-s.cfg.RateLimitWindow)
	recent := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= s.cfg.RateLimitMax {
		s.seen[key] = recent
		s.rateLimitDenied++
		return false
	}
	s.seen[key] = append(recent, now.UTC())
	return true
}

func (s *Service) RateLimitSnapshot() (string, uint64) {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	return fmt.Sprintf("%d per %s per api-key/ip", s.cfg.RateLimitMax, s.cfg.RateLimitWindow), s.rateLimitDenied
}

func (s *Service) RetentionPolicy() string {
	return s.cfg.RetentionPeriod.String() + " after last transfer update; financial evidence retained after identity redaction"
}

func (s *Service) CreateTransfer(request CreateTransferRequest) (MutationResult, error) {
	normalized, policy, maximum, digest, eventKey, err := s.normalizeCreate(request)
	if err != nil {
		return MutationResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Safety.Paused {
		return MutationResult{}, fmt.Errorf("%w: bridge is paused", ErrConflict)
	}
	if existing, ok := s.state.CreateIdempotency[normalized.IdempotencyKey]; ok {
		if existing.Digest != digest {
			return MutationResult{}, fmt.Errorf("%w: idempotency key reused with changed input", ErrConflict)
		}
		return MutationResult{Transfer: cloneTransfer(s.state.Transfers[existing.TransferID]), Replayed: true}, nil
	}
	if existingID, ok := s.state.SourceEvents[eventKey]; ok {
		return MutationResult{}, fmt.Errorf("%w: source event already belongs to %s", ErrConflict, existingID)
	}
	amount, _ := strconv.ParseUint(normalized.Amount, 10, 64)
	if amount == 0 || amount > maximum {
		return MutationResult{}, fmt.Errorf("%w: amount exceeds route policy", ErrInvalid)
	}
	route := routeKey(normalized.SourceChain, normalized.DestinationChain, normalized.SourceAsset, normalized.DestinationAsset)
	var outstanding uint64
	var userOutstanding uint64
	var dailyTotal uint64
	nowTime := s.cfg.Now().UTC()
	today := nowTime.Format("2006-01-02")
	for _, existing := range s.state.Transfers {
		if routeKey(existing.SourceChain, existing.DestinationChain, existing.SourceAsset, existing.DestinationAsset) != route {
			continue
		}
		value, _ := strconv.ParseUint(existing.Amount, 10, 64)
		if strings.HasPrefix(existing.CreatedAt, today) {
			if ^uint64(0)-dailyTotal < value {
				return MutationResult{}, fmt.Errorf("%w: route daily volume overflows", ErrConflict)
			}
			dailyTotal += value
		}
		if !transferExposureOpen(existing) {
			continue
		}
		if ^uint64(0)-outstanding < value {
			return MutationResult{}, fmt.Errorf("%w: route exposure overflow", ErrConflict)
		}
		outstanding += value
		if existing.Sender == normalized.Sender {
			if ^uint64(0)-userOutstanding < value {
				return MutationResult{}, fmt.Errorf("%w: user exposure overflows", ErrConflict)
			}
			userOutstanding += value
		}
	}
	if limit := s.maxOutstanding[route]; outstanding > limit || amount > limit-outstanding {
		return MutationResult{}, fmt.Errorf("%w: route outstanding exposure limit exceeded", ErrConflict)
	}
	dailyLimit, _ := strconv.ParseUint(policy.DailyLimit, 10, 64)
	if dailyTotal > dailyLimit || amount > dailyLimit-dailyTotal {
		return MutationResult{}, fmt.Errorf("%w: route daily limit exceeded", ErrConflict)
	}
	userLimit, _ := strconv.ParseUint(policy.UserOutstandingLimit, 10, 64)
	if userOutstanding > userLimit || amount > userLimit-userOutstanding {
		return MutationResult{}, fmt.Errorf("%w: user outstanding limit exceeded", ErrConflict)
	}
	now := nowTime.Format(timeFormat)
	largeThreshold, _ := strconv.ParseUint(policy.LargeTransferThreshold, 10, 64)
	largeDelayApplied := amount > largeThreshold
	notBefore := ""
	if largeDelayApplied {
		notBefore = nowTime.Add(time.Duration(policy.LargeTransferDelaySeconds) * time.Second).Format(timeFormat)
	}
	id := "brg_" + digest[len("sha256:"):len("sha256:")+24]
	routeID := routeCatalogID(route, policy)
	messageID := "msg_" + hashText("ynx-bridge-message-v1|" + eventKey + "|" + digest)[:32]
	transfer := Transfer{
		ID: id, Status: "pending_attestations", Phase: phaseSourceSubmitted, StateMachineVersion: StateMachineVersion,
		RouteID: routeID, MessageID: messageID, NonceDomain: "nonce_" + hashText(route)[:24], IntentDigest: digest,
		SourceChain: normalized.SourceChain, SourceTxHash: normalized.SourceTxHash, SourceEventIndex: normalized.SourceEventIndex, SourceAsset: normalized.SourceAsset,
		DestinationChain: normalized.DestinationChain, DestinationAsset: normalized.DestinationAsset, Amount: normalized.Amount,
		Sender: normalized.Sender, Recipient: normalized.Recipient, AssetBoundary: policy.AssetBoundary,
		RequiredConfirmations: policy.MinConfirmations, RequiredAttestations: s.cfg.Threshold, Attestations: map[string]Attestation{},
		CreatedAt: now, UpdatedAt: now, NotBefore: notBefore, LargeTransferDelayApplied: largeDelayApplied, ExposureStatus: "open", ExternalSubmissionEnabled: false,
	}
	appendLifecycle(&transfer, "source_submitted", now, "source:"+normalized.SourceTxHash, "source-event-recorded", "coordinator-source-event")
	before := cloneState(s.state)
	s.state.Transfers[id] = transfer
	s.state.SourceEvents[eventKey] = id
	s.state.CreateIdempotency[normalized.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: id}
	appendAudit(&s.state, now, "transfer_created", id, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
}

func (s *Service) Quote(request QuoteRequest) (Quote, error) {
	return s.quoteAt(request, s.cfg.Now().UTC())
}

func (s *Service) quoteAt(request QuoteRequest, asOf time.Time) (Quote, error) {
	request.SourceChain = normalizeName(request.SourceChain)
	request.DestinationChain = normalizeName(request.DestinationChain)
	request.SourceAsset = normalizeAsset(request.SourceAsset)
	request.DestinationAsset = normalizeAsset(request.DestinationAsset)
	request.Amount = strings.TrimSpace(request.Amount)
	request.Sender = normalizeAccount(request.Sender)
	request.Recipient = normalizeAccount(request.Recipient)
	if !identifierPattern.MatchString(request.Sender) || !identifierPattern.MatchString(request.Recipient) {
		return Quote{}, fmt.Errorf("%w: quote account identity is invalid", ErrInvalid)
	}
	amount, err := strconv.ParseUint(request.Amount, 10, 64)
	if err != nil || amount == 0 {
		return Quote{}, fmt.Errorf("%w: quote amount must be a positive uint64 decimal string", ErrInvalid)
	}
	request.Amount = strconv.FormatUint(amount, 10)
	key := routeKey(request.SourceChain, request.DestinationChain, request.SourceAsset, request.DestinationAsset)

	s.mu.Lock()
	policy, ok := s.policies[key]
	if !ok {
		s.mu.Unlock()
		return Quote{}, fmt.Errorf("%w: bridge quote route is not allowed", ErrInvalid)
	}
	maximum := s.maxAmounts[key]
	if amount > maximum {
		s.mu.Unlock()
		return Quote{}, fmt.Errorf("%w: quote amount exceeds route policy", ErrInvalid)
	}
	paused := s.state.Safety.Paused
	s.mu.Unlock()
	asOf = asOf.UTC()
	expiresAt := asOf.Add(s.cfg.QuoteTTL)
	entry, providerConfigured := s.providerRouteEntry(key, policy)
	failureStatus := entry.FailureStatus
	if paused {
		failureStatus = "bridge-paused"
	}
	coverage := "local-policy-bound-quote-no-live-provider-price-or-execution"
	if providerConfigured {
		coverage = "official-circle-cctp-v2-configured-no-live-provider-terms"
		if entry.Fees.Status == "live-circle-cctp-v2-fee-bps" {
			coverage = "official-circle-cctp-v2-fee-terms-with-external-submission-disabled"
		}
	}
	quote := Quote{
		SchemaVersion: 1, Source: "ynx-bridge-quote-runtime", AsOf: asOf.Format(timeFormat),
		Coverage: coverage, ExpiresAt: expiresAt.Format(timeFormat),
		RouteID: entry.ID, Provider: entry.Provider, Classification: entry.Classification,
		SourceEndpoint: entry.Source, DestinationEndpoint: entry.Destination,
		Amount: request.Amount, Sender: request.Sender, Recipient: request.Recipient,
		Fees: entry.Fees, Slippage: entry.Slippage, Timing: entry.Timing, Finality: entry.Finality, Refund: entry.Refund,
		Risk: append([]string(nil), entry.Risk...), Limits: policy,
		Availability: entry.Availability, FailureStatus: failureStatus, Executable: false,
		UserSigning: entry.UserSigning, CredentialBoundary: entry.CredentialBoundary,
	}
	quote.Digest = s.sealQuote(quote)
	quote.ID = "quote_" + hashText(quote.Digest)[:24]
	quote.Nonce = "quote_nonce_" + hashText(quote.Digest + "|" + entry.ID)[:24]
	return quote, nil
}

func (s *Service) ReviewQuote(session GatewaySessionContext, request WalletReviewRequest) (WalletReview, error) {
	session.Product = normalizeName(session.Product)
	session.SessionID = strings.TrimSpace(session.SessionID)
	session.Account = normalizeAccount(session.Account)
	session.DeviceID = strings.TrimSpace(session.DeviceID)
	session.Scope = strings.TrimSpace(session.Scope)
	now := s.cfg.Now().UTC()
	if (session.Product != "ynx-wallet" && session.Product != "ynx-web") || !identifierPattern.MatchString(session.SessionID) || !identifierPattern.MatchString(session.Account) || !strings.HasPrefix(session.Account, "ynx1") || session.Account != strings.ToLower(session.Account) || !identifierPattern.MatchString(session.DeviceID) || session.Scope != "bridge:review:create" || !now.Before(session.ExpiresAt) {
		return WalletReview{}, fmt.Errorf("%w: canonical Wallet session context is invalid or expired", ErrInvalid)
	}
	submitted := request.Quote
	if submitted.SchemaVersion != 1 || submitted.Source != "ynx-bridge-quote-runtime" || submitted.Digest == "" {
		return WalletReview{}, fmt.Errorf("%w: Wallet review requires a Bridge Quote Runtime response", ErrInvalid)
	}
	quoteAsOf, err := time.Parse(time.RFC3339Nano, submitted.AsOf)
	if err != nil || quoteAsOf.After(now) {
		return WalletReview{}, fmt.Errorf("%w: quote issuance time is invalid", ErrInvalid)
	}
	quoteExpiresAt, err := time.Parse(time.RFC3339Nano, submitted.ExpiresAt)
	if err != nil || !now.Before(quoteExpiresAt) {
		return WalletReview{}, fmt.Errorf("%w: quote is expired", ErrConflict)
	}
	key := routeKey(submitted.SourceEndpoint.Chain, submitted.DestinationEndpoint.Chain, submitted.SourceEndpoint.Asset, submitted.DestinationEndpoint.Asset)
	s.mu.Lock()
	policy, routeAllowed := s.policies[key]
	maximum := s.maxAmounts[key]
	paused := s.state.Safety.Paused
	s.mu.Unlock()
	amount, amountErr := strconv.ParseUint(submitted.Amount, 10, 64)
	expectedDigest := s.sealQuote(submitted)
	expectedID := "quote_" + hashText(expectedDigest)[:24]
	expectedNonce := "quote_nonce_" + hashText(expectedDigest + "|" + submitted.RouteID)[:24]
	if !routeAllowed || submitted.RouteID != routeCatalogID(key, policy) || submitted.Provider != policy.Provider || submitted.Classification != policy.Classification ||
		amountErr != nil || amount == 0 || amount > maximum || submitted.Amount != strconv.FormatUint(amount, 10) ||
		len(expectedDigest) != len(submitted.Digest) || subtle.ConstantTimeCompare([]byte(expectedDigest), []byte(submitted.Digest)) != 1 ||
		len(expectedID) != len(submitted.ID) || subtle.ConstantTimeCompare([]byte(expectedID), []byte(submitted.ID)) != 1 ||
		len(expectedNonce) != len(submitted.Nonce) || subtle.ConstantTimeCompare([]byte(expectedNonce), []byte(submitted.Nonce)) != 1 {
		return WalletReview{}, fmt.Errorf("%w: quote fields or digest were changed", ErrInvalid)
	}
	expected := submitted
	if paused {
		expected.FailureStatus = "bridge-paused"
		expected.Executable = false
	}
	approvalAllowed := expected.Executable && expected.Availability == "available" && expected.FailureStatus == ""
	status := "blocked"
	failureStatus := expected.FailureStatus
	if approvalAllowed {
		status = "ready-for-wallet-signature"
		failureStatus = ""
	}
	reviewedAt := now.Format(timeFormat)
	sessionExpiresAt := session.ExpiresAt.UTC().Format(timeFormat)
	material := struct {
		SchemaVersion    int    `json:"schemaVersion"`
		Product          string `json:"product"`
		Account          string `json:"account"`
		DeviceID         string `json:"deviceId"`
		SessionID        string `json:"sessionId"`
		SessionExpiresAt string `json:"sessionExpiresAt"`
		QuoteDigest      string `json:"quoteDigest"`
		QuoteExpiresAt   string `json:"quoteExpiresAt"`
		RouteID          string `json:"routeId"`
		Provider         string `json:"provider"`
		Amount           string `json:"amount"`
		Sender           string `json:"sender"`
		Recipient        string `json:"recipient"`
		Status           string `json:"status"`
		ApprovalAllowed  bool   `json:"approvalAllowed"`
		ReviewedAt       string `json:"reviewedAt"`
	}{
		SchemaVersion: 1, Product: session.Product, Account: session.Account, DeviceID: session.DeviceID,
		SessionID: session.SessionID, SessionExpiresAt: sessionExpiresAt,
		QuoteDigest: expected.Digest, QuoteExpiresAt: expected.ExpiresAt,
		RouteID: expected.RouteID, Provider: expected.Provider, Amount: expected.Amount,
		Sender: expected.Sender, Recipient: expected.Recipient, Status: status,
		ApprovalAllowed: approvalAllowed, ReviewedAt: reviewedAt,
	}
	reviewDigest := digestJSON(material)
	return WalletReview{
		SchemaVersion: 1, Source: "ynx-bridge-wallet-review-runtime", AsOf: reviewedAt,
		Coverage: "canonical-app-gateway-session-bound-review-no-wallet-signature-or-asset-movement",
		ID:       "review_" + hashText(reviewDigest)[:24], ReviewDigest: reviewDigest,
		QuoteDigest: expected.Digest, QuoteExpiresAt: expected.ExpiresAt,
		Product: session.Product, Account: session.Account, DeviceID: session.DeviceID,
		SessionID: session.SessionID, SessionExpiresAt: sessionExpiresAt,
		RouteID: expected.RouteID, Provider: expected.Provider, Classification: expected.Classification,
		SourceEndpoint: expected.SourceEndpoint, DestinationEndpoint: expected.DestinationEndpoint,
		Amount: expected.Amount, Sender: expected.Sender, Recipient: expected.Recipient,
		Fees: expected.Fees, Slippage: expected.Slippage, Timing: expected.Timing, Finality: expected.Finality, Refund: expected.Refund,
		Risk: append([]string(nil), expected.Risk...), Limits: expected.Limits,
		Status: status, ApprovalAllowed: approvalAllowed, WalletSignatureRequired: approvalAllowed,
		SourceSubmissionAllowed: false, FailureStatus: failureStatus,
		CredentialBoundary: "wallet-signs-source-intent-bridge-and-gateway-never-hold-user-private-key",
	}, nil
}

func (s *Service) sealQuote(quote Quote) string {
	quote.ID = ""
	quote.Digest = ""
	quote.Nonce = ""
	encoded, _ := json.Marshal(quote)
	mac := hmac.New(sha256.New, []byte(s.cfg.QuoteSealKey))
	_, _ = mac.Write(encoded)
	return "sha256:" + hex.EncodeToString(mac.Sum(nil))
}

func (s *Service) AddAttestation(transferID string, request AttestationRequest) (MutationResult, error) {
	transferID = strings.TrimSpace(transferID)
	relayer := normalizeName(request.Relayer)
	request.SourceBlockHash = strings.ToLower(strings.TrimSpace(request.SourceBlockHash))
	request.Signature = strings.TrimSpace(request.Signature)
	publicKey, allowed := s.cfg.Relayers[relayer]
	if !allowed {
		return MutationResult{}, ErrUnauthorizedRelayer
	}
	if !identifierPattern.MatchString(request.SourceBlockHash) || request.Confirmations == 0 {
		return MutationResult{}, fmt.Errorf("%w: source block proof is invalid", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	transfer, ok := s.state.Transfers[transferID]
	if !ok {
		return MutationResult{}, ErrNotFound
	}
	if transfer.Status == "finalized_local" {
		return MutationResult{}, fmt.Errorf("%w: finalized transfer cannot accept attestations", ErrConflict)
	}
	if request.Confirmations < transfer.RequiredConfirmations {
		return MutationResult{}, ErrInsufficientQuorum
	}
	if transfer.SourceBlockHash != "" && transfer.SourceBlockHash != request.SourceBlockHash {
		return MutationResult{}, fmt.Errorf("%w: relayers must attest the same source block", ErrConflict)
	}
	payload := AttestationPayload(transfer, relayer, request.SourceBlockHash, request.Confirmations)
	signature, err := base64.StdEncoding.Strict().DecodeString(request.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, payload, signature) {
		return MutationResult{}, fmt.Errorf("%w: attestation signature is invalid", ErrInvalid)
	}
	payloadHash := "sha256:" + hashBytes(payload)
	if existing, exists := transfer.Attestations[relayer]; exists {
		if existing.PayloadHash == payloadHash && existing.Signature == request.Signature {
			return MutationResult{Transfer: cloneTransfer(transfer), Replayed: true}, nil
		}
		return MutationResult{}, fmt.Errorf("%w: relayer already attested different input", ErrConflict)
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC().Format(timeFormat)
	transfer.SourceBlockHash = request.SourceBlockHash
	transfer.Phase = "source_accepted"
	transfer.Attestations[relayer] = Attestation{Relayer: relayer, SourceBlockHash: request.SourceBlockHash, Confirmations: request.Confirmations, PayloadHash: payloadHash, Signature: request.Signature, AttestedAt: now}
	appendLifecycle(&transfer, "source_accepted", now, "block:"+request.SourceBlockHash, "minimum-finality-observed", "relayer-attestation")
	if len(transfer.Attestations) >= transfer.RequiredAttestations {
		transfer.Status = "ready_for_local_finalization"
		transfer.Phase = "source_finalized"
		appendLifecycle(&transfer, "source_finalized", now, "block:"+request.SourceBlockHash, "threshold-attestations-reached", "relayer-quorum")
	}
	transfer.UpdatedAt = now
	s.state.Transfers[transferID] = transfer
	appendAudit(&s.state, now, "attestation_accepted", transferID, payloadHash)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
}

func (s *Service) Finalize(transferID string, request FinalizeRequest) (MutationResult, error) {
	transferID = strings.TrimSpace(transferID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) {
		return MutationResult{}, fmt.Errorf("%w: idempotency key is invalid", ErrInvalid)
	}
	digest := digestJSON(struct {
		TransferID string `json:"transferId"`
		Key        string `json:"idempotencyKey"`
	}{transferID, request.IdempotencyKey})
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Safety.Paused {
		return MutationResult{}, fmt.Errorf("%w: bridge is paused", ErrConflict)
	}
	if existing, ok := s.state.FinalizeIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest || existing.TransferID != transferID {
			return MutationResult{}, fmt.Errorf("%w: finalize idempotency key reused with changed input", ErrConflict)
		}
		return MutationResult{Transfer: cloneTransfer(s.state.Transfers[transferID]), Replayed: true}, nil
	}
	transfer, ok := s.state.Transfers[transferID]
	if !ok {
		return MutationResult{}, ErrNotFound
	}
	if transfer.Status == "finalized_local" {
		return MutationResult{}, fmt.Errorf("%w: transfer already finalized under another key", ErrConflict)
	}
	if transfer.Status != "ready_for_local_finalization" || len(transfer.Attestations) < transfer.RequiredAttestations || transfer.SourceBlockHash == "" {
		return MutationResult{}, ErrInsufficientQuorum
	}
	if transfer.LargeTransferDelayApplied {
		notBefore, err := time.Parse(time.RFC3339Nano, transfer.NotBefore)
		if err != nil || s.cfg.Now().UTC().Before(notBefore) {
			return MutationResult{}, fmt.Errorf("%w: large transfer delay has not elapsed", ErrConflict)
		}
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC().Format(timeFormat)
	transfer.Status = "finalized_local"
	transfer.Phase = phaseProofAttestationAvailable
	transfer.FinalizationID = "brf_" + hashText(transfer.ID + "|" + request.IdempotencyKey)[:24]
	transfer.FinalizedAt, transfer.UpdatedAt = now, now
	transfer.ProofType = proofTypeThresholdRelayerAttestation
	transfer.ProofDigest = proofDigestForTransfer(transfer)
	transfer.ProofVerificationStatus = "available-unverified"
	transfer.ExternalSubmissionEnabled = false
	appendLifecycle(&transfer, phaseProofAttestationAvailable, now, "audit:"+transfer.FinalizationID, "threshold-attestation-bundle-available", "local-coordinator")
	s.state.Transfers[transferID] = transfer
	s.state.FinalizeIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: transferID}
	appendAudit(&s.state, now, "transfer_finalized_local", transferID, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
}

func (s *Service) StateMachine() StateMachineDescriptor {
	return stateMachineDescriptor(s.cfg.Now())
}

func (s *Service) VerifyProof(transferID string, request ProofVerificationRequest) (MutationResult, error) {
	transferID = strings.TrimSpace(transferID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.ProofType = normalizeName(request.ProofType)
	request.ProofDigest = strings.ToLower(strings.TrimSpace(request.ProofDigest))
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || request.ProofType != proofTypeThresholdRelayerAttestation || !accountDigestPattern.MatchString(request.ProofDigest) {
		return MutationResult{}, fmt.Errorf("%w: proof verification request is invalid", ErrInvalid)
	}
	digest := digestJSON(struct {
		TransferID string                   `json:"transferId"`
		Request    ProofVerificationRequest `json:"request"`
	}{transferID, request})
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Safety.Paused {
		return MutationResult{}, fmt.Errorf("%w: bridge is paused", ErrConflict)
	}
	if existing, ok := s.state.MutationIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest || existing.TransferID != transferID {
			return MutationResult{}, fmt.Errorf("%w: proof idempotency key reused with changed input", ErrConflict)
		}
		return MutationResult{Transfer: cloneTransfer(s.state.Transfers[transferID]), Replayed: true}, nil
	}
	transfer, ok := s.state.Transfers[transferID]
	if !ok {
		return MutationResult{}, ErrNotFound
	}
	if transfer.Phase == phaseProofVerified {
		return MutationResult{}, fmt.Errorf("%w: proof already verified under another key", ErrConflict)
	}
	if transfer.Phase != phaseProofAttestationAvailable || transfer.Status != "finalized_local" || len(transfer.Attestations) < transfer.RequiredAttestations {
		return MutationResult{}, fmt.Errorf("%w: proof is not available for verification", ErrConflict)
	}
	if err := s.validatePersistedAttestations(transfer); err != nil {
		return MutationResult{}, err
	}
	expected := proofDigestForTransfer(transfer)
	if transfer.ProofType != proofTypeThresholdRelayerAttestation || transfer.ProofDigest != expected || request.ProofDigest != expected {
		return MutationResult{}, fmt.Errorf("%w: proof digest or domain binding is invalid", ErrInvalid)
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC().Format(timeFormat)
	transfer.Phase = phaseProofVerified
	transfer.ProofVerificationStatus = "verified-threshold-relayer-attestation"
	transfer.ProofVerifiedAt = now
	transfer.UpdatedAt = now
	appendLifecycle(&transfer, phaseProofVerified, now, transfer.ProofDigest, "domain-separated-threshold-signatures-reverified", "ynx-bridge-proof-verifier")
	s.state.Transfers[transferID] = transfer
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: transferID}
	appendAudit(&s.state, now, "proof_verified", transferID, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
}

func (s *Service) SetPause(request PauseRequest) (SafetyState, bool, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.Reason = strings.TrimSpace(request.Reason)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.Reason) {
		return SafetyState{}, false, fmt.Errorf("%w: pause identity or reason is invalid", ErrInvalid)
	}
	digest := digestJSON(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.MutationIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest {
			return SafetyState{}, false, fmt.Errorf("%w: mutation key reused with changed input", ErrConflict)
		}
		return s.state.Safety, true, nil
	}
	before := cloneState(s.state)
	now := s.cfg.Now().UTC().Format(timeFormat)
	s.state.Safety = SafetyState{Paused: request.Paused, Reason: request.Reason, UpdatedAt: now}
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: "safety"}
	action := "bridge_resumed"
	if request.Paused {
		action = "bridge_paused"
	}
	appendAudit(&s.state, now, action, "system", digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return SafetyState{}, false, err
	}
	return s.state.Safety, false, nil
}

func (s *Service) RecordOutcome(transferID string, request OutcomeRequest) (MutationResult, error) {
	transferID = strings.TrimSpace(transferID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	rawOutcome := normalizeName(request.Outcome)
	request.Outcome = rawOutcome
	request.EvidenceRef = strings.TrimSpace(request.EvidenceRef)
	request.ReasonCode = normalizeName(request.ReasonCode)
	canonical := canonicalOutcome(rawOutcome)
	allowed := map[string]bool{
		phaseDestinationActionSubmitted: true, phaseDestinationActionConfirmed: true, phaseDestinationAvailable: true,
		phaseFailed: true, phaseRetryable: true, phaseRefundPending: true, phaseRefunded: true,
		phaseRecoveryRequired: true, phaseDisputed: true, phaseCorrected: true,
	}
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || (rawOutcome != "retry" && !allowed[canonical]) || !identifierPattern.MatchString(request.EvidenceRef) || !identifierPattern.MatchString(request.ReasonCode) {
		return MutationResult{}, fmt.Errorf("%w: outcome evidence is invalid", ErrInvalid)
	}
	digest := digestJSON(struct {
		TransferID string         `json:"transferId"`
		Request    OutcomeRequest `json:"request"`
	}{transferID, request})
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Safety.Paused {
		return MutationResult{}, fmt.Errorf("%w: bridge is paused", ErrConflict)
	}
	if existing, ok := s.state.MutationIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest || existing.TransferID != transferID {
			return MutationResult{}, fmt.Errorf("%w: mutation key reused with changed input", ErrConflict)
		}
		return MutationResult{Transfer: cloneTransfer(s.state.Transfers[transferID]), Replayed: true}, nil
	}
	transfer, ok := s.state.Transfers[transferID]
	if !ok {
		return MutationResult{}, ErrNotFound
	}
	now := s.cfg.Now().UTC().Format(timeFormat)
	auditAction := "lifecycle_" + canonical
	if rawOutcome == "retry" {
		if transfer.Phase == phaseFailed {
			appendLifecycle(&transfer, phaseRetryable, now, request.EvidenceRef, request.ReasonCode, "operator-submitted-evidence")
			transfer.Phase = phaseRetryable
		}
		if transfer.Phase != phaseRetryable || transfer.PreviousPhase == "" || !canonicalPhases[transfer.PreviousPhase] {
			return MutationResult{}, fmt.Errorf("%w: transfer is not eligible for retry", ErrConflict)
		}
		resumePhase := transfer.PreviousPhase
		transfer.Phase, transfer.PreviousPhase, transfer.FailureReasonCode = resumePhase, "", ""
		appendLifecycle(&transfer, resumePhase, now, request.EvidenceRef, "bounded-retry-resumed", "operator-submitted-evidence")
		auditAction = "lifecycle_retry_resumed"
	} else if rawOutcome == "refund_recovery" && transfer.Phase == phaseFailed {
		appendLifecycle(&transfer, phaseRefundPending, now, request.EvidenceRef, "legacy-refund-request-confirmed", "operator-submitted-evidence")
		transfer.Phase = phaseRefundPending
		appendLifecycle(&transfer, phaseRefunded, now, request.EvidenceRef, request.ReasonCode, "operator-submitted-evidence")
		transfer.Phase = phaseRefunded
		transfer.ExposureStatus = "refunded"
		auditAction = "lifecycle_refunded"
	} else {
		if !directOutcomeTransitionAllowed(transfer.Phase, canonical) {
			return MutationResult{}, fmt.Errorf("%w: invalid lifecycle transition from %s to %s", ErrConflict, transfer.Phase, canonical)
		}
		if canonical == phaseFailed {
			transfer.PreviousPhase, transfer.FailureReasonCode = transfer.Phase, request.ReasonCode
		}
		transfer.Phase = canonical
		appendLifecycle(&transfer, canonical, now, request.EvidenceRef, request.ReasonCode, "operator-submitted-evidence")
		switch canonical {
		case phaseDestinationActionConfirmed:
			transfer.DestinationConfirmedAt = now
		case phaseDestinationAvailable:
			transfer.DestinationAssetAvailable = true
			transfer.DestinationAvailableAt = now
			transfer.ExposureStatus = "destination-available"
		case phaseRefunded:
			transfer.ExposureStatus = "refunded"
		}
	}
	transfer.OutcomeEvidenceRef = request.EvidenceRef
	transfer.UpdatedAt = now
	before := cloneState(s.state)
	s.state.Transfers[transferID] = transfer
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: transferID}
	appendAudit(&s.state, now, auditAction, transferID, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
}

func (s *Service) Reconcile(request ReconciliationRequest) (Reconciliation, bool, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.SourceChain, request.DestinationChain = normalizeName(request.SourceChain), normalizeName(request.DestinationChain)
	request.SourceAsset, request.DestinationAsset = normalizeAsset(request.SourceAsset), normalizeAsset(request.DestinationAsset)
	request.EvidenceRef, request.ObservedAt = strings.TrimSpace(request.EvidenceRef), strings.TrimSpace(request.ObservedAt)
	request.Locked, request.Burned = strings.TrimSpace(request.Locked), strings.TrimSpace(request.Burned)
	request.Minted, request.Released = strings.TrimSpace(request.Minted), strings.TrimSpace(request.Released)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.EvidenceRef) {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation identity is invalid", ErrInvalid)
	}
	observedAt, err := time.Parse(time.RFC3339Nano, request.ObservedAt)
	if err != nil || observedAt.After(s.cfg.Now().UTC()) {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation observedAt is invalid", ErrInvalid)
	}
	request.ObservedAt = observedAt.UTC().Format(timeFormat)
	values := make([]uint64, 4)
	for i, raw := range []string{request.Locked, request.Burned, request.Minted, request.Released} {
		values[i], err = strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return Reconciliation{}, false, fmt.Errorf("%w: reconciliation amounts must be uint64 decimal strings", ErrInvalid)
		}
	}
	locked, burned, minted, released := values[0], values[1], values[2], values[3]
	if burned > minted || released > locked {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation would produce negative supply or reserve", ErrInvalid)
	}
	key := routeKey(request.SourceChain, request.DestinationChain, request.SourceAsset, request.DestinationAsset)
	policy, ok := s.policies[key]
	if !ok {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation route is not allowed", ErrInvalid)
	}
	outstanding, reserve := minted-burned, locked-released
	difference := outstanding
	if reserve >= outstanding {
		difference = reserve - outstanding
	} else {
		difference = outstanding - reserve
	}
	record := Reconciliation{Route: policy, Locked: strconv.FormatUint(locked, 10), Burned: strconv.FormatUint(burned, 10), Minted: strconv.FormatUint(minted, 10), Released: strconv.FormatUint(released, 10), OutstandingSupply: strconv.FormatUint(outstanding, 10), ReserveBacking: strconv.FormatUint(reserve, 10), Difference: strconv.FormatUint(difference, 10), Balanced: difference == 0, EvidenceRef: request.EvidenceRef, ObservedAt: observedAt.UTC().Format(timeFormat), RecordedAt: s.cfg.Now().UTC().Format(timeFormat), Source: "operator-submitted-evidence", Verification: "reference-recorded-not-independently-verified"}
	digest := digestJSON(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, exists := s.state.MutationIdempotency[request.IdempotencyKey]; exists {
		if existing.Digest != digest || existing.TransferID != key {
			return Reconciliation{}, false, fmt.Errorf("%w: mutation key reused with changed input", ErrConflict)
		}
		result, ok := s.state.ReconciliationResults[request.IdempotencyKey]
		if !ok {
			if s.state.ReconciliationReplayUnavailable[request.IdempotencyKey] {
				return Reconciliation{}, false, fmt.Errorf("%w: pre-v6 reconciliation replay result is unavailable", ErrConflict)
			}
			return Reconciliation{}, false, errors.New("bridge reconciliation replay evidence is missing")
		}
		return result, true, nil
	}
	before := cloneState(s.state)
	s.state.Reconciliations[key] = record
	s.state.ReconciliationResults[request.IdempotencyKey] = record
	delete(s.state.ReconciliationReplayUnavailable, request.IdempotencyKey)
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: key}
	appendAudit(&s.state, record.RecordedAt, "reconciliation_recorded", key, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return Reconciliation{}, false, err
	}
	return record, false, nil
}

func (s *Service) ExportAccount(account string) (AccountDataExport, error) {
	account = normalizeAccount(account)
	if !identifierPattern.MatchString(account) {
		return AccountDataExport{}, fmt.Errorf("%w: export account is invalid", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result := AccountDataExport{SchemaVersion: 1, Source: "ynx-bridge-coordinator", AsOf: s.cfg.Now().UTC().Format(timeFormat), Coverage: "coordinator-records-only-not-independent-chain-history", Account: account, RetentionPolicy: s.RetentionPolicy(), Transfers: []Transfer{}, DeletionRequests: []DataRequest{}}
	for _, transfer := range s.state.Transfers {
		if transfer.Sender == account || transfer.Recipient == account {
			result.Transfers = append(result.Transfers, cloneTransfer(transfer))
		}
	}
	sort.Slice(result.Transfers, func(i, j int) bool { return result.Transfers[i].ID < result.Transfers[j].ID })
	accountDigest := "sha256:" + hashText(account)
	for _, request := range s.state.DataRequests {
		if request.Account == account || request.AccountDigest == accountDigest {
			result.DeletionRequests = append(result.DeletionRequests, request)
		}
	}
	sort.Slice(result.DeletionRequests, func(i, j int) bool { return result.DeletionRequests[i].ID < result.DeletionRequests[j].ID })
	return result, nil
}

func (s *Service) RequestDataDeletion(request DataDeletionRequest) (DataRequest, bool, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.Account = normalizeAccount(request.Account)
	request.Reason = normalizeName(request.Reason)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.Account) || !identifierPattern.MatchString(request.Reason) {
		return DataRequest{}, false, fmt.Errorf("%w: deletion request is invalid", ErrInvalid)
	}
	digest := digestJSON(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.MutationIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest {
			return DataRequest{}, false, fmt.Errorf("%w: mutation key reused with changed input", ErrConflict)
		}
		stored, ok := s.state.DataRequests[existing.TransferID]
		if !ok {
			return DataRequest{}, false, errors.New("bridge deletion request index is inconsistent")
		}
		return stored, true, nil
	}
	now := s.cfg.Now().UTC()
	matched, outstanding, eligibleAt := s.dataRetentionStateLocked(request.Account)
	status := "pending_retention"
	if outstanding > 0 {
		status = "safety_hold"
	}
	if matched == 0 {
		eligibleAt = now
	}
	id := "bdr_" + hashText(request.IdempotencyKey + "|" + digest)[:24]
	record := DataRequest{ID: id, Status: status, Account: request.Account, AccountDigest: "sha256:" + hashText(request.Account), Reason: request.Reason, RequestedAt: now.Format(timeFormat), EligibleAt: eligibleAt.Format(timeFormat), MatchedTransfers: matched, OutstandingTransfers: outstanding, RetentionPolicy: s.RetentionPolicy(), Source: "operator-submitted-data-rights-request"}
	if outstanding > 0 {
		record.EligibleAt = ""
	}
	before := cloneState(s.state)
	s.state.DataRequests[id] = record
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: id}
	appendAudit(&s.state, record.RequestedAt, "data_deletion_requested", id, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return DataRequest{}, false, err
	}
	return record, false, nil
}

func (s *Service) ExecuteDataDeletion(requestID string, request DataDeletionExecuteRequest) (DataRequest, bool, error) {
	requestID = strings.TrimSpace(requestID)
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	if !identifierPattern.MatchString(requestID) || !idempotencyPattern.MatchString(request.IdempotencyKey) {
		return DataRequest{}, false, fmt.Errorf("%w: deletion execution identity is invalid", ErrInvalid)
	}
	digest := digestJSON(struct {
		RequestID string `json:"requestId"`
		Key       string `json:"idempotencyKey"`
	}{requestID, request.IdempotencyKey})
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.state.MutationIdempotency[request.IdempotencyKey]; ok {
		if existing.Digest != digest || existing.TransferID != requestID {
			return DataRequest{}, false, fmt.Errorf("%w: mutation key reused with changed input", ErrConflict)
		}
		return s.state.DataRequests[requestID], true, nil
	}
	record, ok := s.state.DataRequests[requestID]
	if !ok {
		return DataRequest{}, false, ErrNotFound
	}
	if record.Status == "completed" || record.Account == "" {
		return DataRequest{}, false, fmt.Errorf("%w: deletion request already completed under another key", ErrConflict)
	}
	matched, outstanding, eligibleAt := s.dataRetentionStateLocked(record.Account)
	if outstanding > 0 {
		return DataRequest{}, false, fmt.Errorf("%w: active or unresolved transfers require safety retention", ErrConflict)
	}
	if s.cfg.Now().UTC().Before(eligibleAt) {
		return DataRequest{}, false, fmt.Errorf("%w: configured retention period has not elapsed", ErrConflict)
	}
	before := cloneState(s.state)
	for id, transfer := range s.state.Transfers {
		changed := false
		if transfer.Sender == record.Account {
			transfer.Sender = redactedAccount(record.AccountDigest)
			transfer.SenderRedacted = true
			changed = true
		}
		if transfer.Recipient == record.Account {
			transfer.Recipient = redactedAccount(record.AccountDigest)
			transfer.RecipientRedacted = true
			changed = true
		}
		if changed {
			s.state.Transfers[id] = transfer
		}
	}
	now := s.cfg.Now().UTC().Format(timeFormat)
	for id, related := range s.state.DataRequests {
		if related.AccountDigest != record.AccountDigest {
			continue
		}
		related.Status, related.Account, related.CompletedAt = "completed", "", now
		related.MatchedTransfers, related.OutstandingTransfers = matched, 0
		related.EligibleAt = eligibleAt.Format(timeFormat)
		s.state.DataRequests[id] = related
	}
	record = s.state.DataRequests[requestID]
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: requestID}
	appendAudit(&s.state, now, "data_identity_redacted", requestID, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return DataRequest{}, false, err
	}
	return record, false, nil
}

func (s *Service) dataRetentionStateLocked(account string) (int, int, time.Time) {
	matched, outstanding := 0, 0
	eligibleAt := s.cfg.Now().UTC()
	for _, transfer := range s.state.Transfers {
		if transfer.Sender != account && transfer.Recipient != account {
			continue
		}
		matched++
		if transferExposureOpen(transfer) || transfer.Phase == "dispute" {
			outstanding++
			continue
		}
		updated, err := time.Parse(time.RFC3339Nano, transfer.UpdatedAt)
		if err != nil {
			outstanding++
			continue
		}
		candidate := updated.Add(s.cfg.RetentionPeriod)
		if candidate.After(eligibleAt) {
			eligibleAt = candidate
		}
	}
	return matched, outstanding, eligibleAt
}

func redactedAccount(digest string) string {
	return "redacted:sha256:" + strings.TrimPrefix(digest, "sha256:")[:32]
}

func (s *Service) Transparency() Transparency {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := Transparency{SchemaVersion: 1, Source: "ynx-bridge-coordinator", AsOf: s.cfg.Now().UTC().Format(timeFormat), Coverage: "coordinator-state-plus-operator-reconciliation-references", LiveBridge: false, ExternalSubmissionEnabled: false, Safety: s.state.Safety, Routes: []RouteExposure{}}
	keys := make([]string, 0, len(s.policies))
	for key := range s.policies {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		entry := RouteExposure{Route: s.policies[key], CoordinatorOutstanding: "0"}
		var amount uint64
		for _, transfer := range s.state.Transfers {
			if routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset) != key || !transferExposureOpen(transfer) {
				continue
			}
			value, _ := strconv.ParseUint(transfer.Amount, 10, 64)
			amount += value
			entry.TransferCount++
		}
		entry.CoordinatorOutstanding = strconv.FormatUint(amount, 10)
		if reconciliation, ok := s.state.Reconciliations[key]; ok {
			copy := reconciliation
			entry.LastReconciliation = &copy
		}
		result.Routes = append(result.Routes, entry)
	}
	return result
}

func (s *Service) RouteCatalog() RouteCatalog {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := RouteCatalog{SchemaVersion: 1, Source: "ynx-bridge-route-registry", AsOf: s.cfg.Now().UTC().Format(timeFormat), Coverage: "configured-fail-closed-candidates-not-live-provider-quotes", Routes: []RouteCatalogEntry{}}
	keys := make([]string, 0, len(s.policies))
	for key := range s.policies {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		policy := s.policies[key]
		result.Routes = append(result.Routes, s.providerCatalogEntry(key, policy))
	}
	return result
}

func unavailableRouteCatalogEntry(key string, policy RoutePolicy) RouteCatalogEntry {
	return RouteCatalogEntry{
		ID:       routeCatalogID(key, policy),
		Provider: policy.Provider, Classification: policy.Classification,
		Availability: "unavailable", FailureStatus: "provider-or-contract-route-unavailable", ProviderHealth: "not-connected",
		Source:      RouteAssetEndpoint{Chain: policy.SourceChain, Asset: policy.SourceAsset, AssetClass: policy.SourceAssetClass},
		Destination: RouteAssetEndpoint{Chain: policy.DestinationChain, Asset: policy.DestinationAsset, AssetClass: policy.DestinationAssetClass},
		Fees:        RouteFeeDisclosure{Status: "unavailable-no-executable-route", HiddenSpread: false},
		Slippage:    RouteSlippageDisclosure{Status: "not-applicable-no-executable-route"},
		Timing:      RouteTimingDisclosure{Status: "unavailable-no-provider-route"},
		Finality:    RouteFinalityDisclosure{SourceConfirmations: policy.MinConfirmations, ProofVerification: "local-relayer-attestation-only-not-independent-chain-proof"},
		Refund:      RouteRefundDisclosure{Available: false, Mode: "evidence-recording-only-no-external-refund-execution"},
		Risk:        []string{"provider support is not verified", "source and destination contracts are not configured or verified", "destination finality is not independently verified", "route has no funded testnet evidence", "external submission is disabled"},
		Limits:      policy, Executable: false, ExternalSubmissionEnabled: false,
		UserSigning: "canonical-wallet-required", CredentialBoundary: "browser-and-consumers-have-no-bridge-or-provider-secret",
	}
}

func routeCatalogID(key string, policy RoutePolicy) string {
	return "route_" + hashText(key + "|" + policy.Provider + "|" + policy.Classification)[:24]
}

func configuredProviderCount(policies map[string]RoutePolicy) int {
	providers := map[string]struct{}{}
	for _, policy := range policies {
		providers[policy.Provider] = struct{}{}
	}
	return len(providers)
}

func (s *Service) ProviderRegistry() ProviderRegistry {
	s.mu.Lock()
	defer s.mu.Unlock()
	coverage := "configured-provider-identities-and-routes-only-no-live-provider-session-commercial-rights-or-independent-incident-history"
	if len(s.providerRoutes) > 0 {
		coverage = "configured-provider-routes-and-cached-live-api-health-no-executable-route-or-independent-incident-history"
	}
	result := ProviderRegistry{
		SchemaVersion: 1,
		Source:        "ynx-bridge-provider-registry",
		AsOf:          s.cfg.Now().UTC().Format(timeFormat),
		Coverage:      coverage,
		Providers:     []ProviderRegistryEntry{},
	}
	keys := make([]string, 0, len(s.policies))
	for key := range s.policies {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		policy := s.policies[key]
		routeID := routeCatalogID(key, policy)
		assets := []string{policy.SourceChain + ":" + policy.SourceAsset, policy.DestinationChain + ":" + policy.DestinationAsset}
		sort.Strings(assets)
		entry := ProviderRegistryEntry{
			ID:                      "provider_route_" + hashText(policy.Provider + "|" + routeID)[:24],
			Provider:                policy.Provider,
			Product:                 "not-configured",
			Classification:          policy.Classification,
			RouteID:                 routeID,
			SourceChain:             policy.SourceChain,
			DestinationChain:        policy.DestinationChain,
			SupportedAssets:         assets,
			APIVersion:              "not-configured",
			SDKVersion:              "not-configured",
			Authentication:          "not-applicable-route-unavailable",
			RateLimit:               "unknown-route-unavailable",
			Fees:                    RouteFeeDisclosure{Status: "unavailable-no-executable-route", HiddenSpread: false},
			Slippage:                RouteSlippageDisclosure{Status: "not-applicable-no-executable-route"},
			EstimatedTime:           RouteTimingDisclosure{Status: "unavailable-no-provider-route"},
			Finality:                RouteFinalityDisclosure{SourceConfirmations: policy.MinConfirmations, ProofVerification: "local-relayer-attestation-only-not-independent-chain-proof"},
			RefundPolicy:            RouteRefundDisclosure{Available: false, Mode: "evidence-recording-only-no-external-refund-execution"},
			RecoveryProcess:         "record-failure-preserve-evidence-and-require-approved-operator-recovery",
			Limits:                  policy,
			Jurisdiction:            "not-approved",
			License:                 "not-approved",
			Terms:                   "not-approved",
			DataRetention:           "not-reviewed",
			DataRights:              "not-reviewed",
			CustodyModel:            "not-established",
			SecurityModel:           "configured-local-relayer-threshold-not-provider-security-review",
			AuditStatus:             "not-reviewed",
			IncidentHistory:         []ProviderIncident{},
			IncidentHistoryComplete: false,
			Health:                  "not-connected",
			Fallback:                "none",
			DecommissionPlan:        "disable-route-preserve-transfer-and-audit-evidence-and-publish-unavailable-status",
			TestnetStatus:           "unavailable",
			ProductionStatus:        "unavailable",
			FailureStatus:           "provider-support-contracts-credentials-agreement-and-funding-unavailable",
		}
		entry.IncidentHistory = s.providerIncidentHistoryLocked(routeID)
		if config, configured := s.providerRoutes[key]; configured {
			minSeconds, maxSeconds := config.EstimatedMinSeconds, config.EstimatedMaxSeconds
			destinationRule := "circle-cctp-v2-attestation-plus-destination-receive-message"
			entry.Product = "Circle CCTP V2"
			entry.APIVersion = "v2"
			entry.SDKVersion = "direct-official-http-api"
			entry.Authentication = "permissionless-public-api-no-key"
			entry.RateLimit = "35-requests-per-second-then-five-minute-block"
			entry.SourceContract = stringPointer(config.SourceContract)
			entry.DestinationContract = stringPointer(config.DestinationContract)
			entry.Slippage = RouteSlippageDisclosure{Status: "not-applicable-native-usdc-burn-mint"}
			entry.EstimatedTime = RouteTimingDisclosure{Status: "configured-reviewed-estimate", EstimatedMinSeconds: &minSeconds, EstimatedMaxSeconds: &maxSeconds}
			entry.Finality = RouteFinalityDisclosure{SourceConfirmations: policy.MinConfirmations, DestinationRule: &destinationRule, ProofVerification: "circle-attestation-provider-not-independent-ynx-light-client"}
			entry.RefundPolicy = RouteRefundDisclosure{Available: false, Mode: "provider-protocol-no-automatic-refund-after-source-burn"}
			entry.RecoveryProcess = "fail-closed-preserve-provider-and-chain-evidence-require-approved-operator-recovery"
			if config.Jurisdiction != "" {
				entry.Jurisdiction = config.Jurisdiction
			}
			if config.License != "" {
				entry.License = config.License
			}
			if config.TermsURL != "" {
				entry.Terms = config.TermsURL
			}
			if config.DataRetention != "" {
				entry.DataRetention = config.DataRetention
			}
			if config.DataRights != "" {
				entry.DataRights = config.DataRights
			}
			entry.CustodyModel = "non-custodial-native-usdc-burn-mint-candidate"
			entry.SecurityModel = "Circle-attestation-plus-onchain-CCTP-contracts-not-YNX-light-client"
			if config.OperationalReviewApproved {
				entry.AuditStatus = "operator-operational-review-approved"
			}
			entry.CredentialsRequired = false
			entry.CredentialsConfigured = true
			entry.RouteSupportEvidence = stringPointer(config.RouteSupportEvidenceURL)
			entry.AgreementEvidence = stringPointer(config.AgreementEvidenceURL)
			entry.OperationalReviewEvidence = stringPointer(config.OperationalReviewURL)
			entry.OutageMode = config.OutageMode
			entry.RouteSupportVerified = config.RouteSupportVerified
			entry.OperationalReviewApproved = config.OperationalReviewApproved
			entry.AgreementApproved = config.AgreementApproved
			entry.ContractsConfigured = config.ContractsVerified
			if config.Fallback != "" {
				entry.Fallback = config.Fallback
			}
			entry.RouteAvailable = false
			entry.Executable = false
			entry.TestnetStatus = "provider-api-configured-route-execution-disabled"
			entry.FailureStatus = "provider-not-probed"
			state := s.providerState(key)
			if state.Health != "" {
				entry.Health = state.Health
				entry.FailureStatus = state.Failure
			}
			if state.LastSuccess != "" {
				entry.LastSuccess = stringPointer(state.LastSuccess)
			}
			if state.Health == "connected-live-fee-api" {
				if config.AgreementApproved && config.OperationalReviewApproved {
					entry.TestnetStatus = "official-fee-api-connected-route-execution-disabled"
					entry.FailureStatus = "source-intent-builder-and-testnet-execution-unavailable"
				} else {
					entry.TestnetStatus = "official-fee-api-connected-route-approval-incomplete"
					entry.FailureStatus = "provider-route-approval-incomplete"
				}
			}
			if state.LastFailure != "" {
				entry.LastFailure = stringPointer(state.LastFailure)
			}
			switch state.Health {
			case "stale":
				entry.TestnetStatus = "provider-api-stale-route-unavailable"
			case "unavailable":
				entry.TestnetStatus = "provider-api-unavailable-route-unavailable"
			}
		}
		result.Providers = append(result.Providers, entry)
	}
	return result
}

func (s *Service) AssetCatalog() AssetCatalog {
	s.mu.Lock()
	defer s.mu.Unlock()
	coverage := "configured-token-allowlist-candidates-not-verified-contracts"
	if len(s.providerRoutes) > 0 {
		coverage = "configured-token-allowlist-plus-provider-contract-metadata-not-executable-or-independent-reserve-proof"
	}
	result := AssetCatalog{SchemaVersion: 1, Source: "ynx-bridge-asset-registry", AsOf: s.cfg.Now().UTC().Format(timeFormat), Coverage: coverage, Assets: []AssetCatalogEntry{}}
	entries := map[string]AssetCatalogEntry{}
	for key, policy := range s.policies {
		routeID := routeCatalogID(key, policy)
		addAssetCatalogEntry(entries, policy.SourceChain, policy.SourceAsset, policy.SourceAssetClass, sourceCanonicality(policy.AssetBoundary), sourceMovementMode(policy.AssetBoundary), routeID)
		addAssetCatalogEntry(entries, policy.DestinationChain, policy.DestinationAsset, policy.DestinationAssetClass, destinationCanonicality(policy.AssetBoundary), destinationMovementMode(policy.AssetBoundary), routeID)
		if config, configured := s.providerRoutes[key]; configured {
			applyProviderAssetMetadata(entries, config.SourceChain, config.SourceAsset, config.SourceSymbol, config.SourceDecimals, config.SourceTokenContract, config.SourceExplorerURL, config.ContractsVerified)
			applyProviderAssetMetadata(entries, config.DestinationChain, config.DestinationAsset, config.DestinationSymbol, config.DestinationDecimals, config.DestinationTokenContract, config.DestinationExplorerURL, config.ContractsVerified)
		}
	}
	keys := make([]string, 0, len(entries))
	for key := range entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		entry := entries[key]
		sort.Strings(entry.RouteIDs)
		sort.Strings(entry.MovementModes)
		result.Assets = append(result.Assets, entry)
	}
	return result
}

func applyProviderAssetMetadata(entries map[string]AssetCatalogEntry, chain, asset, symbol string, decimals *uint8, contract, explorer string, verified bool) {
	key := chain + "|" + asset
	entry, exists := entries[key]
	if !exists {
		return
	}
	entry.Symbol = stringPointer(symbol)
	entry.Decimals = decimals
	entry.Contract = stringPointer(contract)
	entry.ContractVerified = verified
	entry.ExplorerURL = stringPointer(explorer)
	entry.Risk = []string{"provider contract metadata does not prove source submission or destination availability", "mint and burn execution remain disabled", "reserve evidence is operator-submitted and not independently verified"}
	entries[key] = entry
}

func addAssetCatalogEntry(entries map[string]AssetCatalogEntry, chain, asset, assetClass, canonicality, movementMode, routeID string) {
	key := chain + "|" + asset
	entry, exists := entries[key]
	if !exists {
		entry = AssetCatalogEntry{
			ID: "asset_" + hashText(key + "|" + assetClass)[:24], Chain: chain, Asset: asset, AssetClass: assetClass, Canonicality: canonicality,
			AllowlistedForCoordinatorIntent: true, Availability: "unavailable", MovementModes: []string{},
			SupplyAuthority: "not-configured", ReserveEvidence: "operator-reconciliation-reference-only-not-independent-proof",
			ExternalExecutionEnabled: false, RouteIDs: []string{},
			Risk: []string{"contract address and metadata are not configured", "contract verification is absent", "mint burn lock and release execution are disabled", "reserve evidence is operator-submitted and not independently verified"},
		}
	}
	if !containsString(entry.MovementModes, movementMode) {
		entry.MovementModes = append(entry.MovementModes, movementMode)
	}
	entry.RouteIDs = append(entry.RouteIDs, routeID)
	entries[key] = entry
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func sourceCanonicality(boundary string) string {
	if boundary == "canonical-to-represented" || boundary == "canonical-to-canonical" {
		return "canonical"
	}
	return "represented"
}

func destinationCanonicality(boundary string) string {
	if boundary == "canonical-to-represented" {
		return "represented"
	}
	return "canonical"
}

func sourceMovementMode(boundary string) string {
	if boundary == "canonical-to-represented" {
		return "lock-observation-only-not-executed"
	}
	return "burn-observation-only-not-executed"
}

func destinationMovementMode(boundary string) string {
	if boundary == "canonical-to-represented" || boundary == "canonical-to-canonical" {
		return "mint-observation-only-not-executed"
	}
	return "release-observation-only-not-executed"
}

func (s *Service) ProductStatus(build buildinfo.Info) ProductStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	assetKeys := map[string]struct{}{}
	for _, policy := range s.policies {
		assetKeys[policy.SourceChain+"|"+policy.SourceAsset] = struct{}{}
		assetKeys[policy.DestinationChain+"|"+policy.DestinationAsset] = struct{}{}
	}
	openExposure := 0
	for _, transfer := range s.state.Transfers {
		if transferExposureOpen(transfer) {
			openExposure++
		}
	}
	reconciliation := StatusReconciliation{State: "no-operator-observation", RecordCount: len(s.state.Reconciliations), IndependentVerification: false, Coverage: "operator-submitted-references-not-independent-chain-proof"}
	latest := ""
	imbalanced := false
	for _, record := range s.state.Reconciliations {
		if record.RecordedAt > latest {
			latest = record.RecordedAt
		}
		if !record.Balanced {
			imbalanced = true
		}
	}
	if latest != "" {
		reconciliation.LatestRecordedAt = &latest
		reconciliation.State = "operator-observed-balanced"
		if imbalanced {
			reconciliation.State = "operator-observed-imbalance"
		}
	}
	coordinatorState := "available-local-coordinator"
	if s.state.Safety.Paused {
		coordinatorState = "paused-local-coordinator"
	}
	availableProviders, providerConnection := s.providerConnectionSnapshot()
	externalBridgeState := "unavailable"
	failureStatus := "no-verified-provider-contract-or-public-deployment"
	coverage := "local-coordinator-and-configured-candidates-not-public-provider-health"
	if availableProviders > 0 {
		externalBridgeState = "provider-api-connected-route-execution-unavailable"
		failureStatus = "source-intent-builder-testnet-execution-and-public-deployment-unavailable"
		coverage = "local-coordinator-plus-live-provider-api-observation-not-executable-route-or-public-deployment"
	} else {
		switch providerConnection {
		case "configured-provider-api-stale":
			failureStatus = "provider-connectivity-observation-stale"
			coverage = "local-coordinator-plus-stale-provider-api-observation-route-unavailable"
		case "configured-provider-api-unavailable":
			failureStatus = "provider-connectivity-probe-unavailable"
			coverage = "local-coordinator-plus-failed-provider-api-observation-route-unavailable"
		}
	}
	return ProductStatus{
		SchemaVersion: 1, Source: "ynx-bridge-status", AsOf: s.cfg.Now().UTC().Format(timeFormat), Coverage: coverage,
		CoordinatorState: coordinatorState, ExternalBridgeState: externalBridgeState, FailureStatus: failureStatus,
		Paused: s.state.Safety.Paused, RouteCount: len(s.policies), ProviderCount: configuredProviderCount(s.policies), AvailableProviderCount: availableProviders, AssetCount: len(assetKeys), TransferCount: len(s.state.Transfers), OpenExposureTransferCount: openExposure,
		ProviderConnection: providerConnection, ExternalSubmissionEnabled: false, UserAssetMovementEnabled: false, OfficialStablecoinRouteAvailable: false, DeployedPublic: false,
		Reconciliation: reconciliation,
		Capabilities:   StatusCapabilities{ReadOnlyEvidence: true, QuoteGeneration: true, QuoteExecution: false, WalletReviewGeneration: true, SourceSubmission: false, DestinationMintRelease: false, RefundExecution: false, DisputeRecording: true, EmergencyExitExecution: false},
		Support:        StatusSupport{Configured: false}, Build: buildinfo.Normalize(build),
	}
}

func (s *Service) Get(transferID string) (Transfer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	transfer, ok := s.state.Transfers[strings.TrimSpace(transferID)]
	if !ok {
		return Transfer{}, ErrNotFound
	}
	return cloneTransfer(transfer), nil
}

func (s *Service) List(after string, limit int) []Transfer {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > MaxListLimit {
		limit = 50
	}
	items := make([]Transfer, 0, len(s.state.Transfers))
	for _, transfer := range s.state.Transfers {
		if after == "" || transfer.ID > after {
			items = append(items, cloneTransfer(transfer))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	if len(items) > limit {
		items = items[:limit]
	}
	return items
}

func (s *Service) Audit(after uint64, limit int) []AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > MaxListLimit {
		limit = 50
	}
	items := make([]AuditEvent, 0, limit)
	for _, event := range s.state.Audit {
		if event.Sequence > after {
			items = append(items, event)
			if len(items) == limit {
				break
			}
		}
	}
	return items
}

func (s *Service) Health(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	reconciliationStatus := "not-run"
	lastReconciliation := ""
	for _, record := range s.state.Reconciliations {
		if record.RecordedAt > lastReconciliation {
			lastReconciliation = record.RecordedAt
			if record.Balanced {
				reconciliationStatus = "operator-observed-balanced-not-independent"
			} else {
				reconciliationStatus = "operator-observed-imbalance-not-independent"
			}
		}
	}
	normalizedBuild := buildinfo.Normalize(build)
	truthfulStatus := "degraded-local-coordinator-only-no-provider-or-contract"
	if normalizedBuild.Commit == "unknown" {
		truthfulStatus = "local-coordinator-only-no-external-submission"
	}
	availableProviders, providerConnection := s.providerConnectionSnapshot()
	providerStatus := "unavailable-no-verified-provider-connection"
	providerDependency := "unavailable"
	if availableProviders > 0 {
		providerStatus = "connected-live-provider-api-route-execution-disabled"
		providerDependency = providerConnection
		truthfulStatus = "degraded-live-provider-api-no-executable-route-or-contract"
	} else if providerConnection == "configured-provider-api-stale" || providerConnection == "configured-provider-api-unavailable" {
		providerStatus = providerConnection
		providerDependency = providerConnection
		truthfulStatus = "degraded-provider-api-unavailable-no-executable-route-or-contract"
	}
	health := Health{
		OK: true, Degraded: true, Service: "ynx-bridged", SchemaVersion: SchemaVersion, StateMachineVersion: StateMachineVersion, StartedAt: s.startedAt,
		NativeSymbol: "YNXT", Persistence: "atomic-json-file", StateIntegrity: s.state.Integrity,
		ProviderStatus: providerStatus, ContractStatus: "unavailable-no-verified-contract-deployment", ReconciliationStatus: reconciliationStatus,
		Dependencies: map[string]string{
			"state": "integrity-sealed", "provider": providerDependency, "contracts": "unavailable", "relayerQuorum": "configured-local", "reconciliation": reconciliationStatus,
		},
		RouteCount: len(s.policies), ProviderCount: configuredProviderCount(s.policies), AvailableProviderCount: availableProviders, RelayerCount: len(s.cfg.Relayers), RequiredAttestations: s.cfg.Threshold, TransferCount: len(s.state.Transfers), AuditEventCount: len(s.state.Audit),
		ExternalSubmissionEnabled: false, LiveBridge: false, TruthfulStatus: truthfulStatus, Safety: s.state.Safety, Build: normalizedBuild,
	}
	lastSuccessfulAt := ""
	lastSuccessfulID := ""
	for _, transfer := range s.state.Transfers {
		switch transfer.Status {
		case "ready_for_local_finalization":
			health.ReadyCount++
		case "finalized_local":
			health.FinalizedLocalCount++
		}
		if transfer.DestinationAssetAvailable && transfer.DestinationAvailableAt > lastSuccessfulAt {
			lastSuccessfulAt, lastSuccessfulID = transfer.DestinationAvailableAt, transfer.ID
		}
	}
	if lastSuccessfulID != "" {
		health.LastSuccessfulTransfer = &lastSuccessfulID
	}
	if lastReconciliation != "" {
		health.LastReconciliation = &lastReconciliation
	}
	if s.state.Safety.Paused {
		health.TruthfulStatus = "paused-local-coordinator-no-provider-or-contract"
	}
	health.RateLimit, health.RateLimitDenied = s.RateLimitSnapshot()
	health.RetentionPolicy = s.RetentionPolicy()
	return health
}

func (s *Service) normalizeCreate(request CreateTransferRequest) (CreateTransferRequest, RoutePolicy, uint64, string, string, error) {
	request.IdempotencyKey = strings.TrimSpace(request.IdempotencyKey)
	request.SourceChain = normalizeName(request.SourceChain)
	request.DestinationChain = normalizeName(request.DestinationChain)
	request.SourceAsset = normalizeAsset(request.SourceAsset)
	request.DestinationAsset = normalizeAsset(request.DestinationAsset)
	request.SourceTxHash = strings.ToLower(strings.TrimSpace(request.SourceTxHash))
	request.Amount = strings.TrimSpace(request.Amount)
	request.Sender = normalizeAccount(request.Sender)
	request.Recipient = normalizeAccount(request.Recipient)
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.SourceTxHash) || !identifierPattern.MatchString(request.Sender) || !identifierPattern.MatchString(request.Recipient) {
		return CreateTransferRequest{}, RoutePolicy{}, 0, "", "", fmt.Errorf("%w: transfer identity is invalid", ErrInvalid)
	}
	amount, err := strconv.ParseUint(request.Amount, 10, 64)
	if err != nil || amount == 0 {
		return CreateTransferRequest{}, RoutePolicy{}, 0, "", "", fmt.Errorf("%w: amount must be a positive uint64 decimal string", ErrInvalid)
	}
	request.Amount = strconv.FormatUint(amount, 10)
	key := routeKey(request.SourceChain, request.DestinationChain, request.SourceAsset, request.DestinationAsset)
	policy, ok := s.policies[key]
	if !ok {
		return CreateTransferRequest{}, RoutePolicy{}, 0, "", "", fmt.Errorf("%w: bridge route is not allowed", ErrInvalid)
	}
	digest := digestJSON(request)
	eventKey := fmt.Sprintf("%s|%s|%d", request.SourceChain, request.SourceTxHash, request.SourceEventIndex)
	return request, policy, s.maxAmounts[key], digest, eventKey, nil
}

func AttestationPayload(transfer Transfer, relayer, sourceBlockHash string, confirmations uint64) []byte {
	fields := []string{"ynx-bridge-attestation-v1", transfer.ID, transfer.IntentDigest, normalizeName(relayer), strings.ToLower(strings.TrimSpace(sourceBlockHash)), strconv.FormatUint(confirmations, 10)}
	return []byte(strings.Join(fields, "\n"))
}

func digestJSON(value any) string {
	raw, _ := json.Marshal(value)
	return "sha256:" + hashBytes(raw)
}
func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func cloneTransfer(value Transfer) Transfer {
	raw, _ := json.Marshal(value)
	var clone Transfer
	_ = json.Unmarshal(raw, &clone)
	return clone
}

func appendLifecycle(transfer *Transfer, phase, at, evidenceRef, reasonCode, source string) {
	transfer.Lifecycle = append(transfer.Lifecycle, LifecycleEvent{
		Sequence: uint64(len(transfer.Lifecycle) + 1), Phase: phase, At: at,
		EvidenceRef: evidenceRef, ReasonCode: reasonCode, Source: source,
		Coverage: "coordinator-recorded-event-not-independent-chain-proof",
	})
}

func validLifecycleTimestamp(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

func transferExposureOpen(transfer Transfer) bool {
	return transfer.ExposureStatus == "open"
}

func (s *Service) validateStateLocked() (bool, error) {
	for eventKey, transferID := range s.state.SourceEvents {
		if _, ok := s.state.Transfers[transferID]; !ok || strings.TrimSpace(eventKey) == "" {
			return false, errors.New("bridge source-event index is inconsistent")
		}
	}
	exposure := map[string]uint64{}
	userExposure := map[string]uint64{}
	dailyVolume := map[string]uint64{}
	for _, transfer := range s.state.Transfers {
		if transfer.ExternalSubmissionEnabled || transfer.RequiredAttestations != s.cfg.Threshold {
			return false, errors.New("bridge persisted transfer violates current safety policy")
		}
		if !accountDigestPattern.MatchString(transfer.IntentDigest) || transfer.ID != "brg_"+strings.TrimPrefix(transfer.IntentDigest, "sha256:")[:24] {
			return false, errors.New("bridge persisted transfer identity is inconsistent")
		}
		eventKey := fmt.Sprintf("%s|%s|%d", transfer.SourceChain, transfer.SourceTxHash, transfer.SourceEventIndex)
		if indexedID, ok := s.state.SourceEvents[eventKey]; !ok || indexedID != transfer.ID {
			return false, errors.New("bridge transfer is missing its source-event index")
		}
		key := routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset)
		policy, ok := s.policies[key]
		if !ok {
			return false, errors.New("bridge persisted transfer uses an unsupported route")
		}
		expectedMessageID := "msg_" + hashText("ynx-bridge-message-v1|" + eventKey + "|" + transfer.IntentDigest)[:32]
		if transfer.RouteID != routeCatalogID(key, policy) || transfer.MessageID != expectedMessageID || transfer.NonceDomain != "nonce_"+hashText(key)[:24] {
			return false, errors.New("bridge persisted transfer route or replay domain is inconsistent")
		}
		if transfer.StateMachineVersion != StateMachineVersion && transfer.StateMachineVersion != "ynx.bridge.lifecycle.legacy.v0" {
			return false, errors.New("bridge persisted transfer state machine version is unsupported")
		}
		if !canonicalPhases[transfer.Phase] || len(transfer.Lifecycle) == 0 {
			return false, errors.New("bridge persisted transfer has an invalid lifecycle phase")
		}
		sawProofAvailable := false
		sawProofVerified := false
		sawDestinationAvailable := false
		sawRefunded := false
		sawLegacyDestinationConfirmed := false
		for i, event := range transfer.Lifecycle {
			invalidEvidence := event.EvidenceRef != "" && !identifierPattern.MatchString(event.EvidenceRef)
			invalidReason := event.ReasonCode != "" && !identifierPattern.MatchString(event.ReasonCode)
			if event.Sequence != uint64(i+1) || !canonicalPhases[event.Phase] || !validLifecycleTimestamp(event.At) || invalidEvidence || invalidReason || !identifierPattern.MatchString(event.Source) || !identifierPattern.MatchString(event.Coverage) {
				return false, errors.New("bridge persisted transfer lifecycle is invalid")
			}
			switch event.Phase {
			case phaseProofAttestationAvailable:
				sawProofAvailable = true
			case phaseProofVerified:
				sawProofVerified = true
			case phaseDestinationActionConfirmed:
				sawLegacyDestinationConfirmed = true
			case phaseDestinationAvailable:
				sawDestinationAvailable = true
			case phaseRefunded:
				sawRefunded = true
			}
		}
		if sawDestinationAvailable && sawRefunded {
			return false, errors.New("bridge persisted transfer has conflicting exposure resolution")
		}
		expectedExposure := "open"
		expectedAvailable := false
		if sawDestinationAvailable {
			expectedExposure, expectedAvailable = "destination-available", true
		} else if sawRefunded {
			expectedExposure = "refunded"
		} else if transfer.StateMachineVersion == "ynx.bridge.lifecycle.legacy.v0" && sawLegacyDestinationConfirmed {
			expectedExposure = "destination-confirmed-legacy"
		}
		if transfer.ExposureStatus != expectedExposure || transfer.DestinationAssetAvailable != expectedAvailable {
			return false, errors.New("bridge persisted transfer exposure or availability status is inconsistent")
		}
		if expectedAvailable {
			if !validLifecycleTimestamp(transfer.DestinationAvailableAt) {
				return false, errors.New("bridge persisted destination availability evidence is invalid")
			}
		} else if transfer.DestinationAvailableAt != "" {
			return false, errors.New("bridge persisted transfer exposes an unconfirmed destination availability time")
		}
		if transfer.DestinationConfirmedAt != "" && !validLifecycleTimestamp(transfer.DestinationConfirmedAt) {
			return false, errors.New("bridge persisted destination confirmation time is invalid")
		}
		if transfer.StateMachineVersion == StateMachineVersion {
			if sawProofAvailable {
				expectedProofDigest := proofDigestForTransfer(transfer)
				if transfer.ProofType != proofTypeThresholdRelayerAttestation || transfer.ProofDigest != expectedProofDigest {
					return false, errors.New("bridge persisted proof bundle is inconsistent")
				}
				if sawProofVerified {
					if transfer.ProofVerificationStatus != "verified-threshold-relayer-attestation" || !validLifecycleTimestamp(transfer.ProofVerifiedAt) {
						return false, errors.New("bridge persisted proof verification is inconsistent")
					}
				} else if transfer.ProofVerificationStatus != "available-unverified" || transfer.ProofVerifiedAt != "" {
					return false, errors.New("bridge persisted unverified proof status is inconsistent")
				}
			} else if transfer.ProofType != "" || transfer.ProofDigest != "" || transfer.ProofVerificationStatus != "" || transfer.ProofVerifiedAt != "" {
				return false, errors.New("bridge persisted transfer has proof fields before proof availability")
			}
		} else if transfer.DestinationAssetAvailable {
			return false, errors.New("bridge legacy transfer cannot claim destination asset availability")
		}
		if err := s.validatePersistedAttestations(transfer); err != nil {
			return false, err
		}
		amount, err := strconv.ParseUint(transfer.Amount, 10, 64)
		if err != nil || amount == 0 {
			return false, errors.New("bridge persisted transfer amount is invalid")
		}
		if transferExposureOpen(transfer) {
			if ^uint64(0)-exposure[key] < amount {
				return false, errors.New("bridge persisted route exposure overflows")
			}
			exposure[key] += amount
			if exposure[key] > s.maxOutstanding[key] {
				return false, errors.New("bridge persisted route exposure exceeds policy")
			}
			userKey := key + "|" + transfer.Sender
			if ^uint64(0)-userExposure[userKey] < amount {
				return false, errors.New("bridge persisted user exposure overflows")
			}
			userExposure[userKey] += amount
			userLimit, _ := strconv.ParseUint(s.policies[key].UserOutstandingLimit, 10, 64)
			if userExposure[userKey] > userLimit {
				return false, errors.New("bridge persisted user exposure exceeds policy")
			}
		}
		day := transfer.CreatedAt
		if len(day) >= 10 {
			day = day[:10]
		}
		dailyKey := key + "|" + day
		if ^uint64(0)-dailyVolume[dailyKey] < amount {
			return false, errors.New("bridge persisted daily volume overflows")
		}
		dailyVolume[dailyKey] += amount
		dailyLimit, _ := strconv.ParseUint(s.policies[key].DailyLimit, 10, 64)
		if dailyVolume[dailyKey] > dailyLimit {
			return false, errors.New("bridge persisted daily volume exceeds policy")
		}
		if transfer.LargeTransferDelayApplied {
			created, err1 := time.Parse(time.RFC3339Nano, transfer.CreatedAt)
			notBefore, err2 := time.Parse(time.RFC3339Nano, transfer.NotBefore)
			if err1 != nil || err2 != nil || !notBefore.After(created) {
				return false, errors.New("bridge persisted large-transfer delay is invalid")
			}
		} else if transfer.NotBefore != "" {
			return false, errors.New("bridge persisted transfer has unexpected delay")
		}
		if transfer.SenderRedacted != strings.HasPrefix(transfer.Sender, "redacted:sha256:") || transfer.RecipientRedacted != strings.HasPrefix(transfer.Recipient, "redacted:sha256:") {
			return false, errors.New("bridge persisted transfer identity-redaction state is invalid")
		}
	}
	for _, record := range s.state.FinalizeIdempotency {
		if _, ok := s.state.Transfers[record.TransferID]; !ok {
			return false, errors.New("bridge finalization idempotency references a missing transfer")
		}
	}
	for key, record := range s.state.Reconciliations {
		policy, ok := s.policies[key]
		if !ok || record.Route != policy || routeKey(record.Route.SourceChain, record.Route.DestinationChain, record.Route.SourceAsset, record.Route.DestinationAsset) != key {
			return false, errors.New("bridge reconciliation uses an unsupported route")
		}
		if err := validateReconciliationRecord(record); err != nil {
			return false, err
		}
	}
	for idempotencyKey, mutation := range s.state.MutationIdempotency {
		if _, isRoute := s.policies[mutation.TransferID]; !isRoute {
			continue
		}
		result, hasResult := s.state.ReconciliationResults[idempotencyKey]
		unavailable := s.state.ReconciliationReplayUnavailable[idempotencyKey]
		if hasResult == unavailable {
			return false, errors.New("bridge reconciliation replay evidence is inconsistent")
		}
		if !hasAuditEvidence(s.state.Audit, "reconciliation_recorded", mutation.TransferID, mutation.Digest) {
			return false, errors.New("bridge reconciliation replay audit evidence is missing")
		}
		if hasResult {
			key := routeKey(result.Route.SourceChain, result.Route.DestinationChain, result.Route.SourceAsset, result.Route.DestinationAsset)
			if key != mutation.TransferID || result.Route != s.policies[key] {
				return false, errors.New("bridge reconciliation replay references the wrong route")
			}
			if err := validateReconciliationRecord(result); err != nil {
				return false, err
			}
			replayedRequest := ReconciliationRequest{IdempotencyKey: idempotencyKey, SourceChain: result.Route.SourceChain, DestinationChain: result.Route.DestinationChain, SourceAsset: result.Route.SourceAsset, DestinationAsset: result.Route.DestinationAsset, Locked: result.Locked, Burned: result.Burned, Minted: result.Minted, Released: result.Released, EvidenceRef: result.EvidenceRef, ObservedAt: result.ObservedAt}
			if mutation.Digest != digestJSON(replayedRequest) {
				return false, errors.New("bridge reconciliation replay digest is inconsistent")
			}
		}
	}
	for idempotencyKey, result := range s.state.ReconciliationResults {
		mutation, ok := s.state.MutationIdempotency[idempotencyKey]
		if !ok || routeKey(result.Route.SourceChain, result.Route.DestinationChain, result.Route.SourceAsset, result.Route.DestinationAsset) != mutation.TransferID {
			return false, errors.New("bridge reconciliation replay result is orphaned")
		}
	}
	for idempotencyKey, unavailable := range s.state.ReconciliationReplayUnavailable {
		mutation, ok := s.state.MutationIdempotency[idempotencyKey]
		if !unavailable || !ok {
			return false, errors.New("bridge legacy reconciliation replay marker is invalid")
		}
		if _, isRoute := s.policies[mutation.TransferID]; !isRoute {
			return false, errors.New("bridge legacy reconciliation replay marker is orphaned")
		}
	}
	for id, request := range s.state.DataRequests {
		if id != request.ID || !identifierPattern.MatchString(id) || !accountDigestPattern.MatchString(request.AccountDigest) || request.Source != "operator-submitted-data-rights-request" || request.RetentionPolicy == "" {
			return false, errors.New("bridge data request identity is invalid")
		}
		if _, err := time.Parse(time.RFC3339Nano, request.RequestedAt); err != nil {
			return false, errors.New("bridge data request time is invalid")
		}
		switch request.Status {
		case "safety_hold":
			if request.Account == "" || request.OutstandingTransfers == 0 || request.EligibleAt != "" || request.CompletedAt != "" {
				return false, errors.New("bridge safety-held data request is invalid")
			}
		case "pending_retention":
			if request.Account == "" || request.OutstandingTransfers != 0 || request.EligibleAt == "" || request.CompletedAt != "" {
				return false, errors.New("bridge pending data request is invalid")
			}
		case "completed":
			if request.Account != "" || request.OutstandingTransfers != 0 || request.EligibleAt == "" || request.CompletedAt == "" {
				return false, errors.New("bridge completed data request is invalid")
			}
		default:
			return false, errors.New("bridge data request status is invalid")
		}
		if request.EligibleAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, request.EligibleAt); err != nil {
				return false, errors.New("bridge data request eligibility time is invalid")
			}
		}
		if request.CompletedAt != "" {
			if _, err := time.Parse(time.RFC3339Nano, request.CompletedAt); err != nil {
				return false, errors.New("bridge data request completion time is invalid")
			}
		}
	}
	return true, nil
}

func validateReconciliationRecord(record Reconciliation) error {
	values := make([]uint64, 7)
	for i, raw := range []string{record.Locked, record.Burned, record.Minted, record.Released, record.OutstandingSupply, record.ReserveBacking, record.Difference} {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return errors.New("bridge reconciliation amount is invalid")
		}
		values[i] = value
	}
	if values[1] > values[2] || values[3] > values[0] || values[4] != values[2]-values[1] || values[5] != values[0]-values[3] {
		return errors.New("bridge reconciliation accounting is inconsistent")
	}
	difference := values[4]
	if values[5] >= values[4] {
		difference = values[5] - values[4]
	} else {
		difference = values[4] - values[5]
	}
	if values[6] != difference || record.Balanced != (difference == 0) || record.Source != "operator-submitted-evidence" || record.Verification != "reference-recorded-not-independently-verified" {
		return errors.New("bridge reconciliation truth boundary is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, record.ObservedAt); err != nil {
		return errors.New("bridge reconciliation observed time is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, record.RecordedAt); err != nil {
		return errors.New("bridge reconciliation recorded time is invalid")
	}
	return nil
}

func (s *Service) validatePersistedAttestations(transfer Transfer) error {
	if transfer.Attestations == nil {
		return errors.New("bridge persisted transfer attestations are missing")
	}
	if len(transfer.Attestations) == 0 && transfer.SourceBlockHash != "" || len(transfer.Attestations) > 0 && transfer.SourceBlockHash == "" {
		return errors.New("bridge persisted source block binding is inconsistent")
	}
	for name, attestation := range transfer.Attestations {
		publicKey, allowed := s.cfg.Relayers[name]
		if !allowed || attestation.Relayer != name || normalizeName(name) != name || attestation.SourceBlockHash != transfer.SourceBlockHash || attestation.Confirmations < transfer.RequiredConfirmations || !validLifecycleTimestamp(attestation.AttestedAt) {
			return errors.New("bridge persisted attestation identity or finality is invalid")
		}
		payload := AttestationPayload(transfer, name, attestation.SourceBlockHash, attestation.Confirmations)
		if attestation.PayloadHash != "sha256:"+hashBytes(payload) {
			return errors.New("bridge persisted attestation payload is invalid")
		}
		signature, err := base64.StdEncoding.Strict().DecodeString(attestation.Signature)
		if err != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(publicKey, payload, signature) {
			return errors.New("bridge persisted attestation signature is invalid")
		}
		if !hasAuditEvidence(s.state.Audit, "attestation_accepted", transfer.ID, attestation.PayloadHash) {
			return errors.New("bridge persisted attestation audit evidence is missing")
		}
	}
	quorum := len(transfer.Attestations) >= transfer.RequiredAttestations
	switch transfer.Status {
	case "pending_attestations":
		if quorum || transfer.FinalizationID != "" || transfer.FinalizedAt != "" || s.hasFinalizationRecord(transfer.ID) {
			return errors.New("bridge persisted pending status is inconsistent")
		}
	case "ready_for_local_finalization":
		if !quorum || transfer.FinalizationID != "" || transfer.FinalizedAt != "" || s.hasFinalizationRecord(transfer.ID) {
			return errors.New("bridge persisted ready status is inconsistent")
		}
	case "finalized_local":
		if !quorum || !identifierPattern.MatchString(transfer.FinalizationID) || !validLifecycleTimestamp(transfer.FinalizedAt) {
			return errors.New("bridge persisted finalized status is inconsistent")
		}
		if err := s.validatePersistedFinalization(transfer); err != nil {
			return err
		}
	default:
		return errors.New("bridge persisted transfer status is invalid")
	}
	return nil
}

func (s *Service) hasFinalizationRecord(transferID string) bool {
	for _, record := range s.state.FinalizeIdempotency {
		if record.TransferID == transferID {
			return true
		}
	}
	return false
}

func (s *Service) validatePersistedFinalization(transfer Transfer) error {
	matches := 0
	for key, record := range s.state.FinalizeIdempotency {
		if record.TransferID != transfer.ID {
			continue
		}
		matches++
		if !idempotencyPattern.MatchString(key) || transfer.FinalizationID != "brf_"+hashText(transfer.ID + "|" + key)[:24] || !strings.HasPrefix(record.Digest, "sha256:") || !hasAuditEvidence(s.state.Audit, "transfer_finalized_local", transfer.ID, record.Digest) {
			return errors.New("bridge persisted finalization evidence is inconsistent")
		}
	}
	if matches != 1 {
		return errors.New("bridge persisted finalization evidence is inconsistent")
	}
	return nil
}

func hasAuditEvidence(events []AuditEvent, action, transferID, detailHash string) bool {
	for _, event := range events {
		if event.Action == action && event.TransferID == transferID && event.DetailHash == detailHash {
			return true
		}
	}
	return false
}

const timeFormat = "2006-01-02T15:04:05.000000000Z"
