package governance

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	SignedVoteVersion     = "ynx-governance-vote/v1"
	VoteOperationCast     = "cast"
	VoteOperationReplace  = "replace"
	VoteOperationWithdraw = "withdraw"
)

type SignedVoteEnvelope struct {
	Version                string    `json:"version"`
	Domain                 string    `json:"domain"`
	ChainID                string    `json:"chainId"`
	ProposalID             string    `json:"proposalId"`
	Voter                  string    `json:"voter"`
	Choice                 string    `json:"choice,omitempty"`
	Operation              string    `json:"operation"`
	Revision               uint64    `json:"revision"`
	Nonce                  string    `json:"nonce"`
	PublicKey              string    `json:"publicKey"`
	ElectorateEvidenceHash string    `json:"electorateEvidenceHash"`
	SignedAt               time.Time `json:"signedAt"`
	ExpiresAt              time.Time `json:"expiresAt"`
	SupersedesAuditHash    string    `json:"supersedesAuditHash,omitempty"`
	Signature              string    `json:"signature"`
}

type voteSigningRecord struct {
	Version                string `json:"version"`
	Domain                 string `json:"domain"`
	ChainID                string `json:"chainId"`
	ProposalID             string `json:"proposalId"`
	Voter                  string `json:"voter"`
	Choice                 string `json:"choice,omitempty"`
	Operation              string `json:"operation"`
	Revision               uint64 `json:"revision"`
	Nonce                  string `json:"nonce"`
	PublicKey              string `json:"publicKey"`
	ElectorateEvidenceHash string `json:"electorateEvidenceHash"`
	SignedAt               string `json:"signedAt"`
	ExpiresAt              string `json:"expiresAt"`
	SupersedesAuditHash    string `json:"supersedesAuditHash,omitempty"`
}

func GovernanceVoterID(publicKeyText string) (string, error) {
	publicKey, err := nativewallet.DecodePublicKey(strings.TrimSpace(publicKeyText), ed25519.PublicKeySize)
	if err != nil {
		return "", fmt.Errorf("%w: invalid voter public key", ErrInvalid)
	}
	digest := sha256.Sum256(publicKey)
	return "ynxvote1" + hex.EncodeToString(digest[:20]), nil
}

func VoteSigningPayload(envelope SignedVoteEnvelope) ([]byte, error) {
	if envelope.Version != SignedVoteVersion {
		return nil, fmt.Errorf("%w: unsupported vote envelope version", ErrInvalid)
	}
	record := voteSigningRecord{
		Version:                envelope.Version,
		Domain:                 strings.TrimSpace(envelope.Domain),
		ChainID:                strings.TrimSpace(envelope.ChainID),
		ProposalID:             strings.TrimSpace(envelope.ProposalID),
		Voter:                  strings.TrimSpace(envelope.Voter),
		Choice:                 strings.ToLower(strings.TrimSpace(envelope.Choice)),
		Operation:              strings.ToLower(strings.TrimSpace(envelope.Operation)),
		Revision:               envelope.Revision,
		Nonce:                  strings.TrimSpace(envelope.Nonce),
		PublicKey:              strings.TrimSpace(envelope.PublicKey),
		ElectorateEvidenceHash: strings.ToLower(strings.TrimSpace(envelope.ElectorateEvidenceHash)),
		SignedAt:               envelope.SignedAt.UTC().Format(time.RFC3339Nano),
		ExpiresAt:              envelope.ExpiresAt.UTC().Format(time.RFC3339Nano),
		SupersedesAuditHash:    strings.ToLower(strings.TrimSpace(envelope.SupersedesAuditHash)),
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX-GOVERNANCE-VOTE\x00"), encoded...), nil
}

func SignVoteEnvelope(envelope SignedVoteEnvelope, privateKey ed25519.PrivateKey) (SignedVoteEnvelope, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return SignedVoteEnvelope{}, fmt.Errorf("%w: invalid vote signing key", ErrInvalid)
	}
	payload, err := VoteSigningPayload(envelope)
	if err != nil {
		return SignedVoteEnvelope{}, err
	}
	envelope.Signature = nativewallet.Sign(privateKey, payload)
	return envelope, nil
}

