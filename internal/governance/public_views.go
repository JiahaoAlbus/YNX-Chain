package governance

import (
	"sort"
	"time"
)

type PublicVoteRecord struct {
	ProposalID          string    `json:"proposalId"`
	Scope               Scope     `json:"scope"`
	ChainID             string    `json:"chainId"`
	Domain              string    `json:"domain"`
	Voter               string    `json:"voter"`
	Choice              string    `json:"choice,omitempty"`
	Power               uint64    `json:"power"`
	Operation           string    `json:"operation"`
	Revision            uint64    `json:"revision"`
	Nonce               string    `json:"nonce"`
	PublicKey           string    `json:"publicKey"`
	Signature           string    `json:"signature"`
	SignedAt            time.Time `json:"signedAt"`
	ExpiresAt           time.Time `json:"expiresAt"`
	CastAt              time.Time `json:"castAt"`
	SupersedesAuditHash string    `json:"supersedesAuditHash,omitempty"`
	AuditHash           string    `json:"auditHash"`
	ElectorateEvidence  string    `json:"electorateEvidence"`
	ElectorateVersion   string    `json:"electorateVersion"`
	ElectorateSnapshot  time.Time `json:"electorateSnapshotAt"`
	CurrentRevision     bool      `json:"currentRevision"`
}

type PublicDelegationRecord struct {
	ProposalID    string    `json:"proposalId"`
	Scope         Scope     `json:"scope"`
	Delegator     string    `json:"delegator"`
	Delegate      string    `json:"delegate"`
	Amount        uint64    `json:"amount"`
	SnapshotAt    time.Time `json:"snapshotAt"`
	VotingEndsAt  time.Time `json:"votingEndsAt"`
	SourceVersion string    `json:"sourceVersion"`
	EvidenceHash  string    `json:"evidenceHash"`
	Status        string    `json:"status"`
}

type PublicTimelockRecord struct {
	TimelockID         string    `json:"timelockId"`
	ProposalID         string    `json:"proposalId"`
	ActionHash         string    `json:"actionHash"`
	Status             Status    `json:"status"`
	EarliestExecution  time.Time `json:"earliestExecution"`
	LatestExecution    time.Time `json:"latestExecution"`
	GracePeriod        string    `json:"gracePeriod"`
	ExecutionAuthority string    `json:"executionAuthority"`
	PublicNotice       string    `json:"publicNotice"`
}

type PublicExecutionRecord struct {
	ProposalID       string            `json:"proposalId"`
	ActionHash       string            `json:"actionHash"`
	ManifestHash     string            `json:"manifestHash"`
	Status           Status            `json:"status"`
	SubmittedAt      *time.Time        `json:"submittedAt,omitempty"`
	ExecutionReceipt *ExecutionReceipt `json:"executionReceipt,omitempty"`
	RollbackReceipt  *ExecutionReceipt `json:"rollbackReceipt,omitempty"`
}

type PublicUpgradeRecord struct {
	ProposalID       string   `json:"proposalId"`
	ProposalType     string   `json:"proposalType"`
	Scope            Scope    `json:"scope"`
	Status           Status   `json:"status"`
	ActionHash       string   `json:"actionHash"`
	SourceCommit     string   `json:"sourceCommit"`
	Release          string   `json:"release"`
	UpgradeHash      string   `json:"upgradeHash"`
	Migration        string   `json:"migration"`
	Rollback         string   `json:"rollback"`
	CanaryPlan       string   `json:"canaryPlan"`
	VerificationPlan string   `json:"verificationPlan"`
	Evidence         []string `json:"evidence"`
}

type PublicConflictRecord struct {
	ProposalID  string    `json:"proposalId"`
	Scope       Scope     `json:"scope"`
	Actor       string    `json:"actor"`
	Description string    `json:"description"`
	Recused     bool      `json:"recused"`
	DisclosedAt time.Time `json:"disclosedAt"`
}

