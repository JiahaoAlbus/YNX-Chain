package ynxconsensusauth

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"time"

	cmttypes "github.com/cometbft/cometbft/types"
)

// EvidenceState is a view obtained from the authenticated block/state stores at
// Height, never from the evidence submitter. Validators MUST be the set that
// voted at this height, not the current set or the next height's set. A Comet
// ValidatorSet has no intrinsic height, so the adapter cannot prove this binding
// from that object alone. ChainID/Height/BlockTime name the same historical block.
type EvidenceState struct {
	ChainID    string
	Height     int64
	BlockTime  time.Time
	Validators *cmttypes.ValidatorSet
}

// EvidenceStateSource must read the validator set and block time from the same
// trusted historical height. It must retain old sets after rotation/removal and
// return an error on unavailable or inconsistent history; current state is not
// a fallback. Returned objects and the registry must remain immutable (or locked)
// throughout verification. This interface is not a peer-supplied proof format.
type EvidenceStateSource interface {
	ConsensusEvidenceStateAt(chainID string, height int64) (EvidenceState, error)
}

// VerifyDuplicateVoteEvidence checks actual Comet duplicate-vote objects using
// both genuine consensus-signature branches after activation and the historical
// signature profile before activation. Outer power and timestamp are bound to
// the trusted block at evidence height, not to peer assertions or current state.
//
// This is a candidate adapter, not a replacement for the real evidence engine.
// The engine still owns evidence age/future-height limits, committed-duplicate
// rejection, canonical transport/size budgets, consensus state transitions and
// slashing. Upstream Comet's 64-byte vote/signature decoders still reject this
// candidate envelope; no fork, transport integration or activation is implied.
func (v *Verifier) VerifyDuplicateVoteEvidence(evidence *cmttypes.DuplicateVoteEvidence, source EvidenceStateSource) error {
	if v == nil || evidence == nil || evidence.VoteA == nil || evidence.VoteB == nil || source == nil {
		return errors.New("missing duplicate-vote evidence, verifier or trusted historical source")
	}
	a, b := evidence.VoteA, evidence.VoteB
	requestA, err := v.evidenceVoteRequest(a)
	if err != nil {
		return fmt.Errorf("invalid duplicate VoteA: %w", err)
	}
	requestB, err := v.evidenceVoteRequest(b)
	if err != nil {
		return fmt.Errorf("invalid duplicate VoteB: %w", err)
	}
	if a.Height != b.Height || a.Round != b.Round || a.Type != b.Type || !bytes.Equal(a.ValidatorAddress, b.ValidatorAddress) {
		return errors.New("duplicate votes differ in height, round, type or validator")
	}
	if a.BlockID.Equals(b.BlockID) || strings.Compare(a.BlockID.Key(), b.BlockID.Key()) >= 0 {
		return errors.New("duplicate votes need distinct block IDs in canonical order")
	}
	// Comet evidence authorizes by address. ValidatorIndex is not signed by its
	// canonical vote format; its ValidateBasic rule is nonnegative only. Unlike a
	// Commit's positional signatures, evidence must not count an unsigned index
	// as identity or voting power. NewVoteRequest enforces the nonnegative rule.
	state, err := source.ConsensusEvidenceStateAt(v.policy.ChainID, a.Height)
	if err != nil {
		return fmt.Errorf("resolve evidence-height validator set and block: %w", err)
	}
	if state.ChainID != v.policy.ChainID || state.Height != a.Height || state.BlockTime.IsZero() || !evidence.Timestamp.Equal(state.BlockTime) {
		return errors.New("evidence metadata differs from its trusted historical block")
	}
	validatorPower, totalPower, err := evidencePowerAt(state.Validators, a.ValidatorAddress)
	if err != nil {
		return err
	}
	if evidence.ValidatorPower != validatorPower || evidence.TotalVotingPower != totalPower {
		return errors.New("evidence voting power differs from its historical validator set")
	}
	if err := v.Verify(requestA, a.Signature); err != nil {
		return fmt.Errorf("verify duplicate VoteA: %w", err)
	}
	if err := v.Verify(requestB, b.Signature); err != nil {
		return fmt.Errorf("verify duplicate VoteB: %w", err)
	}
	return nil
}

// evidenceVoteRequest mirrors the relevant pinned Comet Vote.ValidateBasic
// rules while replacing only the signature profile bound. Ordinary duplicate
// evidence proves conflicting ordinary votes. Extension data is bounded and
// checked for permitted shape, but its contents/signature are NOT authenticated
// by this method and cannot confer extension or application authorization.
func (v *Verifier) evidenceVoteRequest(vote *cmttypes.Vote) (Request, error) {
	maxSignature := EnvelopeSize
	if vote.Height < v.policy.ActivationHeight {
		maxSignature = 64
	}
	if len(vote.Signature) == 0 || len(vote.Signature) > maxSignature ||
		len(vote.ExtensionSignature) > maxSignature || (len(vote.Extension) != 0 && len(vote.ExtensionSignature) == 0) {
		return Request{}, errors.New("invalid evidence vote or extension signature bounds")
	}
	if vote.Height >= v.policy.ActivationHeight {
		if len(vote.Signature) != EnvelopeSize {
			return Request{}, errors.New("invalid PQ evidence vote signature size")
		}
		if len(vote.ExtensionSignature) != 0 {
			if _, err := ParseEnvelope(vote.ExtensionSignature); err != nil {
				return Request{}, fmt.Errorf("invalid PQ extension envelope shape: %w", err)
			}
		}
	}
	return NewVoteRequest(v.policy.ChainID, vote.ToProto())
}

func evidencePowerAt(validators *cmttypes.ValidatorSet, address []byte) (int64, int64, error) {
	if validators == nil || len(validators.Validators) == 0 || len(validators.Validators) > cmttypes.MaxVotesCount {
		return 0, 0, errors.New("missing or oversized evidence-height validator set")
	}
	seen := make(map[string]struct{}, len(validators.Validators))
	var total, power int64
	for _, validator := range validators.Validators {
		if validator == nil || len(validator.Address) != validatorAddressSize || validator.VotingPower <= 0 || validator.VotingPower > cmttypes.MaxTotalVotingPower-total {
			return 0, 0, errors.New("invalid historical validator identity or power")
		}
		if _, duplicate := seen[string(validator.Address)]; duplicate {
			return 0, 0, errors.New("duplicate historical validator authority")
		}
		seen[string(validator.Address)] = struct{}{}
		total += validator.VotingPower
		if bytes.Equal(validator.Address, address) {
			power = validator.VotingPower
		}
	}
	if power == 0 {
		return 0, 0, errors.New("evidence signer was not a validator at this height")
	}
	// Recompute instead of trusting ValidatorSet's potentially stale total cache.
	return power, total, nil
}
