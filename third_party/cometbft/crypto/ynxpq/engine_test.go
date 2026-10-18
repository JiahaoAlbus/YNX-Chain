package ynxpq_test

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"testing"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
	"github.com/cometbft/cometbft/crypto"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
)

// All signatures in these tests are actual CIRCL signatures. The callback
// models independently pinned test authority, not network-supplied metadata.
type fixture struct {
	key       ynxpq.PubKey
	wire      []byte
	a         *mldsa87.PrivateKey
	b         *slhdsa.PrivateKey
	authority ynxpq.Authorizer
}

func fields(items ...[]byte) []byte {
	var out []byte
	for _, item := range items {
		out = binary.BigEndian.AppendUint32(out, uint32(len(item)))
		out = append(out, item...)
	}
	return out
}
func u32(n uint32) []byte { return binary.BigEndian.AppendUint32(nil, n) }
func newFixture(t *testing.T) fixture {
	t.Helper()
	pa, a, err := mldsa87.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pb, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	bb, err := pb.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	// Original identity is established from an actual legacy full Ed public key.
	legacy := ed25519.GenPrivKey().PubKey()
	wire := fields([]byte("YNX-CONSENSUS-LOGICAL-PUBKEY/v1\x00"), u32(1), bytes.Repeat([]byte{31}, 32), []byte("ynx-engine-test"), legacy.Address(), u32(0), u32(7), u32(0), u32(10), bytes.Repeat([]byte{41}, 32), pa.Bytes(), bb)
	key, err := ynxpq.DecodePubKey(wire)
	if err != nil {
		t.Fatal(err)
	}
	pinned := bytes.Clone(wire)
	authority := ynxpq.AuthorizerFunc(func(binding []byte, h int64, r int32, k ynxpq.Kind) error {
		if !bytes.Equal(binding, pinned) || h < 10 || h >= 20 || r < 0 || k < ynxpq.Proposal || k > ynxpq.VoteExtension {
			return errors.New("outside pinned historical authority")
		}
		return nil
	})
	return fixture{key: key.WithAuthorizer(authority), wire: wire, a: a, b: &b, authority: authority}
}
func (f fixture) sign(t *testing.T, message []byte) []byte {
	t.Helper()
	a := make([]byte, ynxpq.MLDSA87SignatureSize)
	if err := mldsa87.SignTo(f.a, message, nil, false, a); err != nil {
		t.Fatal(err)
	}
	b, err := slhdsa.SignRandomized(f.b, rand.Reader, slhdsa.NewMessage(message), nil)
	if err != nil {
		t.Fatal(err)
	}
	wire := append([]byte(nil), []byte("YNX-CONSENSUS-SIG/v0.2\x00")...)
	wire = binary.BigEndian.AppendUint32(wire, 2)
	wire = binary.BigEndian.AppendUint64(wire, 7)
	wire = binary.BigEndian.AppendUint32(wire, 1)
	wire = append(wire, fields(a)...)
	wire = binary.BigEndian.AppendUint32(wire, 2)
	wire = append(wire, fields(b)...)
	if len(wire) != ynxpq.EnvelopeSize {
		t.Fatalf("wrong envelope size %d", len(wire))
	}
	return wire
}
func (f fixture) vote() *types.Vote {
	return &types.Vote{Type: cmtproto.PrecommitType, Height: 10, Round: 2, BlockID: types.BlockID{Hash: bytes.Repeat([]byte{9}, 32), PartSetHeader: types.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{8}, 32)}}, Timestamp: time.Date(2026, 10, 18, 1, 2, 3, 123, time.UTC), ValidatorAddress: f.key.Address(), ValidatorIndex: 0, Extension: []byte("actual extension")}
}
func (f fixture) signVote(t *testing.T, v *types.Vote) {
	t.Helper()
	msg, err := f.key.OrdinarySigningBytes(types.VoteSignBytes("ynx-engine-test", v.ToProto()))
	if err != nil {
		t.Fatal(err)
	}
	v.Signature = f.sign(t, msg)
	msg, err = f.key.ExtensionSigningBytes("ynx-engine-test", v.ToProto())
	if err != nil {
		t.Fatal(err)
	}
	v.ExtensionSignature = f.sign(t, msg)
}

