package bridgegateway

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Service struct {
	mu         sync.Mutex
	cfg        Config
	maxAmounts map[string]uint64
	policies   map[string]RoutePolicy
	state      persistentState
}

type Health struct {
	OK                        bool           `json:"ok"`
	Service                   string         `json:"service"`
	NativeSymbol              string         `json:"nativeSymbol"`
	Persistence               string         `json:"persistence"`
	StateIntegrity            string         `json:"stateIntegrity"`
	RouteCount                int            `json:"routeCount"`
	RelayerCount              int            `json:"relayerCount"`
	RequiredAttestations      int            `json:"requiredAttestations"`
	TransferCount             int            `json:"transferCount"`
	ReadyCount                int            `json:"readyCount"`
	FinalizedLocalCount       int            `json:"finalizedLocalCount"`
	AuditEventCount           int            `json:"auditEventCount"`
	ExternalSubmissionEnabled bool           `json:"externalSubmissionEnabled"`
	LiveBridge                bool           `json:"liveBridge"`
	TruthfulStatus            string         `json:"truthfulStatus"`
	Build                     buildinfo.Info `json:"build"`
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
	policies := make(map[string]RoutePolicy, len(normalized.Policies))
	for _, policy := range normalized.Policies {
		policies[routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset)] = policy
	}
	service := &Service{cfg: normalized, maxAmounts: maxAmounts, policies: policies, state: state}
	if _, err := service.validateStateLocked(); err != nil {
		return nil, err
	}
	if !stateExists {
		if err := saveState(normalized.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	if value == "" || len(value) != len(s.cfg.APIKey) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(s.cfg.APIKey)) == 1
}

func (s *Service) CreateTransfer(request CreateTransferRequest) (MutationResult, error) {
	normalized, policy, maximum, digest, eventKey, err := s.normalizeCreate(request)
	if err != nil {
		return MutationResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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
	now := s.cfg.Now().UTC().Format(timeFormat)
	id := "brg_" + digest[len("sha256:"):len("sha256:")+24]
	transfer := Transfer{
		ID: id, Status: "pending_attestations", IntentDigest: digest,
		SourceChain: normalized.SourceChain, SourceTxHash: normalized.SourceTxHash, SourceEventIndex: normalized.SourceEventIndex, SourceAsset: normalized.SourceAsset,
		DestinationChain: normalized.DestinationChain, DestinationAsset: normalized.DestinationAsset, Amount: normalized.Amount,
		Sender: normalized.Sender, Recipient: normalized.Recipient, AssetBoundary: policy.AssetBoundary,
		RequiredConfirmations: policy.MinConfirmations, RequiredAttestations: s.cfg.Threshold, Attestations: map[string]Attestation{},
		CreatedAt: now, UpdatedAt: now, ExternalSubmissionEnabled: false,
	}
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
	transfer.Attestations[relayer] = Attestation{Relayer: relayer, SourceBlockHash: request.SourceBlockHash, Confirmations: request.Confirmations, PayloadHash: payloadHash, Signature: request.Signature, AttestedAt: now}
	if len(transfer.Attestations) >= transfer.RequiredAttestations {
		transfer.Status = "ready_for_local_finalization"
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
	before := cloneState(s.state)
	now := s.cfg.Now().UTC().Format(timeFormat)
	transfer.Status = "finalized_local"
	transfer.FinalizationID = "brf_" + hashText(transfer.ID + "|" + request.IdempotencyKey)[:24]
	transfer.FinalizedAt, transfer.UpdatedAt = now, now
	transfer.ExternalSubmissionEnabled = false
	s.state.Transfers[transferID] = transfer
	s.state.FinalizeIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: transferID}
	appendAudit(&s.state, now, "transfer_finalized_local", transferID, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return MutationResult{}, err
	}
	return MutationResult{Transfer: cloneTransfer(transfer)}, nil
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
	health := Health{OK: true, Service: "ynx-bridged", NativeSymbol: "YNXT", Persistence: "atomic-json-file", StateIntegrity: s.state.Integrity,
		RouteCount: len(s.policies), RelayerCount: len(s.cfg.Relayers), RequiredAttestations: s.cfg.Threshold, TransferCount: len(s.state.Transfers), AuditEventCount: len(s.state.Audit),
		ExternalSubmissionEnabled: false, LiveBridge: false, TruthfulStatus: "local-coordinator-only-no-external-submission", Build: buildinfo.Normalize(build)}
	for _, transfer := range s.state.Transfers {
		switch transfer.Status {
		case "ready_for_local_finalization":
			health.ReadyCount++
		case "finalized_local":
			health.FinalizedLocalCount++
		}
	}
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
	request.Sender = strings.TrimSpace(request.Sender)
	request.Recipient = strings.TrimSpace(request.Recipient)
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

func (s *Service) validateStateLocked() (bool, error) {
	for eventKey, transferID := range s.state.SourceEvents {
		if _, ok := s.state.Transfers[transferID]; !ok || strings.TrimSpace(eventKey) == "" {
			return false, errors.New("bridge source-event index is inconsistent")
		}
	}
	for _, transfer := range s.state.Transfers {
		if transfer.ExternalSubmissionEnabled || transfer.RequiredAttestations != s.cfg.Threshold {
			return false, errors.New("bridge persisted transfer violates current safety policy")
		}
		if _, ok := s.policies[routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset)]; !ok {
			return false, errors.New("bridge persisted transfer uses an unsupported route")
		}
	}
	return true, nil
}

const timeFormat = "2006-01-02T15:04:05.000000000Z"
