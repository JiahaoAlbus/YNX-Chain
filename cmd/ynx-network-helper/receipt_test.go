package main_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/receipt"
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/tmhash"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmtversion "github.com/cometbft/cometbft/proto/tendermint/version"
	"github.com/cometbft/cometbft/types"
	"github.com/cometbft/cometbft/version"
)

// Every signature uses newly generated fixture keys; no network or real signer
// is started. The consensus signature library and Merkle proof are genuine.
type fixture struct {
	now    time.Time
	chain  receipt.ChainRef
	keys   []types.PrivValidator
	vals   *types.ValidatorSet
	anchor *receipt.TrustAnchor
	doc    receipt.AnchorDocument
	raw    []byte
	pin    string
	proof  receipt.ChainProof
	txID   string
}

func newFixture(t *testing.T, powers ...int64) fixture {
	t.Helper()
	if len(powers) == 0 {
		powers = []int64{1, 1, 1, 1}
	}
	f := fixture{now: time.Date(2026, 10, 31, 9, 0, 0, 0, time.UTC),
		chain: receipt.ChainRef{hex.EncodeToString(tmhash.Sum([]byte("isolated fixture genesis"))), "p09-isolated-fixture"}}
	vals := make([]*types.Validator, 0, len(powers))
	for _, power := range powers {
		key := types.NewMockPV()
		pub, _ := key.GetPubKey()
		vals = append(vals, types.NewValidator(pub, power))
		f.keys = append(f.keys, key)
	}
	f.vals = types.NewValidatorSet(vals)
	txs := types.Txs{types.Tx("fixture-other"), types.Tx("fixture-test-transfer-member-0")}
	trusted := f.block(t, 10, f.now.Add(-2*time.Minute), txs, types.BlockID{})
	f.doc = receipt.AnchorDocument{"cometbft-v0.38", f.chain, f.now.Add(time.Hour), trusted}
	f.raw, _ = cmtjson.Marshal(f.doc)
	pin := sha256.Sum256(f.raw)
	f.pin = hex.EncodeToString(pin[:])
	var err error
	f.anchor, err = receipt.ImportTrustAnchor(f.raw, f.pin, "independent fixture operator", f.now)
	if err != nil {
		t.Fatal(err)
	}
	lb := f.block(t, 11, f.now.Add(-time.Minute), txs, trusted.Commit.BlockID)
	proof := txs.Proof(1)
	f.txID = hex.EncodeToString(txs[1].Hash())
	f.proof = receipt.ChainProof{Source: "fixture RPC", Chain: f.chain, Height: "11", Header: lb, Inclusion: &proof, TxIndex: "1", Member: "0", Event: "0"}
	return f
}

func (f fixture) block(t *testing.T, height int64, when time.Time, txs types.Txs, previous types.BlockID) *types.LightBlock {
	t.Helper()
	header := &types.Header{Version: cmtversion.Consensus{Block: version.BlockProtocol}, ChainID: f.chain.ChainID,
		Height: height, Time: when, LastBlockID: previous, LastCommitHash: tmhash.Sum([]byte("last commit")),
		DataHash: txs.Hash(), ValidatorsHash: f.vals.Hash(), NextValidatorsHash: f.vals.Hash(),
		ConsensusHash: tmhash.Sum([]byte("params")), AppHash: tmhash.Sum([]byte(fmt.Sprint("snapshot", height-1))),
		LastResultsHash: tmhash.Sum([]byte("results")), EvidenceHash: tmhash.Sum(nil), ProposerAddress: f.vals.Proposer.Address}
	id := types.BlockID{Hash: header.Hash(), PartSetHeader: types.PartSetHeader{Total: 1, Hash: tmhash.Sum([]byte("parts"))}}
	commit := &types.Commit{Height: height, Round: 0, BlockID: id, Signatures: make([]types.CommitSig, len(f.vals.Validators))}
	for _, key := range f.keys {
		pub, _ := key.GetPubKey()
		idx, _ := f.vals.GetByAddress(pub.Address())
		vote := (&types.Vote{Type: cmtproto.PrecommitType, Height: height, BlockID: id, Timestamp: when,
			ValidatorAddress: pub.Address(), ValidatorIndex: idx}).ToProto()
		if err := key.SignVote(f.chain.ChainID, vote); err != nil {
			t.Fatal(err)
		}
		commit.Signatures[idx] = types.CommitSig{BlockIDFlag: types.BlockIDFlagCommit, ValidatorAddress: pub.Address(), Timestamp: when, Signature: vote.Signature}
	}
	return &types.LightBlock{SignedHeader: &types.SignedHeader{Header: header, Commit: commit}, ValidatorSet: f.vals}
}

