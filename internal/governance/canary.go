package governance

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"math/bits"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	SignedCanaryVersion       = "ynx-governance-canary/v1"
	SignedCanaryResultVersion = "ynx-governance-canary-result/v1"
	minCanaryWindow           = 5 * time.Minute
)

type CanaryStatus string

const (
	CanaryEligible  CanaryStatus = "eligible"
	CanaryRunning   CanaryStatus = "running"
	CanaryPassed    CanaryStatus = "passed"
	CanaryFailed    CanaryStatus = "failed"
	CanaryAborted   CanaryStatus = "aborted"
	CanaryCancelled CanaryStatus = "cancelled"
	CanaryExpired   CanaryStatus = "expired"
	CanaryPaused    CanaryStatus = "emergency_paused"
	CanaryCorrected CanaryStatus = "corrected"
)

type SignedCanaryEnvelope struct {
	Version            string    `json:"version"`
	Domain             string    `json:"domain"`
	ChainID            string    `json:"chainId"`
	ProposalID         string    `json:"proposalId"`
	ActionHash         string    `json:"actionHash"`
	ManifestHash       string    `json:"manifestHash"`
	CanaryPlanHash     string    `json:"canaryPlanHash"`
	CohortManifestHash string    `json:"cohortManifestHash"`
	TargetBPS          uint64    `json:"targetBps"`
	MinimumSamples     uint64    `json:"minimumSamples"`
	MaxFailureBPS      uint64    `json:"maxFailureBps"`
	StartsAt           time.Time `json:"startsAt"`
	EndsAt             time.Time `json:"endsAt"`
	Nonce              string    `json:"nonce"`
	Operator           string    `json:"operator"`
	PublicKey          string    `json:"publicKey"`
	Evidence           []string  `json:"evidence"`
	Signature          string    `json:"signature"`
}

type canarySigningRecord struct {
	Version            string   `json:"version"`
	Domain             string   `json:"domain"`
	ChainID            string   `json:"chainId"`
	ProposalID         string   `json:"proposalId"`
	ActionHash         string   `json:"actionHash"`
	ManifestHash       string   `json:"manifestHash"`
	CanaryPlanHash     string   `json:"canaryPlanHash"`
	CohortManifestHash string   `json:"cohortManifestHash"`
	TargetBPS          uint64   `json:"targetBps"`
	MinimumSamples     uint64   `json:"minimumSamples"`
	MaxFailureBPS      uint64   `json:"maxFailureBps"`
	StartsAt           string   `json:"startsAt"`
	EndsAt             string   `json:"endsAt"`
	Nonce              string   `json:"nonce"`
	Operator           string   `json:"operator"`
	PublicKey          string   `json:"publicKey"`
	Evidence           []string `json:"evidence"`
}

type SignedCanaryResultEnvelope struct {
	Version            string    `json:"version"`
	Domain             string    `json:"domain"`
	ChainID            string    `json:"chainId"`
	ProposalID         string    `json:"proposalId"`
	CanaryID           string    `json:"canaryId"`
	ManifestHash       string    `json:"manifestHash"`
	CohortManifestHash string    `json:"cohortManifestHash"`
	TotalSamples       uint64    `json:"totalSamples"`
	FailedSamples      uint64    `json:"failedSamples"`
	MetricsHash        string    `json:"metricsHash"`
	StateRoot          string    `json:"stateRoot"`
	ObservedFrom       time.Time `json:"observedFrom"`
	ObservedTo         time.Time `json:"observedTo"`
	Nonce              string    `json:"nonce"`
	Verifier           string    `json:"verifier"`
	PublicKey          string    `json:"publicKey"`
	Evidence           []string  `json:"evidence"`
	Signature          string    `json:"signature"`
}

type canaryResultSigningRecord struct {
	Version            string   `json:"version"`
	Domain             string   `json:"domain"`
	ChainID            string   `json:"chainId"`
	ProposalID         string   `json:"proposalId"`
	CanaryID           string   `json:"canaryId"`
	ManifestHash       string   `json:"manifestHash"`
	CohortManifestHash string   `json:"cohortManifestHash"`
	TotalSamples       uint64   `json:"totalSamples"`
	FailedSamples      uint64   `json:"failedSamples"`
	MetricsHash        string   `json:"metricsHash"`
	StateRoot          string   `json:"stateRoot"`
	ObservedFrom       string   `json:"observedFrom"`
	ObservedTo         string   `json:"observedTo"`
	Nonce              string   `json:"nonce"`
	Verifier           string   `json:"verifier"`
	PublicKey          string   `json:"publicKey"`
	Evidence           []string `json:"evidence"`
}

