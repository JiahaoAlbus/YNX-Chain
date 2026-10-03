package cometadapter

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	core "github.com/JiahaoAlbus/YNX-Chain/internal/chaincrypto"
	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	proto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/cometbft/cometbft/types"
	"testing"
	"time"
)

func network() core.Network {
	return core.Network{ChainID: 6423, ConsensusID: "isolated-comet-vector", Genesis: [32]byte{1}}
}
func block() proto.BlockID {
	return proto.BlockID{Hash: bytes.Repeat([]byte{1}, 32), PartSetHeader: proto.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{2}, 32)}}
}
func vote(i byte) *proto.Vote {
	return &proto.Vote{Type: proto.PrecommitType, Height: 20, Round: 2, BlockID: block(), Timestamp: time.Unix(100, int64(i)).UTC(), ValidatorAddress: append([]byte{i}, make([]byte, 19)...), ValidatorIndex: int32(i - 1)}
}
func signed(t *testing.T, i byte) (core.Validator, SignedCandidateVote) {
	t.Helper()
	pub, priv, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	pq, sk, e := mldsa87.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	v := vote(i)
	m, e := WrapVote(network(), [20]byte{i}, 1, v)
	if e != nil {
		t.Fatal(e)
	}
	raw, e := m.CanonicalBytes()
	if e != nil {
		t.Fatal(e)
	}
	ps := make([]byte, mldsa87.SignatureSize)
	if e = mldsa87.SignTo(sk, raw, []byte(core.ConsensusContext), true, ps); e != nil {
		t.Fatal(e)
	}
	return core.Validator{ID: [20]byte{i}, KeyVersion: 1, Power: 1, Keys: core.PublicKeys{Classical: pub, PostQuantum: pq.Bytes()}}, SignedCandidateVote{v, core.Signatures{Classical: ed25519.Sign(priv, raw), PostQuantum: ps}}
}
func TestExactOfficialSignBytes(t *testing.T) {
	v := vote(1)
	m, e := WrapVote(network(), [20]byte{1}, 1, v)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(m.OriginalSignBytes, types.VoteSignBytes(network().ConsensusID, v)) {
		t.Fatal("official vote mismatch")
	}
	p := &proto.Proposal{Type: proto.ProposalType, Height: 20, Round: 2, PolRound: 1, BlockID: block(), Timestamp: v.Timestamp}
	pm, e := WrapProposal(network(), [20]byte{1}, 1, p)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Equal(pm.OriginalSignBytes, types.ProposalSignBytes(network().ConsensusID, p)) {
		t.Fatal("official proposal mismatch")
	}
	before := append([]byte(nil), pm.OriginalSignBytes...)
	p.PolRound = 0
	p.BlockID.Hash[0] ^= 1
	if !bytes.Equal(before, pm.OriginalSignBytes) {
		t.Fatal("caller alias")
	}
	if _, e = WrapVote(network(), [20]byte{1}, 1, &proto.Vote{}); e == nil {
		t.Fatal("malformed accepted")
	}
	v.Extension = []byte{1}
	if _, e = WrapVote(network(), [20]byte{1}, 1, v); e == nil {
		t.Fatal("unsupported extension stripped")
	}
}
func TestActualDualQuorumDistinctTimestamps(t *testing.T) {
	set := make([]core.Validator, 4)
	votes := make([]SignedCandidateVote, 4)
	for i := range set {
		set[i], votes[i] = signed(t, byte(i+1))
	}
	verify := func(in []SignedCandidateVote) error {
		return VerifyCommitCandidate(core.CIRCLProvider{}, network(), set, in, 20, 2, block())
	}
	if e := verify(votes[:3]); e != nil {
		t.Fatal(e)
	}
	cases := []struct {
		name   string
		mutate func() []SignedCandidateVote
	}{
		{"insufficient", func() []SignedCandidateVote { return votes[:2] }},
		{"duplicate", func() []SignedCandidateVote { return []SignedCandidateVote{votes[0], votes[0], votes[2]} }},
		{"timestamp", func() []SignedCandidateVote {
			r := append([]SignedCandidateVote(nil), votes[:3]...)
			v := *r[0].Vote
			v.Timestamp = v.Timestamp.Add(time.Nanosecond)
			r[0].Vote = &v
			return r
		}},
		{"different-block", func() []SignedCandidateVote {
			r := append([]SignedCandidateVote(nil), votes[:3]...)
			v := *r[0].Vote
			v.BlockID = block()
			v.BlockID.Hash[0] = 8
			r[0].Vote = &v
			return r
		}},
		{"pq-half", func() []SignedCandidateVote {
			r := append([]SignedCandidateVote(nil), votes[:3]...)
			r[0].Signatures.PostQuantum = append([]byte(nil), r[0].Signatures.PostQuantum...)
			r[0].Signatures.PostQuantum[0] ^= 1
			return r
		}},
		{"ed-half", func() []SignedCandidateVote {
			r := append([]SignedCandidateVote(nil), votes[:3]...)
			r[0].Signatures.Classical = append([]byte(nil), r[0].Signatures.Classical...)
			r[0].Signatures.Classical[0] ^= 1
			return r
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if e := verify(c.mutate()); e == nil {
				t.Fatal("invalid commit accepted")
			}
		})
	}
	n := network()
	n.Genesis[0] = 9
	if VerifyCommitCandidate(core.CIRCLProvider{}, n, set, votes[:3], 20, 2, block()) == nil {
		t.Fatal("foreign genesis")
	}
}

type pauseProvider struct {
	core.CIRCLProvider
	entered chan struct{}
	release chan struct{}
	first   bool
}

func (p *pauseProvider) VerifyConsensus(k core.PublicKeys, b []byte, s core.Signatures) error {
	if !p.first {
		p.first = true
		close(p.entered)
		<-p.release
	}
	return p.CIRCLProvider.VerifyConsensus(k, b, s)
}
func TestSnapshotAllVotesBeforeProvider(t *testing.T) {
	set := make([]core.Validator, 4)
	votes := make([]SignedCandidateVote, 3)
	for i := range set {
		v, s := signed(t, byte(i+1))
		set[i] = v
		if i < 3 {
			votes[i] = s
		}
	}
	p := &pauseProvider{entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan error, 1)
	go func() { done <- VerifyCommitCandidate(p, network(), set, votes, 20, 2, block()) }()
	<-p.entered
	votes[2].Vote.Timestamp = votes[2].Vote.Timestamp.Add(time.Second)
	votes[2].Signatures.Classical[0] ^= 1
	set[2].Keys.PostQuantum[0] ^= 1
	close(p.release)
	if e := <-done; e != nil {
		t.Fatal("snapshotted original failed", e)
	}
}
