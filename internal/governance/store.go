package governance

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	snapshotVersion                   = "ynx-governance-state/v4"
	legacySignedVoteSnapshotVersion   = "ynx-governance-state/v3"
	legacyStateMachineSnapshotVersion = "ynx-governance-state/v2"
	legacySnapshotVersion             = "ynx-governance-state/v1"
)

type snapshotPayload struct {
	Version          string            `json:"version"`
	SavedAt          time.Time         `json:"savedAt"`
	Policy           Policy            `json:"policy"`
	VoteNonces       []string          `json:"voteNonces"`
	DelegationNonces []string          `json:"delegationNonces"`
	Delegations      []Delegation      `json:"delegations"`
	Proposals        []Proposal        `json:"proposals"`
	Emergencies      []EmergencyAction `json:"emergencies"`
	Roles            []RoleAssignment  `json:"roles"`
	Appeals          []Appeal          `json:"appeals"`
	Discussions      []DiscussionEntry `json:"discussions"`
}

type snapshotEnvelope struct {
	Payload snapshotPayload `json:"payload"`
	Digest  string          `json:"sha256"`
}

func (s *Service) Save(path string, now time.Time) error {
	s.mu.RLock()
	payload := snapshotPayload{Version: snapshotVersion, SavedAt: now.UTC(), Policy: s.policy}
	for nonce := range s.voteNonces {
		payload.VoteNonces = append(payload.VoteNonces, nonce)
	}
	for nonce := range s.delegationNonces {
		payload.DelegationNonces = append(payload.DelegationNonces, nonce)
	}
	for _, history := range s.delegationHistory {
		payload.Delegations = append(payload.Delegations, history...)
	}
	for _, p := range s.proposals {
		payload.Proposals = append(payload.Proposals, clone(p))
	}
	for _, a := range s.emergencies {
		payload.Emergencies = append(payload.Emergencies, cloneEmergency(a))
	}
	for _, role := range s.roles {
		payload.Roles = append(payload.Roles, cloneRole(role))
	}
	for _, appeal := range s.appeals {
		payload.Appeals = append(payload.Appeals, cloneAppeal(appeal))
	}
	for _, entry := range s.discussions {
		payload.Discussions = append(payload.Discussions, cloneDiscussion(entry))
	}
	s.mu.RUnlock()
	sort.Strings(payload.VoteNonces)
	sort.Strings(payload.DelegationNonces)
	sort.Slice(payload.Delegations, func(i, j int) bool {
		if payload.Delegations[i].AppliedAt.Equal(payload.Delegations[j].AppliedAt) {
			return payload.Delegations[i].ID < payload.Delegations[j].ID
		}
		return payload.Delegations[i].AppliedAt.Before(payload.Delegations[j].AppliedAt)
	})
	sort.Slice(payload.Proposals, func(i, j int) bool { return payload.Proposals[i].ID < payload.Proposals[j].ID })
	sort.Slice(payload.Emergencies, func(i, j int) bool { return payload.Emergencies[i].ID < payload.Emergencies[j].ID })
	sort.Slice(payload.Roles, func(i, j int) bool { return payload.Roles[i].ID < payload.Roles[j].ID })
	sort.Slice(payload.Appeals, func(i, j int) bool { return payload.Appeals[i].ID < payload.Appeals[j].ID })
	sort.Slice(payload.Discussions, func(i, j int) bool { return payload.Discussions[i].ID < payload.Discussions[j].ID })
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(encoded)
	envelope, err := json.MarshalIndent(snapshotEnvelope{Payload: payload, Digest: hex.EncodeToString(digest[:])}, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".governance-state-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err = tmp.Chmod(0o600); err == nil {
		_, err = tmp.Write(append(envelope, '\n'))
	}
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(tmpName, path); err != nil {
		return err
	}
	if dirHandle, openErr := os.Open(dir); openErr == nil {
		_ = dirHandle.Sync()
		_ = dirHandle.Close()
	}
	return nil
}