type CanaryResult struct {
	Envelope    SignedCanaryResultEnvelope `json:"envelope"`
	FailureBPS  uint64                     `json:"failureBps"`
	Outcome     string                     `json:"outcome"`
	CompletedAt time.Time                  `json:"completedAt"`
	AuditHash   string                     `json:"auditHash"`
}

type CanaryTransition struct {
	Sequence  uint64       `json:"sequence"`
	From      CanaryStatus `json:"from,omitempty"`
	To        CanaryStatus `json:"to"`
	Actor     string       `json:"actor"`
	Reason    string       `json:"reason"`
	Evidence  []string     `json:"evidence"`
	At        time.Time    `json:"at"`
	Previous  string       `json:"previousAuditHash,omitempty"`
	AuditHash string       `json:"auditHash"`
}

type CanaryRecord struct {
	ID             string                `json:"id"`
	ProposalID     string                `json:"proposalId"`
	ActionHash     string                `json:"actionHash"`
	CanaryPlanHash string                `json:"canaryPlanHash"`
	Status         CanaryStatus          `json:"status"`
	EligibleAt     time.Time             `json:"eligibleAt"`
	Envelope       *SignedCanaryEnvelope `json:"envelope,omitempty"`
	Result         *CanaryResult         `json:"result,omitempty"`
	Transitions    []CanaryTransition    `json:"transitions"`
	AuditHash      string                `json:"auditHash"`
}

var canaryTransitions = map[CanaryStatus]map[CanaryStatus]bool{
	"":             {CanaryEligible: true},
	CanaryEligible: {CanaryRunning: true, CanaryCancelled: true, CanaryExpired: true, CanaryPaused: true},
	CanaryRunning:  {CanaryPassed: true, CanaryFailed: true, CanaryAborted: true, CanaryCancelled: true, CanaryExpired: true, CanaryPaused: true},
	CanaryPassed:   {CanaryCancelled: true, CanaryExpired: true, CanaryPaused: true},
	CanaryFailed:   {CanaryCancelled: true, CanaryExpired: true, CanaryPaused: true},
	CanaryAborted:  {CanaryCancelled: true, CanaryExpired: true, CanaryPaused: true},
	CanaryPaused:   {CanaryCorrected: true, CanaryExpired: true},
}

func canaryDomain(policy Policy) string {
	return policy.VoteDomain + ".canary"
}

func proposalCanaryPlanHash(proposal *Proposal) string {
	return hash("canary-plan", proposal.Input.CanaryPlan)
}

func CanarySigningPayload(envelope SignedCanaryEnvelope) ([]byte, error) {
	if envelope.Version != SignedCanaryVersion {
		return nil, fmt.Errorf("%w: unsupported canary envelope version", ErrInvalid)
	}
	record := canarySigningRecord{
		Version: envelope.Version, Domain: strings.TrimSpace(envelope.Domain), ChainID: strings.TrimSpace(envelope.ChainID),
		ProposalID: strings.TrimSpace(envelope.ProposalID), ActionHash: strings.ToLower(strings.TrimSpace(envelope.ActionHash)),
		ManifestHash: strings.ToLower(strings.TrimSpace(envelope.ManifestHash)), CanaryPlanHash: strings.ToLower(strings.TrimSpace(envelope.CanaryPlanHash)),
		CohortManifestHash: strings.ToLower(strings.TrimSpace(envelope.CohortManifestHash)), TargetBPS: envelope.TargetBPS,
		MinimumSamples: envelope.MinimumSamples, MaxFailureBPS: envelope.MaxFailureBPS,
		StartsAt: envelope.StartsAt.UTC().Format(time.RFC3339Nano), EndsAt: envelope.EndsAt.UTC().Format(time.RFC3339Nano),
		Nonce: strings.TrimSpace(envelope.Nonce), Operator: strings.TrimSpace(envelope.Operator), PublicKey: strings.TrimSpace(envelope.PublicKey),
		Evidence: append([]string(nil), envelope.Evidence...),
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX-GOVERNANCE-CANARY\x00"), encoded...), nil
}

func SignCanaryEnvelope(envelope SignedCanaryEnvelope, privateKey ed25519.PrivateKey) (SignedCanaryEnvelope, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return SignedCanaryEnvelope{}, fmt.Errorf("%w: invalid canary signing key", ErrInvalid)
	}
	payload, err := CanarySigningPayload(envelope)
	if err != nil {
		return SignedCanaryEnvelope{}, err
	}
	envelope.Signature = nativewallet.Sign(privateKey, payload)
	return envelope, nil
}

