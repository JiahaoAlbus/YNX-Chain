package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
	"time"

	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

// All zero keys/signatures in this file are explicitly non-cryptographic
// control fixtures. Spy providers test routing/AND semantics, never primitives.
func fixtureEnvelope(t *testing.T) []byte {
	t.Helper()
	wire, err := (Envelope{KeyEpoch: 7, MLDSA87: make([]byte, MLDSA87SignatureSize), SLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize)}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func fixtureGenesis() []byte { return bytes.Repeat([]byte{0x71}, 32) }

func fixtureVote(height int64) *cmtproto.Vote {
	return &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: height, Round: 0, ValidatorAddress: bytes.Repeat([]byte{0x31}, 20), ValidatorIndex: 0,
		BlockID: cmtproto.BlockID{Hash: bytes.Repeat([]byte{0x32}, 32), PartSetHeader: cmtproto.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{0x33}, 32)}}, Timestamp: time.Unix(1700000000, 123).UTC()}
}

func fixtureRequest(t *testing.T, height int64) Request {
	t.Helper()
	r, err := NewVoteRequestV2(fixtureGenesis(), "ynx-research-only", fixtureVote(height))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

type registryFixture struct {
	anchor RegistryAnchor
	record KeyRecord
	err    error
	calls  int
}

func (r *registryFixture) Anchor() RegistryAnchor {
	return RegistryAnchor{GenesisID: bytes.Clone(r.anchor.GenesisID), ChainID: r.anchor.ChainID}
}

func (r *registryFixture) ConsensusKeysAt(chainID string, address []byte, height int64) (KeyRecord, error) {
	r.calls++
	return r.record, r.err
}

type providerSpy struct {
	errA, errB     error
	callsA, callsB int
	messages       [][]byte
	mutate         bool
}

func (p *providerSpy) VerifyMLDSA87(pk, msg, sig []byte) error {
	p.callsA++
	p.messages = append(p.messages, bytes.Clone(msg))
	if p.mutate {
		msg[0] ^= 0xff
		pk[0] ^= 0xff
	}
	return p.errA
}
func (p *providerSpy) VerifySLHDSASHA2256f(pk, msg, sig []byte) error {
	p.callsB++
	p.messages = append(p.messages, bytes.Clone(msg))
	return p.errB
}

type historicalSpy struct {
	calls     int
	canonical []byte
	err       error
}

func (h *historicalSpy) Anchor() RegistryAnchor {
	return RegistryAnchor{GenesisID: fixtureGenesis(), ChainID: "ynx-research-only"}
}

func (h *historicalSpy) VerifyHistorical(genesisID []byte, chainID string, address []byte, height int64, kind Kind, canonical, signature []byte) error {
	h.calls++
	h.canonical = bytes.Clone(canonical)
	return h.err
}

func fixtureRegistry() *registryFixture {
	return &registryFixture{anchor: RegistryAnchor{GenesisID: fixtureGenesis(), ChainID: "ynx-research-only"}, record: KeyRecord{Version: Version, ChainID: "ynx-research-only", ValidatorAddress: bytes.Repeat([]byte{0x31}, 20), Epoch: 7, ValidFromHeight: 100, MLDSA87PublicKey: make([]byte, MLDSA87PublicKeySize), SLHDSASHA2256fPublicKey: make([]byte, SLHDSASHA2256fPublicKeySize)}}
}

func fixtureVerifier(t *testing.T, r Registry, p Provider, h HistoricalVerifier) *Verifier {
	t.Helper()
	v, err := NewVerifier(Policy{Version: ConsensusGenesisVersion, GenesisID: fixtureGenesis(), ChainID: "ynx-research-only", ActivationHeight: 100}, r, p, h)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestEnvelopeStrictParsing(t *testing.T) {
	wire := fixtureEnvelope(t)
	if len(wire) != EnvelopeSize {
		t.Fatal("size mismatch")
	}
	parsed, err := ParseEnvelope(wire)
	if err != nil {
		t.Fatal(err)
	}
	roundtrip, err := parsed.MarshalBinary()
	if err != nil || !bytes.Equal(wire, roundtrip) {
		t.Fatal("roundtrip mismatch")
	}
	mutations := map[string]func([]byte) []byte{
		"truncated":   func(b []byte) []byte { return b[:len(b)-1] },
		"trailing":    func(b []byte) []byte { return append(b, 0) },
		"tag":         func(b []byte) []byte { b[0] ^= 1; return b },
		"version":     func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(envelopeTag):], 1); return b },
		"zero epoch":  func(b []byte) []byte { clear(b[len(envelopeTag)+4 : len(envelopeTag)+12]); return b },
		"algorithm A": func(b []byte) []byte { binary.BigEndian.PutUint32(b[len(envelopeTag)+12:], 2); return b },
		"length A": func(b []byte) []byte {
			binary.BigEndian.PutUint32(b[len(envelopeTag)+16:], MLDSA87SignatureSize-1)
			return b
		},
		"algorithm B": func(b []byte) []byte {
			binary.BigEndian.PutUint32(b[len(envelopeTag)+20+MLDSA87SignatureSize:], 1)
			return b
		},
		"length B": func(b []byte) []byte {
			binary.BigEndian.PutUint32(b[len(envelopeTag)+24+MLDSA87SignatureSize:], SLHDSASHA2256fSignatureSize+1)
			return b
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseEnvelope(mutate(bytes.Clone(wire))); err == nil {
				t.Fatal("accepted invalid envelope")
			}
		})
	}
	wire[len(envelopeTag)+20] ^= 1
	if parsed.MLDSA87[0] != 0 {
		t.Fatal("parser returned alias")
	}
}

