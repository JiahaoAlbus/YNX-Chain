package ynxpq

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
	"github.com/cometbft/cometbft/libs/protoio"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
)

type Kind uint32

const (
	Proposal          Kind = 1
	Prevote           Kind = 2
	Precommit         Kind = 3
	VoteExtension     Kind = 4
	messageTag             = "YNX-CONSENSUS-MESSAGE/v0.2\x00"
	envelopeTag            = "YNX-CONSENSUS-SIG/v0.2\x00"
	EnvelopeSize           = len(envelopeTag) + 4 + 8 + 4 + 4 + MLDSA87SignatureSize + 4 + 4 + SLHDSASHA2256fSignatureSize
	MaxCanonicalBytes      = (1 << 20) + 4096
)

type request struct {
	height    int64
	round     int32
	kind      Kind
	canonical []byte
}

// ValidateEnvelope checks exact v0.2 framing only, never signature validity or
// authority. No arbitrary 54 KiB blob becomes an admissible signature shape.
func ValidateEnvelope(wire []byte) error { _, _, _, err := decodeEnvelope(wire); return err }
func decodeEnvelope(wire []byte) (uint64, []byte, []byte, error) {
	bad := errors.New("invalid YNX consensus v0.2 envelope")
	if len(wire) != EnvelopeSize || string(wire[:len(envelopeTag)]) != envelopeTag {
		return 0, nil, nil, bad
	}
	off := len(envelopeTag)
	read := func() uint32 { n := binary.BigEndian.Uint32(wire[off : off+4]); off += 4; return n }
	if read() != 2 {
		return 0, nil, nil, bad
	}
	epoch := binary.BigEndian.Uint64(wire[off : off+8])
	off += 8
	if epoch == 0 || read() != 1 || read() != MLDSA87SignatureSize {
		return 0, nil, nil, bad
	}
	a := wire[off : off+MLDSA87SignatureSize]
	off += MLDSA87SignatureSize
	if read() != 2 || read() != SLHDSASHA2256fSignatureSize {
		return 0, nil, nil, bad
	}
	return epoch, a, wire[off:], nil
}

// VerifySignature is called by the actual proposal, vote, commit and evidence
// paths. It accepts stock canonical proposal/vote bytes, reconstructs the exact
// genesis-bound v0.2 message, checks trusted authorization, then verifies BOTH
// pure standard algorithms. Stock extension bytes alone are insufficient.
func (k PubKey) VerifySignature(canonical, signature []byte) bool {
	r, err := k.ordinaryRequest(canonical)
	return err == nil && k.verify(r, signature)
}
func (k PubKey) verify(r request, signature []byte) bool {
	epoch, a, b, err := decodeEnvelope(signature)
	if err != nil || epoch != k.epoch || k.authorizer == nil || r.height < k.validFrom {
		return false
	}
	if err = k.authorizer.AuthorizeConsensusKey(k.Bytes(), r.height, r.round, r.kind); err != nil {
		return false
	}
	message := k.signingBytes(r)
	pa := new(mldsa87.PublicKey)
	if err = pa.UnmarshalBinary(k.pka); err != nil {
		return false
	}
	pb := &slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
	if err = pb.UnmarshalBinary(k.pkb); err != nil {
		return false
	}
	validA := mldsa87.Verify(pa, message, nil, a)
	validB := slhdsa.Verify(pb, slhdsa.NewMessage(message), b, nil)
	return validA && validB
}

func (k PubKey) signingBytes(r request) []byte {
	out := append([]byte(nil), messageTag...)
	out = binary.BigEndian.AppendUint32(out, 2)
	out = binary.BigEndian.AppendUint32(out, uint32(r.kind))
	out = binary.BigEndian.AppendUint64(out, k.epoch)
	out = field(out, k.genesis)
	out = field(out, []byte(k.chainID))
	out = field(out, k.address)
	out = binary.BigEndian.AppendUint64(out, uint64(r.height))
	out = binary.BigEndian.AppendUint32(out, uint32(r.round))
	return field(out, r.canonical)
}