func CanaryResultSigningPayload(envelope SignedCanaryResultEnvelope) ([]byte, error) {
	if envelope.Version != SignedCanaryResultVersion {
		return nil, fmt.Errorf("%w: unsupported canary result envelope version", ErrInvalid)
	}
	record := canaryResultSigningRecord{
		Version: envelope.Version, Domain: strings.TrimSpace(envelope.Domain), ChainID: strings.TrimSpace(envelope.ChainID),
		ProposalID: strings.TrimSpace(envelope.ProposalID), CanaryID: strings.ToLower(strings.TrimSpace(envelope.CanaryID)),
		ManifestHash: strings.ToLower(strings.TrimSpace(envelope.ManifestHash)), CohortManifestHash: strings.ToLower(strings.TrimSpace(envelope.CohortManifestHash)),
		TotalSamples: envelope.TotalSamples, FailedSamples: envelope.FailedSamples,
		MetricsHash: strings.ToLower(strings.TrimSpace(envelope.MetricsHash)), StateRoot: strings.ToLower(strings.TrimSpace(envelope.StateRoot)),
		ObservedFrom: envelope.ObservedFrom.UTC().Format(time.RFC3339Nano), ObservedTo: envelope.ObservedTo.UTC().Format(time.RFC3339Nano),
		Nonce: strings.TrimSpace(envelope.Nonce), Verifier: strings.TrimSpace(envelope.Verifier), PublicKey: strings.TrimSpace(envelope.PublicKey),
		Evidence: append([]string(nil), envelope.Evidence...),
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX-GOVERNANCE-CANARY-RESULT\x00"), encoded...), nil
}

func SignCanaryResultEnvelope(envelope SignedCanaryResultEnvelope, privateKey ed25519.PrivateKey) (SignedCanaryResultEnvelope, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return SignedCanaryResultEnvelope{}, fmt.Errorf("%w: invalid canary result signing key", ErrInvalid)
	}
	payload, err := CanaryResultSigningPayload(envelope)
	if err != nil {
		return SignedCanaryResultEnvelope{}, err
	}
	envelope.Signature = nativewallet.Sign(privateKey, payload)
	return envelope, nil
}

func (s *Service) createCanaryLocked(proposal *Proposal, evidence []string, now time.Time) (*CanaryRecord, error) {
	if proposal == nil || s.timelocks[proposal.ID] == nil || len(strings.TrimSpace(proposal.Input.CanaryPlan)) < 16 || len(evidence) == 0 {
		return nil, ErrInvalid
	}
	if _, exists := s.canaries[proposal.ID]; exists {
		return nil, ErrReplay
	}
	record := &CanaryRecord{
		ID: hash("canary", proposal.ID, proposal.ActionHash, proposalCanaryPlanHash(proposal)), ProposalID: proposal.ID,
		ActionHash: proposal.ActionHash, CanaryPlanHash: proposalCanaryPlanHash(proposal), EligibleAt: now.UTC(),
	}
	if err := transitionCanary(record, CanaryEligible, "ynx-governance-runtime", "approved action entered a mandatory signed canary gate before execution", evidence, now); err != nil {
		return nil, err
	}
	s.canaries[proposal.ID] = record
	s.syncUpgradeCanaryLocked(proposal, record)
	return record, nil
}

