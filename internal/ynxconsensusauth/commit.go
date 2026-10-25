package ynxconsensusauth

import (
	"bytes"
	"errors"
	"fmt"

	cmttypes "github.com/cometbft/cometbft/types"
)

// VerifyCommit verifies every present signature and strictly more than two
// thirds of the trusted validator power for the expected block. The validator
// set, expected height/block and registry must come from authenticated state
// anchored to this verifier's genesis. The caller supplies a detached immutable
// snapshot; a Comet ValidatorSet alone has no network or height identity.
// This adapter uses actual Comet Commit objects; upstream wire size limits,
// validator-key encoding, state transitions and light-client trust remain
// separate integration gates. It does not replace those gates by itself.
func (v *Verifier) VerifyCommit(vals *cmttypes.ValidatorSet, blockID cmttypes.BlockID, height int64, commit *cmttypes.Commit) error {
	if v == nil || vals == nil || len(vals.Validators) == 0 || len(vals.Validators) > cmttypes.MaxVotesCount || commit == nil {
		return errors.New("missing or oversized trusted validator set or commit")
	}
	if height <= 0 || commit.Height != height || commit.Round < 0 || !blockID.IsComplete() || blockID.ValidateBasic() != nil || !commit.BlockID.Equals(blockID) || len(commit.Signatures) != len(vals.Validators) {
		return errors.New("commit differs from expected height, block or validator set")
	}
	seen := make(map[string]struct{}, len(vals.Validators))
	var total, signed int64
	// Recompute power instead of trusting a potentially stale cached total.
	for _, validator := range vals.Validators {
		if validator == nil || len(validator.Address) != validatorAddressSize || validator.VotingPower <= 0 || validator.VotingPower > cmttypes.MaxTotalVotingPower-total {
			return errors.New("invalid trusted validator identity or power")
		}
		if _, exists := seen[string(validator.Address)]; exists {
			return errors.New("duplicate trusted validator")
		}
		seen[string(validator.Address)] = struct{}{}
		total += validator.VotingPower
	}
	for i, signature := range commit.Signatures {
		switch signature.BlockIDFlag {
		case cmttypes.BlockIDFlagAbsent:
			if len(signature.ValidatorAddress) != 0 || !signature.Timestamp.IsZero() || len(signature.Signature) != 0 {
				return errors.New("absent commit signature contains data")
			}
			continue
		case cmttypes.BlockIDFlagCommit, cmttypes.BlockIDFlagNil:
		default:
			return errors.New("unknown commit block flag")
		}
		validator := vals.Validators[i]
		if !bytes.Equal(signature.ValidatorAddress, validator.Address) {
			return errors.New("commit signature does not match trusted validator index")
		}
		request, err := NewVoteRequestV2(v.policy.GenesisID, v.policy.ChainID, commit.GetVote(int32(i)).ToProto())
		if err != nil {
			return err
		}
		if err := v.Verify(request, signature.Signature); err != nil {
			return fmt.Errorf("commit signature %d: %w", i, err)
		}
		if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit {
			signed += validator.VotingPower
		}
	}
	if signed <= total*2/3 {
		return errors.New("commit has insufficient trusted voting power")
	}
	return nil
}
