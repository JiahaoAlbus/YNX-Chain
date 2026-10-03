// Package cometadapter is an inactive candidate bridge to the exact original
// CometBFT v0.38.23 sign-byte implementation. No live privval or consensus hook
// imports this package. Both candidate signatures cover the V2 envelope, NOT an
// already-issued legacy Comet signature; this requires an independently gated
// signer/wire-rule activation and cannot be silently applied to old commits.
package cometadapter

import (
	"bytes"
	"math"

	crypto "github.com/JiahaoAlbus/YNX-Chain/internal/chaincrypto"
	proto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

func voteSnapshot(v *proto.Vote) (*proto.Vote, error) {
	if v == nil || len(v.ValidatorAddress) != 20 || len(v.Signature) > 64 ||
		len(v.BlockID.Hash) > 32 || len(v.BlockID.PartSetHeader.Hash) > 32 ||
		len(v.Extension) != 0 || len(v.ExtensionSignature) != 0 {
		return nil, crypto.ErrInvalid
	}
	// The original canonical vote excludes extension bytes. They remain
	// explicitly unsupported until their own same-vote dual contract exists.
	raw, err := v.Marshal()
	if err != nil || len(raw) > 2048 {
		return nil, crypto.ErrInvalid
	}
	copy := new(proto.Vote)
	if copy.Unmarshal(raw) != nil {
		return nil, crypto.ErrInvalid
	}
	return copy, nil
}

func voteMessage(n crypto.Network, id [20]byte, version uint64, v *proto.Vote) (crypto.ConsensusMessage, error) {
	var zero crypto.ConsensusMessage
	if v.Height <= 0 || v.Round < 0 || version == 0 || !bytes.Equal(v.ValidatorAddress, id[:]) {
		return zero, crypto.ErrInvalid
	}
	kind := crypto.Prevote
	if v.Type == proto.PrecommitType {
		kind = crypto.Precommit
	} else if v.Type != proto.PrevoteType {
		return zero, crypto.ErrInvalid
	}
	// This structural-only copy is never passed to a verifier as a signature.
	// Before signing there is no signature; original ValidateBasic requires one.
	shape := *v
	shape.Signature = make([]byte, 64)
	original, err := types.VoteFromProto(&shape)
	if err != nil || original.ValidateBasic() != nil {
		return zero, crypto.ErrInvalid
	}
	m := crypto.ConsensusMessage{Network: n, Validator: id, KeyVersion: version,
		Height: uint64(v.Height), Round: uint32(v.Round), Kind: kind,
		OriginalSignBytes: types.VoteSignBytes(n.ConsensusID, v)}
	if _, err := m.CanonicalBytes(); err != nil {
		return zero, err
	}
	return m, nil
}

func WrapVote(n crypto.Network, id [20]byte, version uint64, v *proto.Vote) (crypto.ConsensusMessage, error) {
	copy, err := voteSnapshot(v)
	if err != nil {
		return crypto.ConsensusMessage{}, err
	}
	return voteMessage(n, id, version, copy)
}

func WrapProposal(n crypto.Network, id [20]byte, version uint64, p *proto.Proposal) (crypto.ConsensusMessage, error) {
	var zero crypto.ConsensusMessage
	if p == nil || len(p.Signature) > 64 || len(p.BlockID.Hash) > 32 || len(p.BlockID.PartSetHeader.Hash) > 32 || p.Height <= 0 || p.Round < 0 || p.Type != proto.ProposalType {
		return zero, crypto.ErrInvalid
	}
	raw, err := p.Marshal()
	if err != nil || len(raw) > 2048 {
		return zero, crypto.ErrInvalid
	}
	copy := new(proto.Proposal)
	if copy.Unmarshal(raw) != nil {
		return zero, crypto.ErrInvalid
	}
	shape := *copy
	shape.Signature = make([]byte, 64)
	if _, err := types.ProposalFromProto(&shape); err != nil {
		return zero, crypto.ErrInvalid
	}
	m := crypto.ConsensusMessage{Network: n, Validator: id, KeyVersion: version,
		Height: uint64(copy.Height), Round: uint32(copy.Round), Kind: crypto.Proposal,
		OriginalSignBytes: types.ProposalSignBytes(n.ConsensusID, copy)}
	if _, err := m.CanonicalBytes(); err != nil {
		return zero, err
	}
	return m, nil
}

type SignedCandidateVote struct {
	Vote       *proto.Vote
	Signatures crypto.Signatures
}

// VerifyCommitCandidate allows each validator's original signed timestamp.
// Equality of all original vote bytes is wrong for real Comet commits; the
// common block/height/round is checked separately, and both signatures bind
// each exact original canonical vote and the authenticated V2 context.
func VerifyCommitCandidate(provider crypto.CryptoProvider, n crypto.Network,
	set []crypto.Validator, input []SignedCandidateVote, height uint64, round uint32, block proto.BlockID) error {
	if provider == nil || height == 0 || height > math.MaxInt64 || round > math.MaxInt32 || len(set) == 0 || len(set) > 10000 || len(input) > len(set) || len(block.Hash) != 32 || len(block.PartSetHeader.Hash) != 32 || block.PartSetHeader.Total == 0 {
		return crypto.ErrInvalid
	}
	block.Hash = append([]byte(nil), block.Hash...)
	block.PartSetHeader.Hash = append([]byte(nil), block.PartSetHeader.Hash...)
	validators := make(map[[20]byte]crypto.Validator, len(set))
	var total, valid uint64
	for _, v := range set {
		if _, exists := validators[v.ID]; exists || v.ID == [20]byte{} || v.Power == 0 || math.MaxUint64-total < v.Power || len(v.Keys.Classical) != 32 || len(v.Keys.PostQuantum) != 2592 {
			return crypto.ErrInvalid
		}
		v.Keys.Classical = append([]byte(nil), v.Keys.Classical...)
		v.Keys.PostQuantum = append([]byte(nil), v.Keys.PostQuantum...)
		validators[v.ID] = v
		total += v.Power
	}
	// Snapshot ALL inputs before entering any external verification provider.
	votes := make([]SignedCandidateVote, len(input))
	for i, v := range input {
		if len(v.Signatures.Classical) != 64 || len(v.Signatures.PostQuantum) != 4627 {
			return crypto.ErrInvalid
		}
		copy, err := voteSnapshot(v.Vote)
		if err != nil {
			return err
		}
		votes[i] = SignedCandidateVote{copy, crypto.Signatures{Classical: append([]byte(nil), v.Signatures.Classical...), PostQuantum: append([]byte(nil), v.Signatures.PostQuantum...)}}
	}
	seen := map[[20]byte]bool{}
	for _, v := range votes {
		var id [20]byte
		copy(id[:], v.Vote.ValidatorAddress)
		validator, exists := validators[id]
		if !exists || seen[id] || v.Vote.Type != proto.PrecommitType || v.Vote.Height != int64(height) || v.Vote.Round != int32(round) || !bytes.Equal(v.Vote.BlockID.Hash, block.Hash) || !bytes.Equal(v.Vote.BlockID.PartSetHeader.Hash, block.PartSetHeader.Hash) || v.Vote.BlockID.PartSetHeader.Total != block.PartSetHeader.Total {
			return crypto.ErrInvalid
		}
		seen[id] = true
		message, err := voteMessage(n, id, validator.KeyVersion, v.Vote)
		if err != nil {
			return err
		}
		raw, err := message.CanonicalBytes()
		if err != nil {
			return err
		}
		if provider.VerifyConsensus(validator.Keys, raw, v.Signatures) != nil {
			return crypto.ErrInvalid
		}
		valid += validator.Power
	}
	threshold := total - total/3
	if total%3 == 0 {
		threshold++
	}
	if valid < threshold {
		return crypto.ErrInvalid
	}
	return nil
}