func TestRealDualSignaturesThroughVoteCommitProposalAndExtension(t *testing.T) {
	f := newFixture(t)
	v := f.vote()
	f.signVote(t, v)
	if err := v.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if err := v.VerifyVoteAndExtension("ynx-engine-test", f.key); err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{len(v.Signature) - 1, len("YNX-CONSENSUS-SIG/v0.2\x00") + 4 + 8 + 4 + 4} {
		bad := v.Copy()
		bad.Signature = bytes.Clone(v.Signature)
		bad.Signature[offset] ^= 1
		if err := bad.Verify("ynx-engine-test", f.key); err == nil {
			t.Fatal("one invalid algorithm branch accepted")
		}
	}
	if err := v.Verify("other-chain", f.key); err == nil {
		t.Fatal("wrong chain accepted")
	}
	wrongAddress := v.Copy()
	wrongAddress.ValidatorAddress = bytes.Repeat([]byte{5}, 20)
	if err := wrongAddress.Verify("ynx-engine-test", f.key); err == nil {
		t.Fatal("wrong actual validator accepted")
	}
	wrongIndex := v.Copy()
	wrongIndex.ValidatorIndex = -1
	if err := wrongIndex.Verify("ynx-engine-test", f.key); err == nil {
		t.Fatal("unsigned negative index bypassed full vote admission")
	}
	badBlock := v.Copy()
	badBlock.BlockID.Hash = bytes.Repeat([]byte{7}, 32)
	if err := badBlock.VerifyExtension("ynx-engine-test", f.key); err == nil {
		t.Fatal("extension not bound to ordinary block ID")
	}
	if f.key.VerifySignature(types.VoteExtensionSignBytes("ynx-engine-test", v.ToProto()), v.ExtensionSignature) {
		t.Fatal("stock extension bytes authorized without full vote")
	}

	set := types.NewValidatorSet([]*types.Validator{types.NewValidator(f.key, 10)})
	commit := &types.Commit{Height: v.Height, Round: v.Round, BlockID: v.BlockID, Signatures: []types.CommitSig{{BlockIDFlag: types.BlockIDFlagCommit, ValidatorAddress: v.ValidatorAddress, Timestamp: v.Timestamp, Signature: v.Signature}}}
	if err := commit.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if err := set.VerifyCommit("ynx-engine-test", v.BlockID, v.Height, commit); err != nil {
		t.Fatal(err)
	}
	// Existing block limits stay fixed; actual lastCommit bytes reduce tx space.
	budget, err := types.MaxDataBytesForCommit(1<<20, 0, 1, commit)
	if err != nil {
		t.Fatal(err)
	}
	want := (1 << 20) - types.MaxOverheadForBlock - types.MaxHeaderBytes - int64(commit.ToProto().Size())
	if budget != want || budget >= types.MaxDataBytes(1<<20, 0, 1) {
		t.Fatalf("PQ commit underbudgeted: %d != %d", budget, want)
	}
	if _, err := types.MaxDataBytesForCommit(1000, 0, 1, commit); err == nil {
		t.Fatal("oversize commit silently accepted")
	}

	p := types.NewProposal(10, 2, -1, v.BlockID)
	canonical := types.ProposalSignBytes("ynx-engine-test", p.ToProto())
	msg, err := f.key.OrdinarySigningBytes(canonical)
	if err != nil {
		t.Fatal(err)
	}
	p.Signature = f.sign(t, msg)
	if err := p.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if !f.key.VerifySignature(canonical, p.Signature) {
		t.Fatal("actual proposal bytes rejected")
	}
	if !p.VerifySignature("ynx-engine-test", f.key) {
		t.Fatal("actual proposal caller rejected")
	}
	wrongType := *p
	wrongType.Type = cmtproto.PrevoteType
	if wrongType.VerifySignature("ynx-engine-test", f.key) {
		t.Fatal("proposal canonicalization erased invalid actual type")
	}
	if f.key.VerifySignature(types.VoteSignBytes("ynx-engine-test", v.ToProto()), p.Signature) {
		t.Fatal("proposal/vote substitution accepted")
	}
}