// OrdinarySigningBytes exposes the exact message for interoperation tests and
// controlled signers. It does not grant authority or sign anything.
func (k PubKey) OrdinarySigningBytes(canonical []byte) ([]byte, error) {
	r, err := k.ordinaryRequest(canonical)
	if err != nil {
		return nil, err
	}
	return k.signingBytes(r), nil
}
func (k PubKey) ordinaryRequest(wire []byte) (request, error) {
	var r request
	if len(k.wire) == 0 || len(wire) == 0 || len(wire) > MaxCanonicalBytes {
		return r, errors.New("invalid YNX canonical message size/key")
	}
	n, prefix := binary.Uvarint(wire)
	if prefix <= 0 || n != uint64(len(wire)-prefix) {
		return r, errors.New("invalid canonical delimiter")
	}
	body := wire[prefix:]
	// Canonical proposal and vote share type/height/round. Parse separately and
	// require exact re-encoding to reject duplicate fields, unknowns and aliases.
	var vote cmtproto.CanonicalVote
	if err := vote.Unmarshal(body); err == nil && (vote.Type == cmtproto.PrevoteType || vote.Type == cmtproto.PrecommitType) {
		encoded, err := protoio.MarshalDelimited(&vote)
		if err != nil || !bytes.Equal(encoded, wire) || vote.ChainID != k.chainID || !coordinates(vote.Height, vote.Round) || !canonicalBlock(vote.BlockID, true) {
			return r, errors.New("invalid canonical vote")
		}
		kind := Prevote
		if vote.Type == cmtproto.PrecommitType {
			kind = Precommit
		}
		return request{height: vote.Height, round: int32(vote.Round), kind: kind, canonical: bytes.Clone(wire)}, nil
	}
	var p cmtproto.CanonicalProposal
	if err := p.Unmarshal(body); err != nil {
		return r, err
	}
	encoded, err := protoio.MarshalDelimited(&p)
	if err != nil || !bytes.Equal(encoded, wire) || p.Type != cmtproto.ProposalType || p.ChainID != k.chainID || !coordinates(p.Height, p.Round) || p.POLRound < -1 || p.POLRound >= p.Round || !canonicalBlock(p.BlockID, false) {
		return r, errors.New("invalid canonical proposal")
	}
	return request{height: p.Height, round: int32(p.Round), kind: Proposal, canonical: bytes.Clone(wire)}, nil
}
func coordinates(h, r int64) bool { return h > 0 && r >= 0 && r <= math.MaxInt32 }
func canonicalBlock(b *cmtproto.CanonicalBlockID, nilAllowed bool) bool {
	if b == nil {
		return nilAllowed
	}
	return len(b.Hash) == 32 && b.PartSetHeader.Total > 0 && len(b.PartSetHeader.Hash) == 32
}

// VerifyProposal uses the actual proposal type before canonicalization (stock
// CanonicalizeProposal overwrites Type). The caller selects the trusted
// proposer key from its authenticated height/round validator set.
func (k PubKey) VerifyProposal(chainID string, p *cmtproto.Proposal) bool {
	if p == nil || chainID != k.chainID || p.Type != cmtproto.ProposalType || !coordinates(p.Height, int64(p.Round)) || p.PolRound < -1 || p.PolRound >= p.Round || len(p.BlockID.Hash) != 32 || p.BlockID.PartSetHeader.Total == 0 || len(p.BlockID.PartSetHeader.Hash) != 32 {
		return false
	}
	block := &cmtproto.CanonicalBlockID{Hash: bytes.Clone(p.BlockID.Hash), PartSetHeader: cmtproto.CanonicalPartSetHeader{Total: p.BlockID.PartSetHeader.Total, Hash: bytes.Clone(p.BlockID.PartSetHeader.Hash)}}
	canonical := cmtproto.CanonicalProposal{Type: p.Type, Height: p.Height, Round: int64(p.Round), POLRound: int64(p.PolRound), BlockID: block, Timestamp: p.Timestamp, ChainID: chainID}
	body, err := protoio.MarshalDelimited(&canonical)
	return err == nil && k.VerifySignature(body, p.Signature)
}