func Load(path string) (*Service, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var envelope snapshotEnvelope
	if err = json.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("%w: unreadable snapshot", ErrInvalid)
	}
	encoded, err := json.Marshal(envelope.Payload)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	if envelope.Digest != hex.EncodeToString(digest[:]) {
		return nil, fmt.Errorf("%w: snapshot integrity mismatch", ErrForbidden)
	}
	if envelope.Payload.Version == legacySnapshotVersion {
		return nil, fmt.Errorf("%w: governance state v1 requires explicit state-machine migration", ErrForbidden)
	}
	if envelope.Payload.Version == legacyStateMachineSnapshotVersion {
		return nil, fmt.Errorf("%w: governance state v2 requires explicit signed-vote migration to v3", ErrForbidden)
	}
	if envelope.Payload.Version == legacySignedVoteSnapshotVersion {
		return nil, fmt.Errorf("%w: governance state v3 requires explicit persistent-delegation migration to v4", ErrForbidden)
	}
	if envelope.Payload.Version != snapshotVersion {
		return nil, fmt.Errorf("%w: unsupported governance snapshot version %q", ErrForbidden, envelope.Payload.Version)
	}
	s, err := NewService(envelope.Payload.Policy)
	if err != nil {
		return nil, err
	}
	for i := range envelope.Payload.Proposals {
		p := envelope.Payload.Proposals[i]
		if err = validateRestoredProposal(&p, s.policy); err != nil {
			return nil, err
		}
		if _, ok := s.proposals[p.ID]; ok {
			return nil, ErrConflict
		}
		if _, ok := s.nonces[p.Input.Nonce]; ok {
			return nil, ErrReplay
		}
		s.proposals[p.ID] = &p
		s.nonces[p.Input.Nonce] = struct{}{}
	}
	storedVoteNonces := map[string]struct{}{}
	for _, nonce := range envelope.Payload.VoteNonces {
		if !validHash(nonce) {
			return nil, fmt.Errorf("%w: invalid persisted vote nonce", ErrForbidden)
		}
		if _, exists := storedVoteNonces[nonce]; exists {
			return nil, ErrReplay
		}
		storedVoteNonces[nonce] = struct{}{}
	}
	actualVoteNonces := map[string]struct{}{}
	for _, proposal := range s.proposals {
		proposalNonces, validationErr := validateProposalVoteHistory(proposal, s.policy)
		if validationErr != nil {
			return nil, validationErr
		}
		for nonce := range proposalNonces {
			if _, exists := actualVoteNonces[nonce]; exists {
				return nil, ErrReplay
			}
			actualVoteNonces[nonce] = struct{}{}
		}
	}
	if len(storedVoteNonces) != len(actualVoteNonces) {
		return nil, fmt.Errorf("%w: persisted vote nonce registry does not match signed vote history", ErrForbidden)
	}
	for nonce := range actualVoteNonces {
		if _, exists := storedVoteNonces[nonce]; !exists {
			return nil, fmt.Errorf("%w: signed vote nonce missing from persisted registry", ErrForbidden)
		}
	}
	s.voteNonces = actualVoteNonces
	storedDelegationNonces := map[string]struct{}{}
	for _, nonce := range envelope.Payload.DelegationNonces {
		if !validHash(nonce) {
			return nil, fmt.Errorf("%w: invalid persisted delegation nonce", ErrForbidden)
		}
		if _, exists := storedDelegationNonces[nonce]; exists {
			return nil, ErrReplay
		}
		storedDelegationNonces[nonce] = struct{}{}
	}
	for _, record := range envelope.Payload.Delegations {
		if err = s.restoreDelegation(record); err != nil {
			return nil, err
		}
	}
	if len(storedDelegationNonces) != len(s.delegationNonces) {
		return nil, fmt.Errorf("%w: persisted delegation nonce registry does not match history", ErrForbidden)
	}
	for nonce := range s.delegationNonces {
		if _, exists := storedDelegationNonces[nonce]; !exists {
			return nil, fmt.Errorf("%w: delegation nonce missing from persisted registry", ErrForbidden)
		}
	}
	for i := range envelope.Payload.Emergencies {
		a := envelope.Payload.Emergencies[i]
		if err = s.validateRestoredEmergency(&a); err != nil {
			return nil, err
		}
		if _, ok := s.emergencies[a.ID]; ok {
			return nil, ErrConflict
		}
		if _, ok := s.emergencyNonces[a.Input.Nonce]; ok {
			return nil, ErrReplay
		}
		s.emergencies[a.ID] = &a
		s.emergencyNonces[a.Input.Nonce] = struct{}{}
	}
	for i := range envelope.Payload.Roles {
		a := envelope.Payload.Roles[i]
		if err = validateRestoredRole(&a); err != nil {
			return nil, err
		}
		if _, ok := s.roles[a.ID]; ok {
			return nil, ErrConflict
		}
		s.roles[a.ID] = &a
	}
	for _, p := range s.proposals {
		if p.Electorate != nil {
			if !s.hasRoleAt(p.Electorate.SubmittedBy, RoleTechnicalCouncil, p.Input.Scope, p.Electorate.SubmittedAt) {
				return nil, fmt.Errorf("%w: electorate submitter role invalid", ErrForbidden)
			}
			for actor, approval := range p.Electorate.Approvals {
				if !s.hasRoleAt(actor, RoleTechnicalCouncil, p.Input.Scope, approval.ApprovedAt) {
					return nil, fmt.Errorf("%w: electorate approver role invalid", ErrForbidden)
				}
			}
		}
	}
	for i := range envelope.Payload.Appeals {
		a := envelope.Payload.Appeals[i]
		if err = validateRestoredAppeal(&a); err != nil {
			return nil, err
		}
		if _, ok := s.appeals[a.ID]; ok {
			return nil, ErrConflict
		}
		if _, ok := s.appealNonces[a.Input.Nonce]; ok {
			return nil, ErrReplay
		}
		if _, ok := s.proposals[a.Input.ProposalID]; !ok {
			return nil, fmt.Errorf("%w: appeal proposal missing", ErrForbidden)
		}
		if a.Resolution != nil {
			p, ok := s.proposals[a.Resolution.ResolutionProposalID]
			if !ok || p.Status != StatusVerified || a.Resolution.ResolutionProposalID == a.Input.ProposalID {
				return nil, fmt.Errorf("%w: appeal resolution proposal invalid", ErrForbidden)
			}
		}
		s.appeals[a.ID] = &a
		s.appealNonces[a.Input.Nonce] = struct{}{}
	}
	for i := range envelope.Payload.Discussions {
		entry := envelope.Payload.Discussions[i]
		if err = validateRestoredDiscussion(&entry); err != nil {
			return nil, err
		}
		if _, ok := s.discussions[entry.ID]; ok {
			return nil, ErrConflict
		}
		if _, ok := s.discussionNonces[entry.Input.Nonce]; ok {
			return nil, ErrReplay
		}
		if _, ok := s.proposals[entry.Input.ProposalID]; !ok {
			return nil, fmt.Errorf("%w: discussion proposal missing", ErrForbidden)
		}
		s.discussions[entry.ID] = &entry
		s.discussionNonces[entry.Input.Nonce] = struct{}{}
	}
	for _, entry := range s.discussions {
		if entry.Input.ReplyTo != "" {
			parent, ok := s.discussions[entry.Input.ReplyTo]
			if !ok || parent.Input.ProposalID != entry.Input.ProposalID {
				return nil, fmt.Errorf("%w: discussion reply missing", ErrForbidden)
			}
		}
	}
	return s, nil
}