func cloneProof(t *testing.T, proof receipt.ChainProof) receipt.ChainProof {
	t.Helper()
	raw, err := cmtjson.Marshal(proof)
	if err != nil {
		t.Fatal(err)
	}
	var out receipt.ChainProof
	if err := cmtjson.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestP0902ProofLevels(t *testing.T) {
	f := newFixture(t)
	cases := []struct {
		name          string
		edit          func(*receipt.ChainProof)
		anchor        *receipt.TrustAnchor
		level, reason string
	}{
		{"RPC never trusts its own successful events", func(p *receipt.ChainProof) {
			p.Header = nil
			p.StateProof = json.RawMessage(`{"success":true,"level":"STATE_VERIFIED","code":0}`)
		}, nil, receipt.RPCOnly, "NOT_SUPPLIED"},
		{"trusted header only", func(p *receipt.ChainProof) { p.Inclusion = nil }, f.anchor, receipt.HeaderVerified, "NOT_SUPPLIED"},
		{"genuine transaction inclusion", func(p *receipt.ChainProof) {}, f.anchor, receipt.InclusionVerified, "UNSUPPORTED"},
		{"bare state success cannot authenticate member", func(p *receipt.ChainProof) {
			p.Member = "999"
			p.StateProof = json.RawMessage(`{"member":"999","success":true}`)
		}, f.anchor, receipt.InclusionVerified, "UNSUPPORTED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			proof := cloneProof(t, f.proof)
			tc.edit(&proof)
			v := receipt.VerifyNetworkReceipt(f.txID, tc.anchor, proof, f.now)
			if v.Level != tc.level || v.Reason != tc.reason || v.MemberVerified || v.ExecutionVerified {
				t.Fatalf("unexpected view: %+v", v)
			}
		})
	}
}

func TestP0902RejectFalseProofs(t *testing.T) {
	f := newFixture(t)
	cases := []struct {
		name  string
		edit  func(*receipt.ChainProof)
		level string
	}{
		{"same chain id wrong genesis", func(p *receipt.ChainProof) { p.Chain.Genesis = strings.Repeat("f", 64) }, receipt.RPCOnly},
		{"wrong chain", func(p *receipt.ChainProof) { p.Chain.ChainID = "fake" }, receipt.RPCOnly},
		{"wrong height", func(p *receipt.ChainProof) { p.Height = "12" }, receipt.RPCOnly},
		{"wrong validator set", func(p *receipt.ChainProof) { p.Header.ValidatorSet.Validators[0].VotingPower++ }, receipt.RPCOnly},
		{"wrong commit signature", func(p *receipt.ChainProof) {
			for i := range p.Header.Commit.Signatures {
				p.Header.Commit.Signatures[i].Signature[0] ^= 1
			}
		}, receipt.RPCOnly},
		{"half voting power", func(p *receipt.ChainProof) {
			p.Header.Commit.Signatures[0] = types.NewCommitSigAbsent()
			p.Header.Commit.Signatures[1] = types.NewCommitSigAbsent()
		}, receipt.RPCOnly},
		{"wrong transaction bytes", func(p *receipt.ChainProof) { p.Inclusion.Data = types.Tx("forged") }, receipt.HeaderVerified},
		{"wrong transaction index", func(p *receipt.ChainProof) { p.TxIndex = "0" }, receipt.HeaderVerified},
		{"forged merkle root", func(p *receipt.ChainProof) { p.Inclusion.RootHash[0] ^= 1 }, receipt.HeaderVerified},
		{"empty inclusion", func(p *receipt.ChainProof) { p.Inclusion = &types.TxProof{} }, receipt.HeaderVerified},
		{"malformed light block", func(p *receipt.ChainProof) { p.Header.SignedHeader = nil }, receipt.RPCOnly},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			proof := cloneProof(t, f.proof)
			tc.edit(&proof)
			v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, proof, f.now)
			if v.Level != tc.level || v.Reason != "BAD_PROOF" {
				t.Fatalf("unexpected view: %+v", v)
			}
		})
	}
	if v := receipt.VerifyNetworkReceipt(strings.Repeat("f", 64), f.anchor, f.proof, f.now); v.Level != receipt.HeaderVerified || v.Reason != "BAD_PROOF" {
		t.Fatalf("wrong requested tx: %+v", v)
	}
	if v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, f.proof, f.doc.TrustUntil); v.Level != receipt.RPCOnly || v.Reason != "EXPIRED" {
		t.Fatalf("expired: %+v", v)
	}
}