func (s *Service) StartCanary(envelope SignedCanaryEnvelope, now time.Time) (CanaryRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	proposal, err := s.mutable(strings.TrimSpace(envelope.ProposalID), now)
	if err != nil {
		return CanaryRecord{}, err
	}
	timelock, ok := s.timelocks[proposal.ID]
	record := s.canaries[proposal.ID]
	if !ok || record == nil || proposal.Status != StatusTimelockActive || timelock.Status != TimelockActive || record.Status != CanaryEligible {
		return CanaryRecord{}, ErrNotReady
	}
	if err = validateCanaryEnvelope(envelope, proposal, record, timelock, s.policy, now); err != nil {
		return CanaryRecord{}, err
	}
	nonceID := canaryNonceID(envelope)
	if _, exists := s.canaryNonces[nonceID]; exists {
		return CanaryRecord{}, ErrReplay
	}
	envelope.ManifestHash = strings.ToLower(envelope.ManifestHash)
	envelope.ActionHash = strings.ToLower(envelope.ActionHash)
	envelope.CanaryPlanHash = strings.ToLower(envelope.CanaryPlanHash)
	envelope.CohortManifestHash = strings.ToLower(envelope.CohortManifestHash)
	envelope.Evidence = append([]string(nil), envelope.Evidence...)
	record.Envelope = &envelope
	evidence := append([]string{
		"cohort-manifest://sha256/" + envelope.CohortManifestHash,
		"candidate-manifest://sha256/" + envelope.ManifestHash,
		"signature://ed25519/" + envelope.Signature,
		"nonce://" + envelope.Nonce,
	}, envelope.Evidence...)
	if err = transitionCanary(record, CanaryRunning, envelope.Operator, "signed canary cohort began its bounded health observation window", evidence, now); err != nil {
		record.Envelope = nil
		return CanaryRecord{}, err
	}
	s.canaryNonces[nonceID] = struct{}{}
	s.syncUpgradeCanaryLocked(proposal, record)
	return cloneCanary(record), nil
}

func (s *Service) CompleteCanary(input SignedCanaryResultEnvelope, now time.Time) (CanaryRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	proposal, err := s.mutable(strings.TrimSpace(input.ProposalID), now)
	if err != nil {
		return CanaryRecord{}, err
	}
	record := s.canaries[proposal.ID]
	timelock := s.timelocks[proposal.ID]
	if record == nil || timelock == nil || record.Status != CanaryRunning || record.Envelope == nil ||
		proposal.Status != StatusTimelockActive || timelock.Status != TimelockActive || now.After(timelock.GraceEndsAt) {
		return CanaryRecord{}, ErrInvalid
	}
	if err = validateCanaryResultEnvelope(input, proposal, record, s.policy, now); err != nil {
		return CanaryRecord{}, err
	}
	nonceID := canaryResultNonceID(input)
	if _, exists := s.canaryNonces[nonceID]; exists {
		return CanaryRecord{}, ErrReplay
	}
	high, low := bits.Mul64(input.FailedSamples, 10000)
	failureBPS, _ := bits.Div64(high, low, input.TotalSamples)
	breached := failureBPS > record.Envelope.MaxFailureBPS
	if now.Before(record.Envelope.EndsAt) && !breached {
		return CanaryRecord{}, ErrNotReady
	}
	outcome, status, reason := "passed", CanaryPassed, "canary health window met sample and failure thresholds with bound evidence"
	if breached && now.Before(record.Envelope.EndsAt) {
		outcome, status, reason = "aborted", CanaryAborted, "canary breached its signed failure threshold and was aborted before window completion"
	} else if breached || input.TotalSamples < record.Envelope.MinimumSamples {
		outcome, status, reason = "failed", CanaryFailed, "canary health window failed its signed sample or failure threshold"
	}
	input.ManifestHash = strings.ToLower(input.ManifestHash)
	input.CohortManifestHash = strings.ToLower(input.CohortManifestHash)
	input.MetricsHash = strings.ToLower(input.MetricsHash)
	input.StateRoot = strings.ToLower(input.StateRoot)
	input.Evidence = append([]string(nil), input.Evidence...)
	result := &CanaryResult{Envelope: input, FailureBPS: failureBPS, Outcome: outcome, CompletedAt: now}
	result.AuditHash = canaryResultAudit(record.ID, result)
	record.Result = result
	evidence := append([]string{
		"canary-metrics://sha256/" + result.Envelope.MetricsHash,
		"canary-state-root://" + result.Envelope.StateRoot,
		"canary-result://" + result.AuditHash,
		"signature://ed25519/" + result.Envelope.Signature,
		"nonce://" + result.Envelope.Nonce,
	}, result.Envelope.Evidence...)
	if err = transitionCanary(record, status, result.Envelope.Verifier, reason, evidence, now); err != nil {
		record.Result = nil
		return CanaryRecord{}, err
	}
	s.canaryNonces[nonceID] = struct{}{}
	s.syncUpgradeCanaryLocked(proposal, record)
	return cloneCanary(record), nil
}

func (s *Service) ListCanaries() []CanaryRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]CanaryRecord, 0, len(s.canaries))
	for _, record := range s.canaries {
		out = append(out, cloneCanary(record))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].EligibleAt.Equal(out[j].EligibleAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].EligibleAt.Before(out[j].EligibleAt)
	})
	return out
}