func validateRestoredProposal(p *Proposal, policy Policy) error {
	fingerprint := proposalFingerprint(p.Input)
	expectedActionHash := hash("action", fingerprint, strings.ToLower(p.Input.SourceCommit), p.Input.Release, strings.ToLower(p.Input.UpgradeHash))
	if p.ID != hash("proposal", p.Input.Nonce, p.Input.Proposer, fingerprint) || p.ActionHash != expectedActionHash || p.Conflicts == nil || p.Votes == nil || p.VoteHistory == nil || p.VotingPower == nil || p.BasePower == nil || p.Delegations == nil || p.DelegatedPower == nil || p.DelegationOverrides == nil || p.CreatedAt.IsZero() || p.UpdatedAt.Before(p.CreatedAt) {
		return fmt.Errorf("%w: invalid restored proposal", ErrForbidden)
	}
	if err := validateProposal(p.Input, p.CreatedAt, policy.MaxLifetime, policy.ParameterRules); err != nil {
		return fmt.Errorf("%w: restored proposal input no longer satisfies canonical policy: %v", ErrForbidden, err)
	}
	if err := validateProposalTransitions(p); err != nil {
		return err
	}
	if p.Electorate != nil {
		if !validHash(p.Electorate.EvidenceHash) || p.Electorate.SourceVersion == "" || p.Electorate.SnapshotAsOf.IsZero() || p.Electorate.SubmittedAt.IsZero() || p.Electorate.Approvals == nil || p.Electorate.AuditHash != electorateAudit(p.Electorate) {
			return fmt.Errorf("%w: invalid electorate audit", ErrForbidden)
		}
		if _, _, err := effectiveVotingPower(p.Electorate.Snapshot); err != nil {
			return err
		}
		for actor, approval := range p.Electorate.Approvals {
			if actor != approval.Approver || approval.AuditHash != hash(p.ID, approval.Approver, approval.ApprovedAt.Format(time.RFC3339Nano), p.Electorate.EvidenceHash) {
				return fmt.Errorf("%w: invalid electorate approval", ErrForbidden)
			}
		}
		if p.Electorate.Status == "approved" && uint64(len(p.Electorate.Approvals)) < policy.ElectorateApprovalThreshold {
			return fmt.Errorf("%w: electorate threshold not met", ErrForbidden)
		}
	}
	if proposalReached(p, StatusSimulationCompleted) {
		if p.Simulation == nil || p.Simulation.CompletedAt.IsZero() || len(p.Simulation.TechnicalEvidence) < 16 || len(p.Simulation.EconomicEvidence) < 16 || len(p.Simulation.SecurityEvidence) < 16 || len(p.Simulation.UserImpactEvidence) < 16 {
			return fmt.Errorf("%w: simulation history lacks complete evidence", ErrForbidden)
		}
	} else if p.Simulation != nil {
		return fmt.Errorf("%w: simulation exists before simulation-completed state", ErrForbidden)
	}
	if proposalReached(p, StatusVotingActive) {
		if p.Electorate == nil || p.Electorate.Status != "approved" || p.VotingEndsAt.IsZero() {
			return fmt.Errorf("%w: voting opened without an approved electorate", ErrForbidden)
		}
		computed, total, err := effectiveVotingPower(VotingSnapshot{BasePower: p.BasePower, Delegations: p.Delegations, DelegatedPower: p.DelegatedPower, DelegationOverrides: p.DelegationOverrides})
		if err != nil || total != p.EligiblePower || !samePowers(computed, p.VotingPower) {
			return fmt.Errorf("%w: invalid electorate snapshot", ErrForbidden)
		}
	} else if len(p.Votes) != 0 || p.EligiblePower != 0 || len(p.VotingPower) != 0 || len(p.BasePower) != 0 || len(p.Delegations) != 0 || len(p.DelegatedPower) != 0 || len(p.DelegationOverrides) != 0 || !p.VotingEndsAt.IsZero() {
		return fmt.Errorf("%w: voting state exists before voting-active transition", ErrForbidden)
	}
	if _, err := validateProposalVoteHistory(p, policy); err != nil {
		return err
	}
	if proposalReached(p, StatusCancelled) {
		if p.Cancellation == nil || p.Cancellation.Actor != p.Input.Proposer || p.Cancellation.AuditHash != hash(p.ID, p.Cancellation.Actor, p.Cancellation.Reason, p.Cancellation.CancelledAt.Format(time.RFC3339Nano), strings.Join(p.Cancellation.Evidence, "|")) {
			return fmt.Errorf("%w: invalid cancellation audit", ErrForbidden)
		}
	} else if p.Cancellation != nil {
		return fmt.Errorf("%w: cancellation exists without cancelled transition", ErrForbidden)
	}
	if proposalReached(p, StatusTimelockActive) && p.ExecuteAfter.IsZero() {
		return fmt.Errorf("%w: active timelock has no earliest execution", ErrForbidden)
	}
	if proposalReached(p, StatusExecutionSubmitted) && (!validHash(p.ExecutionHash) || p.ExecutionReceipt == nil && (proposalReached(p, StatusExecuted) || proposalReached(p, StatusExecutionFailed))) {
		return fmt.Errorf("%w: submitted execution lacks bound manifest or receipt", ErrForbidden)
	}
	if proposalReached(p, StatusExecuted) {
		if p.ExecutionReceipt == nil || validateExecutionReceipt(*p.ExecutionReceipt, p.ExecutionHash) != nil || p.ExecutionReceipt.Outcome != "verified" {
			return fmt.Errorf("%w: invalid executed receipt", ErrForbidden)
		}
	}
	if proposalReached(p, StatusExecutionFailed) {
		if p.ExecutionReceipt == nil || validateExecutionReceipt(*p.ExecutionReceipt, p.ExecutionHash) != nil || p.ExecutionReceipt.Outcome != "failed" {
			return fmt.Errorf("%w: invalid failed execution receipt", ErrForbidden)
		}
	}
	if proposalReached(p, StatusRolledBack) {
		if p.RollbackReceipt == nil || validateExecutionReceipt(*p.RollbackReceipt, p.RollbackHash) != nil || p.RollbackReceipt.Outcome != "verified_rollback" || strings.EqualFold(p.RollbackHash, p.ExecutionHash) {
			return fmt.Errorf("%w: invalid rollback receipt", ErrForbidden)
		}
	}
	return nil
}

