package ynxconsensusauth

import (
	"bytes"
	"errors"
	"fmt"
	"sync"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// ObjectSigningState is a detached view of authenticated consensus state at the
// requested height and round. ValidatorAddress/Index identify the local signer
// in that validator set; ProposerAddress is the actual selected proposer. The
// PQ Registry still independently resolves this address's complete key pair.
type ObjectSigningState struct {
	GenesisID        []byte
	ChainID          string
	Height           int64
	Round            int32
	ValidatorAddress []byte
	ValidatorIndex   int32
	ProposerAddress  []byte
	Params           cmttypes.ConsensusParams
}

// ObjectSigningStateSource must obtain selection, membership and consensus
// params from trusted state, never from a peer's object or extension flag. It
// must return an immutable/detached snapshot made under its own state lock.
// Implementations must not mutate returned slices concurrently with this call.
type ObjectSigningStateSource interface {
	ConsensusSigningStateAt(genesisID []byte, chainID string, localAddress []byte, height int64, round int32) (ObjectSigningState, error)
}

// ObjectSigner is a candidate adapter for actual Comet protobuf objects. It is
// not a stock PrivValidator implementation and exposes neither raw signing nor
// a synthetic GetPubKey. Transport, engine and public-key-type support remain
// separate integration work. Value copies share the adapter's operation lock
// and the same existing durable Signer; no second H/R/S history is introduced.
type ObjectSigner struct{ core *objectSignerCore }

type objectSignerCore struct {
	mu        sync.Mutex
	signer    *Signer
	source    ObjectSigningStateSource
	chainID   string
	genesisID []byte
	address   []byte
}

func NewObjectSigner(signer *Signer, source ObjectSigningStateSource) (*ObjectSigner, error) {
	if signer == nil || signer.signerCore == nil || source == nil {
		return nil, errors.New("object signer requires durable signer and trusted state source")
	}
	// Only copy immutable authority while holding the signer mutex. Never hold
	// this mutex across Sign, which acquires it itself for the durable operation.
	signer.mu.Lock()
	defer signer.mu.Unlock()
	if signer.closed || signer.lock == nil {
		return nil, errors.New("object signer requires an open durable signer")
	}
	return &ObjectSigner{core: &objectSignerCore{signer: signer, source: source, chainID: signer.state.Policy.ChainID, genesisID: bytes.Clone(signer.state.Policy.GenesisID), address: bytes.Clone(signer.state.Address)}}, nil
}

func (s *objectSignerCore) stateAt(chainID string, height int64, round int32) (ObjectSigningState, error) {
	if chainID != s.chainID {
		return ObjectSigningState{}, errors.New("wrong object signing chain")
	}
	state, err := s.source.ConsensusSigningStateAt(bytes.Clone(s.genesisID), chainID, bytes.Clone(s.address), height, round)
	if err != nil {
		return state, fmt.Errorf("resolve trusted object signing state: %w", err)
	}
	// Do not retain the source's mutable byte/slice storage between either
	// signing phase. The source contract protects the snapshot during this copy.
	state.GenesisID = bytes.Clone(state.GenesisID)
	state.ValidatorAddress = bytes.Clone(state.ValidatorAddress)
	state.ProposerAddress = bytes.Clone(state.ProposerAddress)
	state.Params.Validator.PubKeyTypes = append([]string(nil), state.Params.Validator.PubKeyTypes...)
	if state.ChainID != chainID || !bytes.Equal(state.GenesisID, s.genesisID) || state.Height != height || state.Round != round ||
		!bytes.Equal(state.ValidatorAddress, s.address) || state.ValidatorIndex < 0 ||
		len(state.ProposerAddress) != validatorAddressSize || state.Params.ABCI.VoteExtensionsEnableHeight < 0 {
		return ObjectSigningState{}, errors.New("trusted object signing view does not match requested coordinates or membership")
	}
	if err := state.Params.ValidateBasic(); err != nil {
		return ObjectSigningState{}, fmt.Errorf("invalid trusted consensus params: %w", err)
	}
	return state, nil
}

// SignProposal updates only Signature, and only after the original full request
// is durably signed. The caller owns the object and must not mutate it during
// this call. An error leaves every caller-owned field unchanged.
func (s *ObjectSigner) SignProposal(chainID string, proposal *cmtproto.Proposal) error {
	if s == nil || s.core == nil || proposal == nil {
		return errors.New("missing object signer or proposal")
	}
	c := s.core
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(proposal.BlockID.Hash) > 32 || len(proposal.BlockID.PartSetHeader.Hash) > 32 || !boundedObjectSignature(proposal.Signature) {
		return errors.New("proposal exceeds candidate object signing bounds")
	}
	p := *proposal
	p.BlockID = cloneObjectBlockID(p.BlockID)
	p.Signature = bytes.Clone(p.Signature)
	request, err := NewProposalRequestV2(c.genesisID, chainID, c.address, &p)
	if err != nil {
		return err
	}
	state, err := c.stateAt(chainID, p.Height, p.Round)
	if err != nil {
		return err
	}
	if !bytes.Equal(state.ProposerAddress, c.address) {
		return errors.New("local consensus signer is not the trusted selected proposer")
	}
	signature, err := c.signer.Sign(request)
	if err != nil {
		clear(signature)
		return err
	}
	if len(p.Signature) != 0 && !bytes.Equal(p.Signature, signature) {
		clear(signature)
		return errors.New("existing proposal signature differs from original durable result")
	}
	proposal.Signature = signature
	return nil
}

// SignVote constructs both requests before signing. For an enabled non-nil
// precommit it signs even an empty extension, as required by the trusted params.
// It publishes neither newly produced signature until both durable operations
// succeed. UNKNOWN or any second-phase failure leaves the original vote intact;
// retry must use the exact original vote, including timestamp and extension.
func (s *ObjectSigner) SignVote(chainID string, vote *cmtproto.Vote) error {
	if s == nil || s.core == nil || vote == nil {
		return errors.New("missing object signer or vote")
	}
	c := s.core
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(vote.BlockID.Hash) > 32 || len(vote.BlockID.PartSetHeader.Hash) > 32 || len(vote.ValidatorAddress) != validatorAddressSize || len(vote.Extension) > 1<<20 || !boundedObjectSignature(vote.Signature) || !boundedObjectSignature(vote.ExtensionSignature) {
		return errors.New("vote exceeds candidate object signing bounds")
	}
	v := *vote
	v.BlockID = cloneObjectBlockID(v.BlockID)
	v.ValidatorAddress = bytes.Clone(v.ValidatorAddress)
	v.Extension = bytes.Clone(v.Extension)
	v.Signature, v.ExtensionSignature = bytes.Clone(v.Signature), bytes.Clone(v.ExtensionSignature)
	ordinary, err := NewVoteRequestV2(c.genesisID, chainID, &v)
	if err != nil {
		return err
	}
	state, err := c.stateAt(chainID, v.Height, v.Round)
	if err != nil {
		return err
	}
	if !bytes.Equal(v.ValidatorAddress, state.ValidatorAddress) || v.ValidatorIndex != state.ValidatorIndex {
		return errors.New("vote does not match trusted local validator address and index")
	}
	extended := state.Params.ABCI.VoteExtensionsEnabled(v.Height) && v.Type == cmtproto.PrecommitType && !cmttypes.ProtoBlockIDIsNil(&v.BlockID)
	var extension Request
	if extended {
		extension, err = NewVoteExtensionRequestV2(c.genesisID, chainID, &v)
		if err != nil {
			return err
		}
	} else if len(v.Extension) != 0 || len(v.ExtensionSignature) != 0 {
		return errors.New("vote extensions are not authorized for this height and vote")
	}
	signature, err := c.signer.Sign(ordinary)
	if err != nil {
		clear(signature)
		return err
	}
	var extensionSignature []byte
	if extended {
		extensionSignature, err = c.signer.Sign(extension)
		if err != nil {
			clear(signature)
			clear(extensionSignature)
			return err
		}
	}
	if (len(v.Signature) != 0 && !bytes.Equal(v.Signature, signature)) ||
		(len(v.ExtensionSignature) != 0 && !bytes.Equal(v.ExtensionSignature, extensionSignature)) {
		clear(signature)
		clear(extensionSignature)
		return errors.New("existing vote signatures differ from original durable results")
	}
	vote.Signature, vote.ExtensionSignature = signature, extensionSignature
	return nil
}

func boundedObjectSignature(signature []byte) bool {
	if len(signature) == 0 {
		return true
	}
	if len(signature) != EnvelopeSize {
		return false
	}
	_, err := ParseEnvelope(signature)
	return err == nil
}

func cloneObjectBlockID(block cmtproto.BlockID) cmtproto.BlockID {
	block.Hash = bytes.Clone(block.Hash)
	block.PartSetHeader.Hash = bytes.Clone(block.PartSetHeader.Hash)
	return block
}