// VerifyVote applies the frozen full-object admission rules before deriving the
// canonical vote message. ValidatorIndex and unexpected extension metadata are
// absent from stock sign bytes, so the actual Vote caller must supply them.
func (k PubKey) VerifyVote(chainID string, v *cmtproto.Vote) bool {
	r, err := k.voteRequest(chainID, v)
	return err == nil && k.verify(r, v.Signature)
}

func (k PubKey) voteRequest(chainID string, v *cmtproto.Vote) (request, error) {
	var r request
	if v == nil || chainID != k.chainID || (v.Type != cmtproto.PrevoteType && v.Type != cmtproto.PrecommitType) || !coordinates(v.Height, int64(v.Round)) || v.ValidatorIndex < 0 || !bytes.Equal(v.ValidatorAddress, k.address) || len(v.Extension) > 1<<20 {
		return r, errors.New("invalid full vote")
	}
	nilBlock := len(v.BlockID.Hash) == 0 && v.BlockID.PartSetHeader.Total == 0 && len(v.BlockID.PartSetHeader.Hash) == 0
	var block *cmtproto.CanonicalBlockID
	if !nilBlock {
		if len(v.BlockID.Hash) != 32 || v.BlockID.PartSetHeader.Total == 0 || len(v.BlockID.PartSetHeader.Hash) != 32 {
			return r, errors.New("invalid vote block ID")
		}
		block = &cmtproto.CanonicalBlockID{Hash: bytes.Clone(v.BlockID.Hash), PartSetHeader: cmtproto.CanonicalPartSetHeader{Total: v.BlockID.PartSetHeader.Total, Hash: bytes.Clone(v.BlockID.PartSetHeader.Hash)}}
	}
	if (v.Type != cmtproto.PrecommitType || nilBlock) && (len(v.Extension) != 0 || len(v.ExtensionSignature) != 0) {
		return r, errors.New("unexpected vote extension")
	}
	vote := cmtproto.CanonicalVote{Type: v.Type, Height: v.Height, Round: int64(v.Round), BlockID: block, Timestamp: v.Timestamp, ChainID: chainID}
	body, err := protoio.MarshalDelimited(&vote)
	if err != nil {
		return r, err
	}
	return k.ordinaryRequest(body)
}

// VerifyVoteExtension receives the actual complete vote, preserving the v0.2
// binding to ordinary BlockID/time/step as well as extension/H/R/chain. Both
// address and index are checked here rather than trusting extension metadata.
func (k PubKey) VerifyVoteExtension(chainID string, v *cmtproto.Vote) bool {
	r, err := k.extensionRequest(chainID, v)
	return err == nil && k.verify(r, v.ExtensionSignature)
}
func (k PubKey) ExtensionSigningBytes(chainID string, v *cmtproto.Vote) ([]byte, error) {
	r, err := k.extensionRequest(chainID, v)
	if err != nil {
		return nil, err
	}
	return k.signingBytes(r), nil
}
func (k PubKey) extensionRequest(chainID string, v *cmtproto.Vote) (request, error) {
	var r request
	baseRequest, err := k.voteRequest(chainID, v)
	if err != nil {
		return r, err
	}
	if v.Type != cmtproto.PrecommitType || len(v.BlockID.Hash) != 32 {
		return r, errors.New("invalid full extension vote")
	}
	ext := cmtproto.CanonicalVoteExtension{Extension: bytes.Clone(v.Extension), Height: v.Height, Round: int64(v.Round), ChainId: chainID}
	encoded, err := protoio.MarshalDelimited(&ext)
	if err != nil {
		return r, err
	}
	body := field(field(nil, baseRequest.canonical), encoded)
	if len(body) > MaxCanonicalBytes {
		return r, errors.New("canonical extension too large")
	}
	return request{height: v.Height, round: v.Round, kind: VoteExtension, canonical: body}, nil
}