func samePowers(a, b map[string]uint64) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func (s *Service) validateRestoredEmergency(a *EmergencyAction) error {
	if a.ID != hash("emergency", a.Input.Nonce, string(a.Input.Scope), a.Input.Target) || a.Approvals == nil || a.CreatedAt.IsZero() || a.UpdatedAt.Before(a.CreatedAt) {
		return fmt.Errorf("%w: invalid restored emergency", ErrForbidden)
	}
	valid := map[string]bool{"pending_approval": true, "active": true, "expired": true, "closed": true}
	if !valid[a.Status] {
		return fmt.Errorf("%w: unknown emergency status", ErrForbidden)
	}
	if a.Input.Duration <= 0 || a.Input.Duration > s.policy.EmergencyMaxDuration {
		return fmt.Errorf("%w: unsafe restored emergency duration", ErrForbidden)
	}
	for signer, approval := range a.Approvals {
		if approval.Role != "emergency_council" {
			return fmt.Errorf("%w: legacy emergency approval role %q requires an explicit migration", ErrForbidden, approval.Role)
		}
		if signer != approval.Signer || approval.AuditHash != hash(a.ID, approval.Signer, approval.Role) {
			return fmt.Errorf("%w: invalid emergency approval audit", ErrForbidden)
		}
	}
	return nil
}

func validateRestoredRole(a *RoleAssignment) error {
	if !validGovernanceRole(a.Input.Role) {
		return fmt.Errorf("%w: legacy or unknown role %q requires an explicit role migration", ErrForbidden, a.Input.Role)
	}
	if a.ID == "" || a.AuditHash != roleAudit(a) || a.CreatedAt.IsZero() || (a.Status != "active" && a.Status != "removed") || (a.Status == "removed" && (a.RemovalProposalID == "" || a.RemovedAt.IsZero())) {
		return fmt.Errorf("%w: invalid restored role", ErrForbidden)
	}
	reference := a.ProposalID
	if strings.HasPrefix(reference, "genesis:") {
		reference = strings.TrimPrefix(reference, "genesis:")
		if !validHash(reference) {
			return fmt.Errorf("%w: invalid genesis role reference", ErrForbidden)
		}
	}
	expected := hash("role", a.Input.Account, string(a.Input.Role), reference, a.Input.TermStartsAt.UTC().Format(time.RFC3339Nano), a.Input.TermEndsAt.UTC().Format(time.RFC3339Nano))
	if a.ID != expected {
		return fmt.Errorf("%w: role identity mismatch", ErrForbidden)
	}
	return nil
}