func validateCanaryEnvelope(envelope SignedCanaryEnvelope, proposal *Proposal, record *CanaryRecord, timelock *TimelockRecord, policy Policy, now time.Time) error {
	if envelope.Version != SignedCanaryVersion || envelope.Domain != canaryDomain(policy) || envelope.ChainID != policy.ChainID ||
		envelope.ProposalID != proposal.ID || !strings.EqualFold(envelope.ActionHash, proposal.ActionHash) ||
		!strings.EqualFold(envelope.CanaryPlanHash, record.CanaryPlanHash) || !validHash(strings.ToLower(envelope.ManifestHash)) ||
		!validHash(strings.ToLower(envelope.CohortManifestHash)) || envelope.TargetBPS == 0 || envelope.TargetBPS > 10000 ||
		envelope.MinimumSamples == 0 || envelope.MaxFailureBPS >= 10000 || len(strings.TrimSpace(envelope.Nonce)) < 16 ||
		!validCanaryEvidence(envelope.Evidence) || envelope.StartsAt.IsZero() || envelope.EndsAt.IsZero() ||
		envelope.StartsAt.Before(record.EligibleAt) || envelope.StartsAt.After(now) ||
		envelope.StartsAt.Before(now.Add(-policy.VoteMaxClockSkew)) || !now.Before(envelope.EndsAt) ||
		envelope.EndsAt.Before(envelope.StartsAt.Add(minCanaryWindow)) || envelope.EndsAt.After(timelock.EarliestExecution) ||
		envelope.Operator != strings.TrimSpace(envelope.Operator) || envelope.PublicKey != strings.TrimSpace(envelope.PublicKey) {
		return ErrInvalid
	}
	if isUpgradeProposal(proposal) && !strings.EqualFold(envelope.ManifestHash, proposal.Input.UpgradeHash) {
		return fmt.Errorf("%w: canary candidate does not match upgrade manifest", ErrForbidden)
	}
	operatorID, err := GovernanceVoterID(envelope.PublicKey)
	if err != nil || operatorID != envelope.Operator {
		return fmt.Errorf("%w: canary operator does not match signing key", ErrForbidden)
	}
	payload, err := CanarySigningPayload(envelope)
	if err != nil || !nativewallet.Verify(envelope.PublicKey, payload, envelope.Signature) {
		return fmt.Errorf("%w: invalid canary signature", ErrForbidden)
	}
	return nil
}

func validateCanaryResultEnvelope(envelope SignedCanaryResultEnvelope, proposal *Proposal, record *CanaryRecord, policy Policy, now time.Time) error {
	if record == nil || record.Envelope == nil || envelope.Version != SignedCanaryResultVersion ||
		envelope.Domain != canaryDomain(policy)+".result" || envelope.ChainID != policy.ChainID ||
		envelope.ProposalID != proposal.ID || envelope.CanaryID != record.ID ||
		!strings.EqualFold(envelope.ManifestHash, record.Envelope.ManifestHash) ||
		!strings.EqualFold(envelope.CohortManifestHash, record.Envelope.CohortManifestHash) ||
		envelope.TotalSamples == 0 || envelope.FailedSamples > envelope.TotalSamples ||
		!validHash(strings.ToLower(envelope.MetricsHash)) ||
		!validHash(strings.ToLower(strings.TrimPrefix(envelope.StateRoot, "0x"))) ||
		!envelope.ObservedFrom.Equal(record.Envelope.StartsAt) || !envelope.ObservedTo.Equal(now) ||
		envelope.ObservedTo.Before(envelope.ObservedFrom) || len(strings.TrimSpace(envelope.Nonce)) < 16 ||
		envelope.Verifier == record.Envelope.Operator || envelope.Verifier != strings.TrimSpace(envelope.Verifier) ||
		envelope.PublicKey != strings.TrimSpace(envelope.PublicKey) || !validCanaryEvidence(envelope.Evidence) {
		return ErrInvalid
	}
	verifierID, err := GovernanceVoterID(envelope.PublicKey)
	if err != nil || verifierID != envelope.Verifier {
		return fmt.Errorf("%w: canary verifier does not match signing key", ErrForbidden)
	}
	payload, err := CanaryResultSigningPayload(envelope)
	if err != nil || !nativewallet.Verify(envelope.PublicKey, payload, envelope.Signature) {
		return fmt.Errorf("%w: invalid canary result signature", ErrForbidden)
	}
	return nil
}

func validCanaryEvidence(evidence []string) bool {
	if len(evidence) == 0 {
		return false
	}
	for _, item := range evidence {
		if len(strings.TrimSpace(item)) < 8 {
			return false
		}
	}
	return true
}