func TestANDRequiresBothBranchesAndPreservesFullMessage(t *testing.T) {
	for _, tc := range []struct {
		name         string
		failA, failB bool
	}{{"both valid", false, false}, {"ML fails", true, false}, {"SLH fails", false, true}, {"both fail", true, true}} {
		t.Run(tc.name, func(t *testing.T) {
			p := &providerSpy{mutate: true}
			if tc.failA {
				p.errA = errors.New("ML invalid")
			}
			if tc.failB {
				p.errB = errors.New("SLH invalid")
			}
			r := fixtureRegistry()
			req := fixtureRequest(t, 100)
			err := fixtureVerifier(t, r, p, nil).Verify(req, fixtureEnvelope(t))
			if (err != nil) != (tc.failA || tc.failB) {
				t.Fatalf("incorrect AND result: %v", err)
			}
			if p.callsA != 1 || p.callsB != 1 {
				t.Fatal("did not verify both branches")
			}
			want, _ := req.SigningBytes(7)
			if !bytes.Equal(p.messages[0], want) || !bytes.Equal(p.messages[1], want) {
				t.Fatal("branch lost full message or shares mutable buffer")
			}
			if r.record.MLDSA87PublicKey[0] != 0 {
				t.Fatal("mutated registry-owned public key")
			}
		})
	}
}

func TestActivationBoundaryHasNoFallback(t *testing.T) {
	p, h, registry := &providerSpy{}, &historicalSpy{}, fixtureRegistry()
	v := fixtureVerifier(t, registry, p, h)
	if err := v.Verify(fixtureRequest(t, 99), make([]byte, 64)); err != nil {
		t.Fatal(err)
	}
	if h.calls != 1 || p.callsA != 0 || registry.calls != 0 {
		t.Fatal("historical request entered PQ")
	}
	if !bytes.Equal(h.canonical, cmttypes.VoteSignBytes("ynx-research-only", fixtureVote(99))) {
		t.Fatal("historical canonical bytes changed")
	}
	if err := v.Verify(fixtureRequest(t, 99), fixtureEnvelope(t)); err == nil {
		t.Fatal("accepted PQ before activation")
	}
	if err := v.Verify(fixtureRequest(t, 100), make([]byte, 64)); err == nil {
		t.Fatal("accepted classic after activation")
	}
	if h.calls != 1 {
		t.Fatal("post-activation fallback called")
	}
	if err := v.Verify(fixtureRequest(t, 100), fixtureEnvelope(t)); err != nil {
		t.Fatal(err)
	}
	if p.callsA != 1 || p.callsB != 1 {
		t.Fatal("activation did not use PQ pair")
	}
}

