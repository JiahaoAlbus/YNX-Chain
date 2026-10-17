package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"unicode/utf8"

	"github.com/cometbft/cometbft/libs/protoio"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type Kind uint32

const (
	Proposal             Kind = 1
	Prevote              Kind = 2
	Precommit            Kind = 3
	VoteExtension        Kind = 4
	messageTag                = "YNX-CONSENSUS-MESSAGE/v0.1\x00"
	validatorAddressSize      = 20
	maxChainIDBytes           = 50
	MaxCanonicalBytes         = (1 << 20) + 4096
)

// Request is created from actual Comet objects, never from envelope metadata.
// Fields and canonical bytes are private to prevent substituting a height or
// message kind after the height-specific policy was chosen.
type Request struct {
	chainID   string
	address   []byte
	height    int64
	round     int32
	kind      Kind
	canonical []byte
	legacy    []byte
}

func validateCoordinates(chainID string, address []byte, height int64, round int32) error {
	if len(chainID) == 0 || len(chainID) > maxChainIDBytes || !utf8.ValidString(chainID) || len(address) != validatorAddressSize || height <= 0 || round < 0 {
		return errors.New("invalid consensus chain, validator or height/round")
	}
	return nil
}

// NewProposalRequest requires the proposer address chosen by the trusted
// validator set for this height and round, not an address supplied by a peer.
func NewProposalRequest(chainID string, proposer []byte, p *cmtproto.Proposal) (Request, error) {
	if p == nil {
		return Request{}, errors.New("nil proposal")
	}
	if err := validateCoordinates(chainID, proposer, p.Height, p.Round); err != nil {
		return Request{}, err
	}
	if p.Type != cmtproto.ProposalType || p.PolRound < -1 || p.PolRound >= p.Round {
		return Request{}, errors.New("invalid proposal type or POL round")
	}
	bid, err := cmttypes.BlockIDFromProto(&p.BlockID)
	if err != nil || bid == nil || !bid.IsComplete() {
		return Request{}, errors.New("invalid proposal block ID")
	}
	canonical := cmttypes.CanonicalizeProposal(chainID, p)
	body, err := protoio.MarshalDelimited(&canonical)
	if err != nil {
		return Request{}, fmt.Errorf("encode proposal: %w", err)
	}
	return newRequest(chainID, proposer, p.Height, p.Round, Proposal, body, body)
}

func NewVoteRequest(chainID string, v *cmtproto.Vote) (Request, error) {
	if err := validateVote(chainID, v); err != nil {
		return Request{}, err
	}
	kind := Prevote
	if v.Type == cmtproto.PrecommitType {
		kind = Precommit
	}
	canonical := cmttypes.CanonicalizeVote(chainID, v)
	body, err := protoio.MarshalDelimited(&canonical)
	if err != nil {
		return Request{}, fmt.Errorf("encode vote: %w", err)
	}
	return newRequest(chainID, v.ValidatorAddress, v.Height, v.Round, kind, body, body)
}

// NewVoteExtensionRequest binds the extension to the complete ordinary vote
// as well as Comet's canonical extension. It cannot authorize a commit vote.
// Whether extensions are enabled is still decided by trusted consensus params.
func NewVoteExtensionRequest(chainID string, v *cmtproto.Vote) (Request, error) {
	base, err := NewVoteRequest(chainID, v)
	if err != nil {
		return Request{}, err
	}
	if v.Type != cmtproto.PrecommitType || cmttypes.ProtoBlockIDIsNil(&v.BlockID) {
		return Request{}, errors.New("extension requires a non-nil precommit")
	}
	canonical := cmttypes.CanonicalizeVoteExtension(chainID, v)
	ext, err := protoio.MarshalDelimited(&canonical)
	if err != nil {
		return Request{}, fmt.Errorf("encode vote extension: %w", err)
	}
	body := appendField(nil, base.canonical)
	body = appendField(body, ext)
	return newRequest(chainID, v.ValidatorAddress, v.Height, v.Round, VoteExtension, body, ext)
}

func validateVote(chainID string, v *cmtproto.Vote) error {
	if v == nil {
		return errors.New("nil vote")
	}
	if err := validateCoordinates(chainID, v.ValidatorAddress, v.Height, v.Round); err != nil {
		return err
	}
	if (v.Type != cmtproto.PrevoteType && v.Type != cmtproto.PrecommitType) || v.ValidatorIndex < 0 {
		return errors.New("invalid vote type or index")
	}
	bid, err := cmttypes.BlockIDFromProto(&v.BlockID)
	if err != nil || bid == nil || (!bid.IsZero() && !bid.IsComplete()) {
		return errors.New("invalid vote block ID")
	}
	if len(v.Extension) > 1<<20 {
		return errors.New("vote extension exceeds 1 MiB")
	}
	if (v.Type != cmtproto.PrecommitType || bid.IsZero()) && (len(v.Extension) != 0 || len(v.ExtensionSignature) != 0) {
		return errors.New("unexpected vote extension")
	}
	return nil
}

func newRequest(chainID string, address []byte, height int64, round int32, kind Kind, canonical, legacy []byte) (Request, error) {
	if len(canonical) == 0 || len(canonical) > MaxCanonicalBytes {
		return Request{}, errors.New("invalid canonical message size")
	}
	return Request{chainID: chainID, address: bytes.Clone(address), height: height, round: round, kind: kind, canonical: bytes.Clone(canonical), legacy: bytes.Clone(legacy)}, nil
}

func (r Request) validate() error {
	if err := validateCoordinates(r.chainID, r.address, r.height, r.round); err != nil {
		return err
	}
	if r.kind < Proposal || r.kind > VoteExtension || len(r.canonical) == 0 || len(r.canonical) > MaxCanonicalBytes || len(r.legacy) == 0 {
		return errors.New("invalid consensus request")
	}
	return nil
}

// SigningBytes returns the exact full input to each pure standard algorithm,
// with ctx empty. It is not a prehash and contains no batch or future votes.
func (r Request) SigningBytes(keyEpoch uint64) ([]byte, error) {
	if err := r.validate(); err != nil {
		return nil, err
	}
	if keyEpoch == 0 {
		return nil, errors.New("zero key epoch")
	}
	out := append([]byte(nil), messageTag...)
	out = binary.BigEndian.AppendUint32(out, Version)
	out = binary.BigEndian.AppendUint32(out, uint32(r.kind))
	out = binary.BigEndian.AppendUint64(out, keyEpoch)
	out = appendField(out, []byte(r.chainID))
	out = appendField(out, r.address)
	// Comet heights are int64. Consensus uses u64 BE here, not the separate
	// YNX-BATCH codec's u32 integer convention; positive values only.
	out = binary.BigEndian.AppendUint64(out, uint64(r.height))
	out = binary.BigEndian.AppendUint32(out, uint32(r.round))
	out = appendField(out, r.canonical)
	return out, nil
}