func transitionCanary(record *CanaryRecord, to CanaryStatus, actor, reason string, evidence []string, now time.Time) error {
	if record == nil || !canaryTransitions[record.Status][to] || len(strings.TrimSpace(actor)) < 3 || len(strings.TrimSpace(reason)) < 16 || len(evidence) == 0 {
		return ErrInvalid
	}
	transition := CanaryTransition{
		Sequence: uint64(len(record.Transitions) + 1), From: record.Status, To: to, Actor: strings.TrimSpace(actor),
		Reason: strings.TrimSpace(reason), Evidence: append([]string(nil), evidence...), At: now.UTC(),
	}
	if len(record.Transitions) > 0 {
		transition.Previous = record.Transitions[len(record.Transitions)-1].AuditHash
	}
	transition.AuditHash = canaryTransitionAudit(record.ID, transition)
	record.Transitions = append(record.Transitions, transition)
	record.Status = to
	record.AuditHash = canaryAudit(record)
	return nil
}

func (s *Service) transitionCanaryLocked(proposal *Proposal, to CanaryStatus, actor, reason string, evidence []string, now time.Time) error {
	record := s.canaries[proposal.ID]
	if record == nil {
		if s.timelocks[proposal.ID] == nil {
			return nil
		}
		return fmt.Errorf("%w: first-class canary record missing", ErrForbidden)
	}
	if err := transitionCanary(record, to, actor, reason, evidence, now); err != nil {
		return err
	}
	s.syncUpgradeCanaryLocked(proposal, record)
	return nil
}

func (s *Service) syncUpgradeCanaryLocked(proposal *Proposal, canary *CanaryRecord) {
	if !isUpgradeProposal(proposal) || canary == nil {
		return
	}
	if upgrade := s.upgrades[proposal.ID]; upgrade != nil {
		upgrade.CanaryEligible = true
		upgrade.CanaryStatus = string(canary.Status)
		upgrade.CanaryRecordID = canary.ID
		upgrade.CanaryAuditHash = canary.AuditHash
		upgrade.AuditHash = upgradeAudit(upgrade)
	}
}

func canaryTransitionAudit(id string, transition CanaryTransition) string {
	return hash(id, fmt.Sprint(transition.Sequence), string(transition.From), string(transition.To), transition.Actor, transition.Reason,
		strings.Join(transition.Evidence, "|"), transition.At.Format(time.RFC3339Nano), transition.Previous)
}

func canaryResultAudit(id string, result *CanaryResult) string {
	payload, _ := CanaryResultSigningPayload(result.Envelope)
	return hash(id, hash(string(payload)), result.Envelope.Signature, fmt.Sprint(result.FailureBPS),
		result.Outcome, result.CompletedAt.Format(time.RFC3339Nano))
}

func canaryAudit(record *CanaryRecord) string {
	parts := []string{record.ID, record.ProposalID, record.ActionHash, record.CanaryPlanHash, string(record.Status), record.EligibleAt.Format(time.RFC3339Nano)}
	if record.Envelope != nil {
		payload, _ := CanarySigningPayload(*record.Envelope)
		parts = append(parts, hash(string(payload)), record.Envelope.Signature)
	}
	if record.Result != nil {
		parts = append(parts, record.Result.AuditHash)
	}
	for _, transition := range record.Transitions {
		parts = append(parts, transition.AuditHash)
	}
	return hash(parts...)
}

func cloneCanary(record *CanaryRecord) CanaryRecord {
	out := *record
	if record.Envelope != nil {
		envelope := *record.Envelope
		envelope.Evidence = append([]string(nil), record.Envelope.Evidence...)
		out.Envelope = &envelope
	}
	if record.Result != nil {
		result := *record.Result
		result.Envelope.Evidence = append([]string(nil), record.Result.Envelope.Evidence...)
		out.Result = &result
	}
	out.Transitions = make([]CanaryTransition, len(record.Transitions))
	for i, transition := range record.Transitions {
		out.Transitions[i] = transition
		out.Transitions[i].Evidence = append([]string(nil), transition.Evidence...)
	}
	return out
}

func canaryNonceID(envelope SignedCanaryEnvelope) string {
	return hash("canary-nonce", envelope.ChainID, envelope.Domain, envelope.ProposalID, envelope.Operator, envelope.Nonce)
}