func TestAuthoritySerializationAndHistoryStayFailClosed(t *testing.T) {
	f := newFixture(t)
	v := f.vote()
	f.signVote(t, v)
	raw, err := ynxpq.DecodePubKey(f.wire)
	if err != nil {
		t.Fatal(err)
	}
	if err := v.Verify("ynx-engine-test", raw); err == nil {
		t.Fatal("decoded peer key acquired authority")
	}
	wireCopy := raw.Bytes()
	wireCopy[len(wireCopy)-1] ^= 1
	addressCopy := raw.Address()
	addressCopy[0] ^= 1
	if !bytes.Equal(raw.Bytes(), f.wire) || !bytes.Equal(raw.Address(), f.key.Address()) {
		t.Fatal("public output aliases immutable key")
	}
	p, err := cryptoenc.PubKeyToProto(f.key)
	if err != nil {
		t.Fatal(err)
	}
	pbytes, err := p.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if len(pbytes) != p.Size() {
		t.Fatal("proto size mismatch")
	}
	var p2 = p
	p2.Reset()
	if err := p2.Unmarshal(pbytes); err != nil {
		t.Fatal(err)
	}
	if !p.Equal(&p2) || p.Compare(&p2) != 0 {
		t.Fatal("oneof comparison did not round trip")
	}
	back, err := cryptoenc.PubKeyFromProto(p2)
	if err != nil {
		t.Fatal(err)
	}
	if !back.Equals(f.key) || v.Verify("ynx-engine-test", back) == nil {
		t.Fatal("proto changed bytes or transported authority")
	}
	var boxed crypto.PubKey = f.key
	j, err := cmtjson.Marshal(boxed)
	if err != nil {
		t.Fatal(err)
	}
	var decoded crypto.PubKey
	if err := cmtjson.Unmarshal(j, &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.Equals(f.key) || v.Verify("ynx-engine-test", decoded) == nil {
		t.Fatal("JSON changed identity or transported authority")
	}

	set := types.NewValidatorSet([]*types.Validator{types.NewValidator(raw, 10)})
	before := bytes.Clone(set.Hash())
	bound, err := set.WithConsensusAuthorizer(f.authority)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, bound.Hash()) || v.Verify("ynx-engine-test", set.Validators[0].PubKey) == nil || v.Verify("ynx-engine-test", bound.Validators[0].PubKey) != nil {
		t.Fatal("detached authorizer leaked or changed validator hash")
	}
	if v.Verify("ynx-engine-test", set.GetProposer().PubKey) == nil {
		t.Fatal("detached authorizer leaked through proposer alias")
	}
	if _, err := set.WithConsensusAuthorizer(nil); err == nil {
		t.Fatal("nil authority attached")
	}
	// A correctly signed future/revoked vote still fails trusted historical policy.
	v.Height = 20
	f.signVote(t, v)
	if err := v.Verify("ynx-engine-test", f.key); err == nil {
		t.Fatal("revoked height accepted")
	}
	v.Height = 9
	f.signVote(t, v)
	if err := v.Verify("ynx-engine-test", f.key); err == nil {
		t.Fatal("preactivation height accepted")
	}
	v.Height = 10
	f.signVote(t, v)
	if err := v.Verify("ynx-engine-test", f.key); err != nil {
		t.Fatal("later revocation rewrote historical validity")
	}

	for _, bad := range [][]byte{f.wire[:len(f.wire)-1], append(bytes.Clone(f.wire), 0)} {
		if _, err := ynxpq.DecodePubKey(bad); err == nil {
			t.Fatal("noncanonical full key accepted")
		}
	}
	// Change genesis while retaining the same actual PQ keys/address. A valid
	// signature for the old genesis must not transfer to this complete new key.
	altered := bytes.Clone(f.wire)
	genesisOffset := 4 + len("YNX-CONSENSUS-LOGICAL-PUBKEY/v1\x00") + 4 + 4 + 4
	altered[genesisOffset] ^= 1
	wrong, err := ynxpq.DecodePubKey(altered)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(types.NewValidator(wrong, 10).Bytes(), types.NewValidator(raw, 10).Bytes()) {
		t.Fatal("validator hash omitted full genesis binding")
	}
	if err := v.Verify("ynx-engine-test", wrong.WithAuthorizer(f.authority)); err == nil {
		t.Fatal("unregistered genesis binding accepted")
	}
	otherGenesisAuthority := ynxpq.AuthorizerFunc(func(w []byte, h int64, r int32, k ynxpq.Kind) error {
		if !bytes.Equal(w, altered) || h != 10 {
			return errors.New("wrong alternate test anchor")
		}
		return nil
	})
	if err := v.Verify("ynx-engine-test", wrong.WithAuthorizer(otherGenesisAuthority)); err == nil {
		t.Fatal("signature crossed independently authorized genesis domains")
	}
	for _, bad := range [][]byte{v.Signature[:len(v.Signature)-1], append(bytes.Clone(v.Signature), 0)} {
		if ynxpq.ValidateEnvelope(bad) == nil {
			t.Fatal("truncated/trailing envelope accepted")
		}
	}
	epochChanged := bytes.Clone(v.Signature)
	epochChanged[len("YNX-CONSENSUS-SIG/v0.2\x00")+4+7] ^= 1
	if f.key.VerifySignature(types.VoteSignBytes("ynx-engine-test", v.ToProto()), epochChanged) {
		t.Fatal("wrong envelope epoch accepted")
	}
	canonical := types.VoteSignBytes("ynx-engine-test", v.ToProto())
	if f.key.VerifySignature(append(bytes.Clone(canonical), 0), v.Signature) {
		t.Fatal("trailing canonical bytes accepted")
	}
}