func TestUntrustedKeyRecordRejectedBeforeProvider(t *testing.T) {
	cases := map[string]func(*KeyRecord){
		"wrong chain":           func(r *KeyRecord) { r.ChainID = "other" },
		"wrong owner":           func(r *KeyRecord) { r.ValidatorAddress = bytes.Repeat([]byte{2}, 20) },
		"epoch replay":          func(r *KeyRecord) { r.Epoch++ },
		"future keys":           func(r *KeyRecord) { r.ValidFromHeight = 101 },
		"expired keys":          func(r *KeyRecord) { r.ValidUntilHeight = 100 },
		"wrong parameter set A": func(r *KeyRecord) { r.MLDSA87PublicKey = make([]byte, 1952) },
		"wrong parameter set B": func(r *KeyRecord) { r.SLHDSASHA2256fPublicKey = make([]byte, 32) },
		"version":               func(r *KeyRecord) { r.Version = 2 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r, p := fixtureRegistry(), &providerSpy{}
			mutate(&r.record)
			if err := fixtureVerifier(t, r, p, nil).Verify(fixtureRequest(t, 100), fixtureEnvelope(t)); err == nil {
				t.Fatal("accepted unauthorized key record")
			}
			if p.callsA+p.callsB != 0 {
				t.Fatal("invalid registration reached primitive")
			}
		})
	}
}

func TestMissingDependenciesFailClosed(t *testing.T) {
	req := fixtureRequest(t, 100)
	for _, v := range []*Verifier{nil, fixtureVerifier(t, nil, &providerSpy{}, nil), fixtureVerifier(t, fixtureRegistry(), nil, nil)} {
		if err := v.Verify(req, fixtureEnvelope(t)); err == nil {
			t.Fatal("accepted missing dependency")
		}
	}
	if err := fixtureVerifier(t, nil, nil, nil).Verify(fixtureRequest(t, 99), make([]byte, 64)); err == nil {
		t.Fatal("accepted missing historical verifier")
	}
	if _, err := NewVerifier(Policy{}, nil, nil, nil); err == nil {
		t.Fatal("accepted absent activation policy")
	}
	if err := fixtureVerifier(t, fixtureRegistry(), &providerSpy{}, nil).Verify(Request{}, fixtureEnvelope(t)); err == nil {
		t.Fatal("accepted empty request")
	}
}