func canaryResultNonceID(envelope SignedCanaryResultEnvelope) string {
	return hash("canary-result-nonce", envelope.ChainID, envelope.Domain, envelope.ProposalID, envelope.Verifier, envelope.Nonce)
}

func validateStoredCanary(record *CanaryRecord, proposal *Proposal, timelock *TimelockRecord, policy Policy) error {
	if record == nil || proposal == nil || timelock == nil ||
		record.ID != hash("canary", proposal.ID, proposal.ActionHash, proposalCanaryPlanHash(proposal)) ||
		record.ProposalID != proposal.ID || record.ActionHash != proposal.ActionHash ||
		record.CanaryPlanHash != proposalCanaryPlanHash(proposal) || record.EligibleAt.IsZero() ||
		len(record.Transitions) == 0 || !record.EligibleAt.Equal(record.Transitions[0].At) {
		return fmt.Errorf("%w: invalid stored canary identity", ErrForbidden)
	}
	var status CanaryStatus
	var previous string
	for index, transition := range record.Transitions {
		if transition.Sequence != uint64(index+1) || transition.From != status || !canaryTransitions[status][transition.To] ||
			transition.Previous != previous || transition.AuditHash != canaryTransitionAudit(record.ID, transition) ||
			(index > 0 && transition.At.Before(record.Transitions[index-1].At)) {
			return fmt.Errorf("%w: invalid canary transition history", ErrForbidden)
		}
		status, previous = transition.To, transition.AuditHash
	}
	if status != record.Status {
		return fmt.Errorf("%w: canary status does not match transition history", ErrForbidden)
	}
	if record.Transitions[0].To != CanaryEligible || record.Transitions[0].Actor != "ynx-governance-runtime" {
		return fmt.Errorf("%w: invalid canary eligibility transition", ErrForbidden)
	}
	if !slices.Equal(record.Transitions[0].Evidence, timelock.NoticeEvidence) {
		return fmt.Errorf("%w: canary eligibility evidence and timelock notice disagree", ErrForbidden)
	}
	if record.Envelope != nil {
		if err := validateCanaryEnvelope(*record.Envelope, proposal, record, timelock, policy, record.Envelope.StartsAt); err != nil {
			return fmt.Errorf("%w: stored canary envelope: %v", ErrForbidden, err)
		}
		if record.Status == CanaryEligible {
			return fmt.Errorf("%w: eligible canary cannot contain a signed cohort", ErrForbidden)
		}
		var runningTransition *CanaryTransition
		for index := range record.Transitions {
			if record.Transitions[index].To == CanaryRunning {
				runningTransition = &record.Transitions[index]
			}
		}
		expectedEvidence := append([]string{
			"cohort-manifest://sha256/" + record.Envelope.CohortManifestHash,
			"candidate-manifest://sha256/" + record.Envelope.ManifestHash,
			"signature://ed25519/" + record.Envelope.Signature,
			"nonce://" + record.Envelope.Nonce,
		}, record.Envelope.Evidence...)
		if runningTransition == nil || runningTransition.Actor != record.Envelope.Operator ||
			runningTransition.At.Before(record.Envelope.StartsAt) ||
			runningTransition.At.After(record.Envelope.StartsAt.Add(policy.VoteMaxClockSkew)) ||
			!slices.Equal(runningTransition.Evidence, expectedEvidence) {
			return fmt.Errorf("%w: signed cohort and running transition disagree", ErrForbidden)
		}
	} else if record.Status == CanaryRunning || record.Status == CanaryPassed || record.Status == CanaryFailed || record.Status == CanaryAborted {
		return fmt.Errorf("%w: canary status requires a signed cohort", ErrForbidden)
	}
	if record.Result != nil {
		result := record.Result
		if record.Envelope == nil || !result.CompletedAt.Equal(result.Envelope.ObservedTo) ||
			validateCanaryResultEnvelope(result.Envelope, proposal, record, policy, result.CompletedAt) != nil ||
			result.AuditHash != canaryResultAudit(record.ID, result) {
			return fmt.Errorf("%w: invalid stored canary result", ErrForbidden)
		}
		high, low := bits.Mul64(result.Envelope.FailedSamples, 10000)
		expectedFailureBPS, _ := bits.Div64(high, low, result.Envelope.TotalSamples)
		if result.FailureBPS != expectedFailureBPS {
			return fmt.Errorf("%w: invalid stored canary failure rate", ErrForbidden)
		}
		breached := result.FailureBPS > record.Envelope.MaxFailureBPS
		var resultStatus CanaryStatus
		var resultTransition *CanaryTransition
		for _, transition := range record.Transitions {
			if transition.To == CanaryPassed || transition.To == CanaryFailed || transition.To == CanaryAborted {
				resultStatus = transition.To
				value := transition
				resultTransition = &value
			}
		}
		if resultTransition == nil || resultTransition.Actor != result.Envelope.Verifier || !resultTransition.At.Equal(result.CompletedAt) {
			return fmt.Errorf("%w: signed result and terminal canary transition disagree", ErrForbidden)
		}
		expectedEvidence := append([]string{
			"canary-metrics://sha256/" + result.Envelope.MetricsHash,
			"canary-state-root://" + result.Envelope.StateRoot,
			"canary-result://" + result.AuditHash,
			"signature://ed25519/" + result.Envelope.Signature,
			"nonce://" + result.Envelope.Nonce,
		}, result.Envelope.Evidence...)
		if !slices.Equal(resultTransition.Evidence, expectedEvidence) {
			return fmt.Errorf("%w: signed result and terminal canary evidence disagree", ErrForbidden)
		}
		switch resultStatus {
		case CanaryPassed:
			if result.Outcome != "passed" || result.CompletedAt.Before(record.Envelope.EndsAt) ||
				result.Envelope.TotalSamples < record.Envelope.MinimumSamples || breached {
				return fmt.Errorf("%w: invalid passed canary result", ErrForbidden)
			}
		case CanaryFailed:
			if result.Outcome != "failed" || result.CompletedAt.Before(record.Envelope.EndsAt) ||
				(!breached && result.Envelope.TotalSamples >= record.Envelope.MinimumSamples) {
				return fmt.Errorf("%w: invalid failed canary result", ErrForbidden)
			}
		case CanaryAborted:
			if result.Outcome != "aborted" || !result.CompletedAt.Before(record.Envelope.EndsAt) || !breached {
				return fmt.Errorf("%w: invalid aborted canary result", ErrForbidden)
			}
		default:
			return fmt.Errorf("%w: canary result attached to incompatible status", ErrForbidden)
		}
	} else if record.Status == CanaryPassed || record.Status == CanaryFailed || record.Status == CanaryAborted {
		return fmt.Errorf("%w: terminal canary outcome is missing result", ErrForbidden)
	}
	if record.AuditHash != canaryAudit(record) {
		return fmt.Errorf("%w: canary audit mismatch", ErrForbidden)
	}
	switch {
	case proposalReached(proposal, StatusExecutionReady):
		if record.Status != CanaryPassed {
			return fmt.Errorf("%w: execution proceeded without a passed canary", ErrForbidden)
		}
	case proposalReached(proposal, StatusCancelled):
		if record.Status != CanaryCancelled {
			return fmt.Errorf("%w: cancelled proposal and canary disagree", ErrForbidden)
		}
	case proposalReached(proposal, StatusExpired):
		if record.Status != CanaryExpired {
			return fmt.Errorf("%w: expired proposal and canary disagree", ErrForbidden)
		}
	case proposalReached(proposal, StatusCorrected):
		if record.Status != CanaryCorrected {
			return fmt.Errorf("%w: corrected proposal and canary disagree", ErrForbidden)
		}
	case proposal.Status == StatusEmergencyPaused:
		if record.Status != CanaryPaused {
			return fmt.Errorf("%w: paused proposal and canary disagree", ErrForbidden)
		}
	}
	return nil
}

func validateCanaryRegistry(canaries map[string]*CanaryRecord, timelocks map[string]*TimelockRecord, upgrades map[string]*UpgradeRecord, proposals map[string]*Proposal) error {
	for proposalID, timelock := range timelocks {
		record, exists := canaries[proposalID]
		if !exists || record.ActionHash != timelock.ActionHash {
			return fmt.Errorf("%w: timelock and mandatory canary records disagree", ErrForbidden)
		}
		if upgrade := upgrades[proposalID]; upgrade != nil {
			if upgrade.CanaryRecordID != record.ID || upgrade.CanaryAuditHash != record.AuditHash ||
				upgrade.CanaryStatus != string(record.Status) || !upgrade.CanaryEligible {
				return fmt.Errorf("%w: upgrade and canary records disagree", ErrForbidden)
			}
		}
	}
	for proposalID := range canaries {
		if timelocks[proposalID] == nil || proposals[proposalID] == nil {
			return fmt.Errorf("%w: orphaned persistent canary record", ErrForbidden)
		}
	}
	return nil
}