func (s *Service) CastSignedVote(envelope SignedVoteEnvelope, now time.Time) (Proposal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	proposal, err := s.mutable(strings.TrimSpace(envelope.ProposalID), now)
	if err != nil {
		return Proposal{}, err
	}
	if proposal.Status != StatusVotingActive || !now.Before(proposal.VotingEndsAt) || proposal.Electorate == nil || proposal.Electorate.Status != "approved" {
		return Proposal{}, ErrNotReady
	}
	if err = validateVoteEnvelope(envelope, proposal, s.policy, now); err != nil {
		return Proposal{}, err
	}
	nonceID := voteNonceID(envelope)
	if _, exists := s.voteNonces[nonceID]; exists {
		return Proposal{}, ErrReplay
	}
	power := eligibleVotePower(proposal, envelope.Voter)
	if power == 0 {
		return Proposal{}, fmt.Errorf("%w: voter is not eligible in the bound snapshot", ErrForbidden)
	}
	if conflict, exists := proposal.Conflicts[envelope.Voter]; exists && conflict.Recused {
		return Proposal{}, ErrForbidden
	}
	current, hasCurrent := proposal.Votes[envelope.Voter]
	switch envelope.Operation {
	case VoteOperationCast:
		if hasCurrent || envelope.Revision != 1 || envelope.SupersedesAuditHash != "" {
			return Proposal{}, ErrReplay
		}
	case VoteOperationReplace:
		if s.policy.VoteReplacementPolicy != "replace_before_deadline" || !hasCurrent || current.Operation == VoteOperationWithdraw || envelope.Revision != current.Revision+1 || !strings.EqualFold(envelope.SupersedesAuditHash, current.AuditHash) || envelope.Choice == current.Choice {
			return Proposal{}, fmt.Errorf("%w: invalid vote replacement", ErrForbidden)
		}
	case VoteOperationWithdraw:
		if s.policy.VoteWithdrawalPolicy != "withdraw_before_deadline" || !hasCurrent || current.Operation == VoteOperationWithdraw || envelope.Revision != current.Revision+1 || !strings.EqualFold(envelope.SupersedesAuditHash, current.AuditHash) {
			return Proposal{}, fmt.Errorf("%w: invalid vote withdrawal", ErrForbidden)
		}
	default:
		return Proposal{}, ErrInvalid
	}
	vote := Vote{
		ProposalID:             proposal.ID,
		ChainID:                envelope.ChainID,
		Domain:                 envelope.Domain,
		Voter:                  envelope.Voter,
		Choice:                 strings.ToLower(strings.TrimSpace(envelope.Choice)),
		Power:                  power,
		Operation:              envelope.Operation,
		Revision:               envelope.Revision,
		Nonce:                  envelope.Nonce,
		PublicKey:              envelope.PublicKey,
		Signature:              envelope.Signature,
		ElectorateEvidenceHash: envelope.ElectorateEvidenceHash,
		SignedAt:               envelope.SignedAt.UTC(),
		ExpiresAt:              envelope.ExpiresAt.UTC(),
		CastAt:                 now,
		SupersedesAuditHash:    strings.ToLower(envelope.SupersedesAuditHash),
	}
	vote.AuditHash = voteAudit(vote)
	proposal.Votes[vote.Voter] = vote
	proposal.VoteHistory[vote.Voter] = append(proposal.VoteHistory[vote.Voter], vote)
	proposal.UpdatedAt = now
	s.voteNonces[nonceID] = struct{}{}
	return clone(proposal), nil
}

func validateVoteEnvelope(envelope SignedVoteEnvelope, proposal *Proposal, policy Policy, now time.Time) error {
	if envelope.Version != SignedVoteVersion || envelope.Domain != policy.VoteDomain || envelope.ChainID != policy.ChainID || envelope.ProposalID != proposal.ID || len(strings.TrimSpace(envelope.Nonce)) < 16 || envelope.Revision == 0 || envelope.SignedAt.IsZero() || envelope.ExpiresAt.IsZero() || envelope.PublicKey != strings.TrimSpace(envelope.PublicKey) || envelope.Voter != strings.TrimSpace(envelope.Voter) || envelope.Operation != strings.ToLower(strings.TrimSpace(envelope.Operation)) || envelope.Choice != strings.ToLower(strings.TrimSpace(envelope.Choice)) || !validHash(strings.ToLower(envelope.ElectorateEvidenceHash)) || !strings.EqualFold(envelope.ElectorateEvidenceHash, proposal.Electorate.EvidenceHash) {
		return ErrInvalid
	}
	if envelope.Operation == VoteOperationWithdraw {
		if envelope.Choice != "" {
			return ErrInvalid
		}
	} else if envelope.Choice != "yes" && envelope.Choice != "no" && envelope.Choice != "abstain" && envelope.Choice != "veto" {
		return ErrInvalid
	}
	voterID, err := GovernanceVoterID(envelope.PublicKey)
	if err != nil || voterID != envelope.Voter {
		return fmt.Errorf("%w: voter does not match signing key", ErrForbidden)
	}
	if envelope.SignedAt.After(now.Add(policy.VoteMaxClockSkew)) || !envelope.ExpiresAt.After(now) || !envelope.ExpiresAt.After(envelope.SignedAt) || envelope.ExpiresAt.After(proposal.VotingEndsAt) {
		return fmt.Errorf("%w: vote timestamp or expiry outside voting window", ErrForbidden)
	}
	var votingOpenedAt time.Time
	for _, transition := range proposal.Transitions {
		if transition.To == StatusVotingActive {
			votingOpenedAt = transition.At
		}
	}
	if votingOpenedAt.IsZero() || envelope.SignedAt.Before(votingOpenedAt.Add(-policy.VoteMaxClockSkew)) {
		return fmt.Errorf("%w: vote predates the bound voting window", ErrForbidden)
	}
	payload, err := VoteSigningPayload(envelope)
	if err != nil || !nativewallet.Verify(envelope.PublicKey, payload, envelope.Signature) {
		return fmt.Errorf("%w: invalid vote signature", ErrForbidden)
	}
	return nil
}

