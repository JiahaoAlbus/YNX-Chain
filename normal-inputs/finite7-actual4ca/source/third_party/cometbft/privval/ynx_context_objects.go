package privval

import (
	"bytes"
	"errors"

	"github.com/cometbft/cometbft/crypto"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

// Preserve the local immutable authorizer; serialization deliberately strips it.
// Legacy key slices and all addresses/priorities are detached from the caller.
func detachedContextSet(set *types.ValidatorSet) (*types.ValidatorSet, error) {
	if set == nil {
		return nil, errors.New("missing actual validator set")
	}
	if err := set.ValidateBasic(); err != nil {
		return nil, err
	}
	pb, err := set.ToProto()
	if err != nil {
		return nil, err
	}
	wire, err := pb.Marshal()
	if err != nil {
		return nil, err
	}
	var decoded cmtproto.ValidatorSet
	if err = decoded.Unmarshal(wire); err != nil {
		return nil, err
	}
	out, err := types.ValidatorSetFromProto(&decoded)
	if err != nil {
		return nil, err
	}
	for _, v := range out.Validators {
		_, original := set.GetByAddress(v.Address)
		if original == nil || !original.PubKey.Equals(v.PubKey) {
			return nil, errors.New("validator changed during context capture")
		}
		if key, ok := original.PubKey.(ynxpq.PubKey); ok {
			v.PubKey = key
		}
	}
	_, proposer := out.GetByAddress(set.Proposer.Address)
	if proposer == nil || proposer.ProposerPriority != set.Proposer.ProposerPriority {
		return nil, errors.New("actual proposer differs from captured validator")
	}
	out.Proposer = proposer
	return out, nil
}

func canonicalUnsignedVote(wire []byte) (*cmtproto.Vote, error) {
	var v cmtproto.Vote
	if err := v.Unmarshal(wire); err != nil {
		return nil, err
	}
	canonical, err := v.Marshal()
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(canonical, wire) || len(v.Signature) != 0 || len(v.ExtensionSignature) != 0 {
		return nil, errors.New("remote vote must be canonical and unsigned")
	}
	if !types.IsVoteTypeValid(v.Type) || v.Height <= 0 || v.Round < 0 || v.ValidatorIndex < 0 || len(v.ValidatorAddress) != crypto.AddressSize || len(v.Extension) > types.MaxVoteExtensionSize {
		return nil, errors.New("invalid unsigned vote")
	}
	block, err := types.BlockIDFromProto(&v.BlockID)
	if err != nil {
		return nil, err
	}
	if err = block.ValidateBasic(); err != nil {
		return nil, err
	}
	return &v, nil
}
func canonicalUnsignedProposal(wire []byte) (*cmtproto.Proposal, error) {
	var p cmtproto.Proposal
	if err := p.Unmarshal(wire); err != nil {
		return nil, err
	}
	canonical, err := p.Marshal()
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(canonical, wire) || len(p.Signature) != 0 || p.Type != cmtproto.ProposalType || p.Height <= 0 || p.Round < 0 || p.PolRound < -1 {
		return nil, errors.New("remote proposal must be canonical, valid and unsigned")
	}
	block, err := types.BlockIDFromProto(&p.BlockID)
	if err != nil {
		return nil, err
	}
	if err = block.ValidateBasic(); err != nil {
		return nil, err
	}
	if !block.IsComplete() {
		return nil, errors.New("proposal requires a complete block")
	}
	return &p, nil
}
func verifyRemoteVote(original []byte, signed *cmtproto.Vote, chain string, key crypto.PubKey, extensionsEnabled bool) error {
	if signed == nil {
		return errors.New("missing signed vote")
	}
	unsigned := *signed
	unsigned.Signature = nil
	unsigned.ExtensionSignature = nil
	wire, err := unsigned.Marshal()
	if err != nil {
		return err
	}
	if !bytes.Equal(wire, original) {
		return errors.New("remote signer changed original vote fields")
	}
	v, err := types.VoteFromProto(signed)
	if err != nil {
		return err
	}
	if err = v.Verify(chain, key); err != nil {
		return err
	}
	extended := extensionsEnabled && signed.Type == cmtproto.PrecommitType && !types.ProtoBlockIDIsNil(&signed.BlockID)
	if extended {
		return v.VerifyVoteAndExtension(chain, key)
	}
	if len(signed.Extension) > 0 || len(signed.ExtensionSignature) > 0 {
		return errors.New("remote signer returned extension data outside trusted policy")
	}
	return nil
}
func verifyRemoteProposal(original []byte, signed *cmtproto.Proposal, chain string, key crypto.PubKey) error {
	if signed == nil {
		return errors.New("missing signed proposal")
	}
	unsigned := *signed
	unsigned.Signature = nil
	wire, err := unsigned.Marshal()
	if err != nil {
		return err
	}
	if !bytes.Equal(wire, original) {
		return errors.New("remote signer changed original proposal fields")
	}
	p, err := types.ProposalFromProto(signed)
	if err != nil {
		return err
	}
	if !p.VerifySignature(chain, key) {
		return errors.New("remote proposal signature invalid")
	}
	return nil
}
func encodeContextKey(key crypto.PubKey) ([]byte, error) {
	pb, err := cryptoenc.PubKeyToProto(key)
	if err != nil {
		return nil, err
	}
	return pb.Marshal()
}