func TestLegacySignatureAndStrictSizeRulesUnchanged(t *testing.T) {
	legacy := ed25519.GenPrivKey()
	v := &types.Vote{Type: cmtproto.PrevoteType, Height: 1, Round: 0, Timestamp: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), ValidatorAddress: legacy.PubKey().Address(), ValidatorIndex: 0}
	var err error
	v.Signature, err = legacy.Sign(types.VoteSignBytes("legacy", v.ToProto()))
	if err != nil {
		t.Fatal(err)
	}
	if err = v.ValidateBasic(); err != nil {
		t.Fatal(err)
	}
	if err = v.Verify("legacy", legacy.PubKey()); err != nil {
		t.Fatal(err)
	}
	if types.MaxSignatureSize != 64 || types.MaxCommitSigBytes != 109 {
		t.Fatal("legacy limits rewritten")
	}
	budget, err := types.MaxDataBytesForCommit(1<<20, 0, 1, nil)
	if err != nil || budget != types.MaxDataBytes(1<<20, 0, 1) {
		t.Fatal("legacy transaction budget changed")
	}
	v.Signature = bytes.Repeat([]byte{1}, ynxpq.EnvelopeSize)
	if err = v.ValidateBasic(); err == nil {
		t.Fatal("arbitrary oversized signature admitted")
	}
	v.Signature = bytes.Repeat([]byte{1}, 65)
	if err = v.ValidateBasic(); err == nil {
		t.Fatal("legacy signature size limit relaxed")
	}
}
