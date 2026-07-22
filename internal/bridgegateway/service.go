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
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type Service struct {
	mu              sync.Mutex
	cfg             Config
	maxAmounts      map[string]uint64
	maxOutstanding  map[string]uint64
	policies        map[string]RoutePolicy
	state           persistentState
	rateMu          sync.Mutex
	seen            map[string][]time.Time
	rateLimitDenied uint64
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
	Safety                    SafetyState    `json:"safety"`
	RateLimit                 string         `json:"rateLimit"`
	RateLimitDenied           uint64         `json:"rateLimitDenied"`
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
	service := &Service{cfg: normalized, maxAmounts: maxAmounts, maxOutstanding: maxOutstanding, policies: policies, state: state, seen: map[string][]time.Time{}}
	migrated := false
	for id, transfer := range service.state.Transfers {
		if transfer.Phase != "" {
			continue
		}
		switch transfer.Status {
		case "pending_attestations":
			transfer.Phase = "source_submitted"
		case "ready_for_local_finalization":
			transfer.Phase = "source_finalized"
		case "finalized_local":
			transfer.Phase = "proof_attestation"
		default:
			return nil, fmt.Errorf("bridge persisted transfer %s has unknown legacy status", id)
		}
		service.state.Transfers[id] = transfer
		migrated = true
	}
	if _, err := service.validateStateLocked(); err != nil {
		return nil, err
	}
	if needsSave || migrated {
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
		if existing.Phase == "destination_confirmed" || existing.Phase == "refund_recovery" {
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
	transfer := Transfer{
		ID: id, Status: "pending_attestations", Phase: "source_submitted", IntentDigest: digest,
		SourceChain: normalized.SourceChain, SourceTxHash: normalized.SourceTxHash, SourceEventIndex: normalized.SourceEventIndex, SourceAsset: normalized.SourceAsset,
		DestinationChain: normalized.DestinationChain, DestinationAsset: normalized.DestinationAsset, Amount: normalized.Amount,
		Sender: normalized.Sender, Recipient: normalized.Recipient, AssetBoundary: policy.AssetBoundary,
		RequiredConfirmations: policy.MinConfirmations, RequiredAttestations: s.cfg.Threshold, Attestations: map[string]Attestation{},
		CreatedAt: now, UpdatedAt: now, NotBefore: notBefore, LargeTransferDelayApplied: largeDelayApplied, ExternalSubmissionEnabled: false,
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
	transfer.Phase = "source_accepted"
	transfer.Attestations[relayer] = Attestation{Relayer: relayer, SourceBlockHash: request.SourceBlockHash, Confirmations: request.Confirmations, PayloadHash: payloadHash, Signature: request.Signature, AttestedAt: now}
	if len(transfer.Attestations) >= transfer.RequiredAttestations {
		transfer.Status = "ready_for_local_finalization"
		transfer.Phase = "source_finalized"
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
	transfer.Phase = "proof_attestation"
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
	request.Outcome = normalizeName(request.Outcome)
	request.EvidenceRef = strings.TrimSpace(request.EvidenceRef)
	request.ReasonCode = normalizeName(request.ReasonCode)
	allowed := map[string]bool{"destination_mint_release": true, "destination_confirmed": true, "failed": true, "refund_recovery": true, "dispute": true, "retry": true}
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !allowed[request.Outcome] || !identifierPattern.MatchString(request.EvidenceRef) || !identifierPattern.MatchString(request.ReasonCode) {
		return MutationResult{}, fmt.Errorf("%w: outcome evidence is invalid", ErrInvalid)
	}
	digest := digestJSON(struct {
		TransferID string         `json:"transferId"`
		Request    OutcomeRequest `json:"request"`
	}{transferID, request})
	s.mu.Lock()
	defer s.mu.Unlock()
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
	if request.Outcome == "retry" {
		if transfer.Phase != "failed" {
			return MutationResult{}, fmt.Errorf("%w: only failed transfers can retry", ErrConflict)
		}
		transfer.Phase, transfer.PreviousPhase, transfer.FailureReasonCode = transfer.PreviousPhase, "", ""
	} else {
		valid := (request.Outcome == "failed" && transfer.Phase != "destination_confirmed" && transfer.Phase != "refund_recovery") ||
			(request.Outcome == "destination_mint_release" && transfer.Phase == "proof_attestation") ||
			(request.Outcome == "destination_confirmed" && transfer.Phase == "destination_mint_release") ||
			(request.Outcome == "refund_recovery" && transfer.Phase == "failed") || request.Outcome == "dispute"
		if !valid {
			return MutationResult{}, fmt.Errorf("%w: invalid lifecycle transition", ErrConflict)
		}
		if request.Outcome == "failed" {
			transfer.PreviousPhase, transfer.FailureReasonCode = transfer.Phase, request.ReasonCode
		}
		transfer.Phase = request.Outcome
	}
	transfer.OutcomeEvidenceRef = request.EvidenceRef
	transfer.UpdatedAt = s.cfg.Now().UTC().Format(timeFormat)
	before := cloneState(s.state)
	s.state.Transfers[transferID] = transfer
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: transferID}
	appendAudit(&s.state, transfer.UpdatedAt, "lifecycle_"+request.Outcome, transferID, digest)
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
	if !idempotencyPattern.MatchString(request.IdempotencyKey) || !identifierPattern.MatchString(request.EvidenceRef) {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation identity is invalid", ErrInvalid)
	}
	observedAt, err := time.Parse(time.RFC3339Nano, request.ObservedAt)
	if err != nil || observedAt.After(s.cfg.Now().UTC()) {
		return Reconciliation{}, false, fmt.Errorf("%w: reconciliation observedAt is invalid", ErrInvalid)
	}
	values := make([]uint64, 4)
	for i, raw := range []string{request.Locked, request.Burned, request.Minted, request.Released} {
		values[i], err = strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
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
		return s.state.Reconciliations[key], true, nil
	}
	before := cloneState(s.state)
	s.state.Reconciliations[key] = record
	s.state.MutationIdempotency[request.IdempotencyKey] = idempotencyRecord{Digest: digest, TransferID: key}
	appendAudit(&s.state, record.RecordedAt, "reconciliation_recorded", key, digest)
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		s.state = before
		return Reconciliation{}, false, err
	}
	return record, false, nil
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
			if routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset) != key || transfer.Phase == "destination_confirmed" || transfer.Phase == "refund_recovery" {
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
		ExternalSubmissionEnabled: false, LiveBridge: false, TruthfulStatus: "local-coordinator-only-no-external-submission", Safety: s.state.Safety, Build: buildinfo.Normalize(build)}
	for _, transfer := range s.state.Transfers {
		switch transfer.Status {
		case "ready_for_local_finalization":
			health.ReadyCount++
		case "finalized_local":
			health.FinalizedLocalCount++
		}
	}
	health.RateLimit, health.RateLimitDenied = s.RateLimitSnapshot()
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

func (s *Service) validateStateLocked() (bool, error) {
	for eventKey, transferID := range s.state.SourceEvents {
		if _, ok := s.state.Transfers[transferID]; !ok || strings.TrimSpace(eventKey) == "" {
			return false, errors.New("bridge source-event index is inconsistent")
		}
	}
	allowedPhases := map[string]bool{"source_submitted": true, "source_accepted": true, "source_finalized": true, "proof_attestation": true, "destination_mint_release": true, "destination_confirmed": true, "failed": true, "refund_recovery": true, "dispute": true}
	exposure := map[string]uint64{}
	userExposure := map[string]uint64{}
	dailyVolume := map[string]uint64{}
	for _, transfer := range s.state.Transfers {
		if transfer.ExternalSubmissionEnabled || transfer.RequiredAttestations != s.cfg.Threshold {
			return false, errors.New("bridge persisted transfer violates current safety policy")
		}
		key := routeKey(transfer.SourceChain, transfer.DestinationChain, transfer.SourceAsset, transfer.DestinationAsset)
		if _, ok := s.policies[key]; !ok {
			return false, errors.New("bridge persisted transfer uses an unsupported route")
		}
		if !allowedPhases[transfer.Phase] {
			return false, errors.New("bridge persisted transfer has an invalid lifecycle phase")
		}
		amount, err := strconv.ParseUint(transfer.Amount, 10, 64)
		if err != nil || amount == 0 {
			return false, errors.New("bridge persisted transfer amount is invalid")
		}
		if transfer.Phase != "destination_confirmed" && transfer.Phase != "refund_recovery" {
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
	}
	for key, record := range s.state.Reconciliations {
		policy, ok := s.policies[key]
		if !ok || routeKey(record.Route.SourceChain, record.Route.DestinationChain, record.Route.SourceAsset, record.Route.DestinationAsset) != key || routeKey(policy.SourceChain, policy.DestinationChain, policy.SourceAsset, policy.DestinationAsset) != key {
			return false, errors.New("bridge reconciliation uses an unsupported route")
		}
		values := make([]uint64, 7)
		for i, raw := range []string{record.Locked, record.Burned, record.Minted, record.Released, record.OutstandingSupply, record.ReserveBacking, record.Difference} {
			value, err := strconv.ParseUint(raw, 10, 64)
			if err != nil {
				return false, errors.New("bridge reconciliation amount is invalid")
			}
			values[i] = value
		}
		if values[1] > values[2] || values[3] > values[0] || values[4] != values[2]-values[1] || values[5] != values[0]-values[3] {
			return false, errors.New("bridge reconciliation accounting is inconsistent")
		}
		difference := values[4]
		if values[5] >= values[4] {
			difference = values[5] - values[4]
		} else {
			difference = values[4] - values[5]
		}
		if values[6] != difference || record.Balanced != (difference == 0) || record.Source != "operator-submitted-evidence" || record.Verification != "reference-recorded-not-independently-verified" {
			return false, errors.New("bridge reconciliation truth boundary is invalid")
		}
		if _, err := time.Parse(time.RFC3339Nano, record.ObservedAt); err != nil {
			return false, errors.New("bridge reconciliation observed time is invalid")
		}
	}
	return true, nil
}

const timeFormat = "2006-01-02T15:04:05.000000000Z"