func TestP0902VotingPowerAndTrustContinuity(t *testing.T) {
	t.Run("exact two thirds rejected", func(t *testing.T) {
		f := newFixture(t, 1, 1, 1)
		f.proof.Header.Commit.Signatures[0] = types.NewCommitSigAbsent()
		if v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, f.proof, f.now); v.Level != receipt.RPCOnly {
			t.Fatalf("accepted two thirds: %+v", v)
		}
	})
	t.Run("weight rather than device count", func(t *testing.T) {
		f := newFixture(t, 7, 1, 1, 1)
		for i := 1; i < 4; i++ {
			f.proof.Header.Commit.Signatures[i] = types.NewCommitSigAbsent()
		}
		if v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, f.proof, f.now); v.Level != receipt.InclusionVerified {
			t.Fatalf("70 percent rejected: %+v", v)
		}
	})
	t.Run("nonadjacent header", func(t *testing.T) {
		f := newFixture(t)
		txs := types.Txs{f.proof.Inclusion.Data}
		f.proof.Header = f.block(t, 15, f.now.Add(-time.Second), txs, types.BlockID{})
		p := txs.Proof(0)
		f.proof.Inclusion = &p
		f.proof.Height = "15"
		f.proof.TxIndex = "0"
		if v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, f.proof, f.now); v.Level != receipt.InclusionVerified {
			t.Fatalf("nonadjacent rejected: %+v", v)
		}
	})
	t.Run("RPC self signed fork cannot replace anchor", func(t *testing.T) {
		f := newFixture(t)
		fake := newFixture(t)
		if v := receipt.VerifyNetworkReceipt(fake.txID, f.anchor, fake.proof, f.now); v.Level != receipt.RPCOnly {
			t.Fatalf("fake RPC accepted: %+v", v)
		}
	})
}

func TestP0901IndependentAnchorRequired(t *testing.T) {
	f := newFixture(t)
	for _, tc := range []struct {
		name, pin, source string
		now               time.Time
	}{
		{"no independently supplied pin", "", "operator", f.now},
		{"wrong independently supplied pin", strings.Repeat("f", 64), "operator", f.now},
		{"source label alone is insufficient", "", "RPC says trusted", f.now},
		{"no independent source", f.pin, "", f.now},
		{"expired", f.pin, "operator", f.doc.TrustUntil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := receipt.ImportTrustAnchor(f.raw, tc.pin, tc.source, tc.now); err == nil {
				t.Fatal("untrusted anchor accepted")
			}
		})
	}
	doc := f.doc
	doc.Version = "unknown-pq-fork"
	raw, _ := cmtjson.Marshal(doc)
	pin := sha256.Sum256(raw)
	if _, err := receipt.ImportTrustAnchor(raw, hex.EncodeToString(pin[:]), "operator", f.now); err == nil {
		t.Fatal("unsupported consensus suite accepted")
	}
}

func TestP0902MalformedCryptoFailsClosed(t *testing.T) {
	f := newFixture(t)
	for _, tc := range []struct {
		name string
		edit func(*types.ValidatorSet)
	}{
		{"short key", func(v *types.ValidatorSet) { v.Validators[0].PubKey = ed25519.PubKey{1} }},
		{"nil validator", func(v *types.ValidatorSet) { v.Validators[0] = nil }},
		{"nil proposer", func(v *types.ValidatorSet) { v.Proposer = nil }},
		{"excessive weight", func(v *types.ValidatorSet) { v.Validators[0].VotingPower = types.MaxTotalVotingPower }},
		{"zero weight", func(v *types.ValidatorSet) { v.Validators[0].VotingPower = 0 }},
		{"duplicate validator", func(v *types.ValidatorSet) { v.Validators[1] = v.Validators[0] }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proof := cloneProof(t, f.proof)
			tc.edit(proof.Header.ValidatorSet)
			v := receipt.VerifyNetworkReceipt(f.txID, f.anchor, proof, f.now)
			if v.Level != receipt.RPCOnly || v.Reason != "BAD_PROOF" {
				t.Fatalf("malformed proof accepted: %+v", v)
			}
			// Even an independently pinned malformed file must fail closed.
			doc := f.doc
			doc.LightBlock = proof.Header
			raw, err := cmtjson.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			pin := sha256.Sum256(raw)
			if _, err := receipt.ImportTrustAnchor(raw, hex.EncodeToString(pin[:]), "fixture operator", f.now); err == nil {
				t.Fatal("malformed checkpoint accepted")
			}
		})
	}
}