func voteNonceID(envelope SignedVoteEnvelope) string {
	return hash("vote-nonce", envelope.ChainID, envelope.Domain, envelope.ProposalID, envelope.Voter, envelope.Nonce)
}

func voteAudit(vote Vote) string {
	return hash(
		vote.ProposalID,
		vote.ChainID,
		vote.Domain,
		vote.Voter,
		vote.Choice,
		fmt.Sprint(vote.Power),
		vote.Operation,
		fmt.Sprint(vote.Revision),
		vote.Nonce,
		vote.PublicKey,
		vote.Signature,
		vote.ElectorateEvidenceHash,
		vote.SignedAt.UTC().Format(time.RFC3339Nano),
		vote.ExpiresAt.UTC().Format(time.RFC3339Nano),
		vote.CastAt.UTC().Format(time.RFC3339Nano),
		vote.SupersedesAuditHash,
	)
}

func validateStoredVote(vote Vote, proposal *Proposal, policy Policy) error {
	if proposal == nil || vote.ProposalID != proposal.ID || vote.Power != eligibleVotePower(proposal, vote.Voter) || vote.AuditHash != voteAudit(vote) || vote.CastAt.IsZero() {
		return fmt.Errorf("%w: invalid stored vote audit", ErrForbidden)
	}
	envelope := SignedVoteEnvelope{
		Version:                SignedVoteVersion,
		Domain:                 vote.Domain,
		ChainID:                vote.ChainID,
		ProposalID:             vote.ProposalID,
		Voter:                  vote.Voter,
		Choice:                 vote.Choice,
		Operation:              vote.Operation,
		Revision:               vote.Revision,
		Nonce:                  vote.Nonce,
		PublicKey:              vote.PublicKey,
		ElectorateEvidenceHash: vote.ElectorateEvidenceHash,
		SignedAt:               vote.SignedAt,
		ExpiresAt:              vote.ExpiresAt,
		SupersedesAuditHash:    vote.SupersedesAuditHash,
		Signature:              vote.Signature,
	}
	if err := validateVoteEnvelope(envelope, proposal, policy, vote.CastAt); err != nil {
		return fmt.Errorf("%w: invalid stored signed vote: %v", ErrForbidden, err)
	}
	return nil
}

func eligibleVotePower(proposal *Proposal, voter string) uint64 {
	power := proposal.VotingPower[voter]
	if proposal.DelegationOverrides[voter] && proposal.Delegations[voter] != "" {
		amount := proposal.DelegatedPower[voter]
		if amount == 0 {
			amount = proposal.BasePower[voter]
		}
		if power <= ^uint64(0)-amount {
			power += amount
		}
	}
	return power
}

func validateProposalVoteHistory(proposal *Proposal, policy Policy) (map[string]struct{}, error) {
	if proposal == nil || proposal.VoteHistory == nil {
		return nil, fmt.Errorf("%w: signed vote history missing; explicit migration required", ErrForbidden)
	}
	nonces := map[string]struct{}{}
	if len(proposal.Votes) != len(proposal.VoteHistory) {
		return nil, fmt.Errorf("%w: current vote set does not match signed history", ErrForbidden)
	}
	for voter, history := range proposal.VoteHistory {
		if len(history) == 0 {
			return nil, fmt.Errorf("%w: empty signed vote history", ErrForbidden)
		}
		var previous Vote
		for index, vote := range history {
			if vote.Voter != voter {
				return nil, fmt.Errorf("%w: signed vote history voter mismatch", ErrForbidden)
			}
			if err := validateStoredVote(vote, proposal, policy); err != nil {
				return nil, err
			}
			if index == 0 {
				if vote.Operation != VoteOperationCast || vote.Revision != 1 || vote.SupersedesAuditHash != "" {
					return nil, fmt.Errorf("%w: invalid initial vote revision", ErrForbidden)
				}
			} else {
				if previous.Operation == VoteOperationWithdraw || (vote.Operation != VoteOperationReplace && vote.Operation != VoteOperationWithdraw) || vote.Revision != previous.Revision+1 || !strings.EqualFold(vote.SupersedesAuditHash, previous.AuditHash) {
					return nil, fmt.Errorf("%w: invalid vote revision chain", ErrForbidden)
				}
			}
			nonceID := voteNonceID(SignedVoteEnvelope{ChainID: vote.ChainID, Domain: vote.Domain, ProposalID: vote.ProposalID, Voter: vote.Voter, Nonce: vote.Nonce})
			if _, exists := nonces[nonceID]; exists {
				return nil, ErrReplay
			}
			nonces[nonceID] = struct{}{}
			previous = vote
		}
		current, ok := proposal.Votes[voter]
		if !ok || current != history[len(history)-1] {
			return nil, fmt.Errorf("%w: current vote is not the final signed revision", ErrForbidden)
		}
	}
	return nonces, nil
}