func TestFullCanonicalDomainSeparation(t *testing.T) {
	base := fixtureRequest(t, 100)
	expected, _ := base.SigningBytes(7)
	mutations := map[string]func(*cmtproto.Vote){
		"height": func(v *cmtproto.Vote) { v.Height++ }, "round": func(v *cmtproto.Vote) { v.Round++ },
		"prevote": func(v *cmtproto.Vote) { v.Type = cmtproto.PrevoteType }, "block": func(v *cmtproto.Vote) { v.BlockID.Hash[0]++ },
		"timestamp": func(v *cmtproto.Vote) { v.Timestamp = v.Timestamp.Add(time.Nanosecond) }, "validator": func(v *cmtproto.Vote) { v.ValidatorAddress[0]++ },
		"part set": func(v *cmtproto.Vote) { v.BlockID.PartSetHeader.Hash[0]++ },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			vote := fixtureVote(100)
			mutate(vote)
			req, err := NewVoteRequestV2(fixtureGenesis(), base.chainID, vote)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := req.SigningBytes(7)
			if bytes.Equal(expected, got) {
				t.Fatal("domain collision")
			}
		})
	}
	other, _ := NewVoteRequestV2(fixtureGenesis(), "ynx-other-research", fixtureVote(100))
	otherBytes, _ := other.SigningBytes(7)
	epochBytes, _ := base.SigningBytes(8)
	if bytes.Equal(expected, otherBytes) || bytes.Equal(expected, epochBytes) || bytes.HasPrefix(expected, []byte("YNX-BATCH")) {
		t.Fatal("cross-chain/epoch/transaction domain collision")
	}
	vote := fixtureVote(100)
	vote.Extension = []byte("complete-extension")
	ext, err := NewVoteExtensionRequestV2(fixtureGenesis(), base.chainID, vote)
	if err != nil {
		t.Fatal(err)
	}
	extBytes, _ := ext.SigningBytes(7)
	if bytes.Equal(expected, extBytes) || !bytes.Contains(extBytes, vote.Extension) || !bytes.Contains(extBytes, vote.BlockID.Hash) {
		t.Fatal("extension not bound to full vote")
	}
	vote.Type = cmtproto.PrevoteType
	if _, err := NewVoteExtensionRequestV2(fixtureGenesis(), base.chainID, vote); err == nil {
		t.Fatal("accepted prevote extension")
	}
}

func TestProposalAndMalformedCoordinates(t *testing.T) {
	vote := fixtureVote(100)
	p := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: 100, Round: 0, PolRound: -1, BlockID: vote.BlockID, Timestamp: vote.Timestamp}
	r, err := NewProposalRequestV2(fixtureGenesis(), "ynx-research-only", vote.ValidatorAddress, p)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(r.legacy, cmttypes.ProposalSignBytes(r.chainID, p)) {
		t.Fatal("legacy proposal bytes differ")
	}
	p.PolRound = 0
	if _, err := NewProposalRequestV2(fixtureGenesis(), r.chainID, vote.ValidatorAddress, p); err == nil {
		t.Fatal("accepted future POL")
	}
	for _, chainID := range []string{"", strings.Repeat("x", 51), string([]byte{0xff})} {
		if _, err := NewVoteRequestV2(fixtureGenesis(), chainID, vote); err == nil {
			t.Fatal("accepted invalid chain ID")
		}
	}
	vote.Height = 0
	if _, err := NewVoteRequestV2(fixtureGenesis(), r.chainID, vote); err == nil {
		t.Fatal("accepted zero height")
	}
	vote = fixtureVote(100)
	vote.BlockID.Hash = []byte{1}
	if _, err := NewVoteRequestV2(fixtureGenesis(), r.chainID, vote); err == nil {
		t.Fatal("accepted malformed block ID")
	}
}

func TestStockCometRejectsCandidateEnvelope(t *testing.T) {
	vote, err := cmttypes.VoteFromProto(fixtureVote(100))
	if err != nil {
		t.Fatal(err)
	}
	vote.Signature = fixtureEnvelope(t)
	if err := vote.ValidateBasic(); err == nil || !strings.Contains(err.Error(), "signature is too big") {
		t.Fatalf("stock Comet compatibility changed: %v", err)
	}
}

func FuzzEnvelopeRoundTrip(f *testing.F) {
	f.Add([]byte{})
	f.Add([]byte(envelopeTag))
	wire, _ := (Envelope{KeyEpoch: 7, MLDSA87: make([]byte, MLDSA87SignatureSize), SLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize)}).MarshalBinary()
	f.Add(wire)
	f.Fuzz(func(t *testing.T, data []byte) {
		parsed, err := ParseEnvelope(data)
		if err != nil {
			return
		}
		encoded, err := parsed.MarshalBinary()
		if err != nil || !bytes.Equal(data, encoded) {
			t.Fatal("accepted non-canonical envelope")
		}
	})
}