type PublicAuditRecord struct {
	AuditID    string    `json:"auditId"`
	RecordType string    `json:"recordType"`
	ProposalID string    `json:"proposalId,omitempty"`
	Actor      string    `json:"actor"`
	Action     string    `json:"action"`
	Evidence   []string  `json:"evidence"`
	At         time.Time `json:"at"`
}

func (s *Service) PublicVotes() []PublicVoteRecord {
	proposals := s.ListProposals()
	out := []PublicVoteRecord{}
	for _, proposal := range proposals {
		for voter, history := range proposal.VoteHistory {
			current := proposal.Votes[voter]
			for _, vote := range history {
				out = append(out, publicVoteRecordFrom(proposal, vote, vote.AuditHash == current.AuditHash))
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CastAt.Equal(out[j].CastAt) {
			if out[i].ProposalID == out[j].ProposalID {
				if out[i].Voter == out[j].Voter {
					return out[i].Revision < out[j].Revision
				}
				return out[i].Voter < out[j].Voter
			}
			return out[i].ProposalID < out[j].ProposalID
		}
		return out[i].CastAt.Before(out[j].CastAt)
	})
	return out
}

func (s *Service) PublicDelegations() []PublicDelegationRecord {
	proposals := s.ListProposals()
	out := []PublicDelegationRecord{}
	for _, proposal := range proposals {
		if proposal.Electorate == nil {
			continue
		}
		for delegator, delegate := range proposal.Electorate.Snapshot.Delegations {
			out = append(out, PublicDelegationRecord{
				ProposalID: proposal.ID, Scope: proposal.Input.Scope, Delegator: delegator,
				Delegate: delegate, Amount: proposal.Electorate.Snapshot.BasePower[delegator],
				SnapshotAt: proposal.Electorate.SnapshotAsOf, VotingEndsAt: proposal.VotingEndsAt,
				SourceVersion: proposal.Electorate.SourceVersion, EvidenceHash: proposal.Electorate.EvidenceHash,
				Status: "proposal_snapshot_bound",
			})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ProposalID == out[j].ProposalID {
			return out[i].Delegator < out[j].Delegator
		}
		return out[i].ProposalID < out[j].ProposalID
	})
	return out
}

func (s *Service) PublicTimelocks() []PublicTimelockRecord {
	proposals := s.ListProposals()
	out := []PublicTimelockRecord{}
	for _, proposal := range proposals {
		if !proposalReached(&proposal, StatusTimelockPending) {
			continue
		}
		grace := time.Duration(0)
		if !proposal.ExecuteAfter.IsZero() && proposal.Input.ExpiresAt.After(proposal.ExecuteAfter) {
			grace = proposal.Input.ExpiresAt.Sub(proposal.ExecuteAfter)
		}
		out = append(out, PublicTimelockRecord{
			TimelockID: hash("timelock", proposal.ID, proposal.ActionHash), ProposalID: proposal.ID,
			ActionHash: proposal.ActionHash, Status: proposal.Status, EarliestExecution: proposal.ExecuteAfter,
			LatestExecution: proposal.Input.ExpiresAt, GracePeriod: grace.String(),
			ExecutionAuthority: string(RoleExecutionOperator),
			PublicNotice:       "Approved action remains unapplied until the exact action hash reaches execution-ready status.",
		})
	}
	return out
}

func (s *Service) PublicExecutions() []PublicExecutionRecord {
	proposals := s.ListProposals()
	out := []PublicExecutionRecord{}
	for _, proposal := range proposals {
		if !proposalReached(&proposal, StatusExecutionSubmitted) {
			continue
		}
		var submittedAt *time.Time
		for _, transition := range proposal.Transitions {
			if transition.To == StatusExecutionSubmitted {
				value := transition.At
				submittedAt = &value
				break
			}
		}
		out = append(out, PublicExecutionRecord{ProposalID: proposal.ID, ActionHash: proposal.ActionHash, ManifestHash: proposal.ExecutionHash, Status: proposal.Status, SubmittedAt: submittedAt, ExecutionReceipt: proposal.ExecutionReceipt, RollbackReceipt: proposal.RollbackReceipt})
	}
	return out
}

func (s *Service) PublicUpgrades() []PublicUpgradeRecord {
	proposals := s.ListProposals()
	out := []PublicUpgradeRecord{}
	for _, proposal := range proposals {
		if proposal.Input.Scope != ScopeProtocolUpgrade && proposal.Input.Scope != ScopeConsensusUpgrade {
			continue
		}
		out = append(out, PublicUpgradeRecord{ProposalID: proposal.ID, ProposalType: proposal.Input.ProposalType, Scope: proposal.Input.Scope, Status: proposal.Status, ActionHash: proposal.ActionHash, SourceCommit: proposal.Input.SourceCommit, Release: proposal.Input.Release, UpgradeHash: proposal.Input.UpgradeHash, Migration: proposal.Input.Migration, Rollback: proposal.Input.Rollback, CanaryPlan: proposal.Input.CanaryPlan, VerificationPlan: proposal.Input.VerificationPlan, Evidence: append([]string(nil), proposal.Input.Evidence...)})
	}
	return out
}

func (s *Service) PublicConflicts() []PublicConflictRecord {
	proposals := s.ListProposals()
	out := []PublicConflictRecord{}
	for _, proposal := range proposals {
		for _, conflict := range proposal.Conflicts {
			out = append(out, PublicConflictRecord{ProposalID: proposal.ID, Scope: proposal.Input.Scope, Actor: conflict.Actor, Description: conflict.Description, Recused: conflict.Recused, DisclosedAt: conflict.DisclosedAt})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DisclosedAt.Before(out[j].DisclosedAt) })
	return out
}

func (s *Service) PublicAudit() []PublicAuditRecord {
	proposals := s.ListProposals()
	out := []PublicAuditRecord{}
	for _, proposal := range proposals {
		for _, transition := range proposal.Transitions {
			out = append(out, PublicAuditRecord{AuditID: transition.AuditHash, RecordType: "proposal_transition", ProposalID: proposal.ID, Actor: transition.Actor, Action: string(transition.To), Evidence: append([]string(nil), transition.Evidence...), At: transition.At})
		}
		for _, history := range proposal.VoteHistory {
			for _, vote := range history {
				action := vote.Operation
				if vote.Choice != "" {
					action += ":" + vote.Choice
				}
				out = append(out, PublicAuditRecord{AuditID: vote.AuditHash, RecordType: "signed_vote_revision", ProposalID: proposal.ID, Actor: vote.Voter, Action: action, Evidence: []string{"electorate://" + vote.ElectorateEvidenceHash, "signature://ed25519/" + vote.Signature, "nonce://" + vote.Nonce}, At: vote.CastAt})
			}
		}
		for _, conflict := range proposal.Conflicts {
			out = append(out, PublicAuditRecord{AuditID: hash(proposal.ID, conflict.Actor, conflict.Description, conflict.DisclosedAt.UTC().Format(time.RFC3339Nano)), RecordType: "conflict_disclosure", ProposalID: proposal.ID, Actor: conflict.Actor, Action: "disclosed", Evidence: []string{conflict.Description}, At: conflict.DisclosedAt})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].At.Equal(out[j].At) {
			return out[i].AuditID < out[j].AuditID
		}
		return out[i].At.Before(out[j].At)
	})
	return out
}

func (s *Service) ProposalsByScope(scopes ...Scope) []Proposal {
	allowed := map[Scope]bool{}
	for _, scope := range scopes {
		allowed[scope] = true
	}
	out := []Proposal{}
	for _, proposal := range s.ListProposals() {
		if allowed[proposal.Input.Scope] {
			out = append(out, proposal)
		}
	}
	return out
}
