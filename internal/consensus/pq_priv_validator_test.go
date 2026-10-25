//go:build unix

package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type pqPVTestSource struct {
	app      *Application
	override *PQEngineSnapshot
	err      error
}

func (s *pqPVTestSource) CommittedPQEngineSnapshot() (*PQEngineSnapshot, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.override != nil {
		return s.override, nil
	}
	return s.app.CommittedPQEngineSnapshot()
}

type pqPVFixture struct {
	f             *validatorRegistryFixture
	app           *Application
	source        *pqPVTestSource
	keys          []*ynxconsensusauth.CandidateKey
	signers       []*ynxconsensusauth.Signer
	pvs           []*PQPrivValidator
	schedule      *PQEngineSchedule
	authorization *PQEngineAuthorization
	path          string
	signerPaths   []string
}

func newPQPVFixture(t *testing.T, extensions bool) *pqPVFixture {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	if extensions {
		f.doc.ConsensusParams.ABCI.VoteExtensionsEnableHeight = f.doc.InitialHeight + 4
		var err error
		f.raw, err = cmtjson.Marshal(f.doc)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(f.raw)
		f.pins.CometGenesisSHA256 = hex.EncodeToString(sum[:])
		f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
		if err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(t.TempDir(), "committed.json")
	app := newPinnedRegistryApp(t, f, path)
	q := &pqPVFixture{f: f, app: app, source: &pqPVTestSource{app: app}, path: path}
	var transactions [][]byte
	for _, member := range f.bootstrap.record.Members {
		key, pa, pb, err := ynxconsensusauth.GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(key.Destroy)
		q.keys = append(q.keys, key)
		i := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ValidatorAddress: bytes.Clone(member.Address), Sequence: 1, Epoch: 1, ApprovedAt: f.doc.InitialHeight, EffectiveAt: f.doc.InitialHeight + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: pa, SLHDSASHA2256fPublicKey: pb}
		a, b, err := key.RegistrationPossession(i)
		if err != nil {
			t.Fatal(err)
		}
		message, err := i.AuthoritySigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		wire, err := (ynxconsensusauth.Registration{Intent: i, LegacyApproval: ed25519.Sign(f.legacy[string(member.Address)], message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
		if err != nil {
			t.Fatal(err)
		}
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		transactions = append(transactions, tx)
	}
	response, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: transactions})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range response.TxResults {
		if result.Code != 0 {
			t.Fatal(result.Log)
		}
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	q.schedule, err = NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, app.committed.Height, app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(q.schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := q.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	q.authorization, err = NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	q.app, err = NewPersistentApplicationWithEngineAuthorization(f.migration, path, f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	q.source.app = q.app
	registry, err := NewPQCommittedSignerRegistry(q.source, q.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	policy := ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ActivationHeight: q.schedule.ActivationHeight}
	for index, key := range q.keys {
		statePath := filepath.Join(t.TempDir(), "signer.json")
		signer, err := ynxconsensusauth.CreateSigner(statePath, key, policy, registry, f.bootstrap.record.Members[index].Address, 1)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { signer.Close() })
		pv, err := NewPQPrivValidator(signer, q.source)
		if err != nil {
			t.Fatal(err)
		}
		q.signerPaths = append(q.signerPaths, statePath)
		q.signers = append(q.signers, signer)
		q.pvs = append(q.pvs, pv)
	}
	return q
}

func (q *pqPVFixture) advance(t *testing.T, through int64) {
	t.Helper()
	for q.app.committed.Height < through {
		h := q.app.committed.Height + 1
		s, err := q.app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		hash, err := s.ExpectedValidatorHash(h + 1)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = q.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: h, NextValidatorsHash: hash}); err != nil {
			t.Fatal(err)
		}
		if _, err = q.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
	}
}

// The test owns this actual engine round set and advances its priorities. The
// adapter receives this object rather than reconstructing a proposer itself.
func (q *pqPVFixture) context(t *testing.T, round int32) (*cmttypes.ValidatorSet, int) {
	t.Helper()
	s, err := q.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	set, err := s.expectedMembersAt(s.through + 1)
	if err != nil {
		t.Fatal(err)
	}
	set.IncrementProposerPriority(round + 1)
	proposer := -1
	for i, pv := range q.pvs {
		if err = pv.SetConsensusSigningContext(q.f.doc.ChainID, s.through+1, round, set); err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(set.Proposer.Address, q.f.bootstrap.record.Members[i].Address) {
			proposer = i
		}
	}
	if proposer < 0 {
		t.Fatal("missing fixture proposer")
	}
	return set, proposer
}

func pqPVVote(q *pqPVFixture, set *cmttypes.ValidatorSet, owner int, round int32) *cmtproto.Vote {
	address := q.f.bootstrap.record.Members[owner].Address
	index, _ := set.GetByAddress(address)
	return &cmtproto.Vote{Type: cmtproto.PrecommitType, Height: q.app.committed.Height + 1, Round: round, ValidatorAddress: bytes.Clone(address), ValidatorIndex: index, BlockID: cmtproto.BlockID{Hash: bytes.Repeat([]byte{0x31}, 32), PartSetHeader: cmtproto.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{0x32}, 32)}}, Timestamp: time.Date(2026, 10, 18, 4, 5, 6, 7, time.UTC)}
}

func clonePQPVVote(v *cmtproto.Vote) *cmtproto.Vote {
	c := *v
	c.BlockID = copyPQSigningBlock(v.BlockID)
	c.ValidatorAddress, c.Extension = bytes.Clone(v.ValidatorAddress), bytes.Clone(v.Extension)
	c.Signature, c.ExtensionSignature = bytes.Clone(v.Signature), bytes.Clone(v.ExtensionSignature)
	return &c
}

func TestPQPrivValidatorActualForkObjectsAndColdRetry(t *testing.T) {
	q := newPQPVFixture(t, true)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, proposer := q.context(t, 2)
	pv := q.pvs[proposer]
	vote := pqPVVote(q, set, proposer, 2)
	vote.Extension = []byte("complete real application extension")
	proposal := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: vote.Height, Round: vote.Round, PolRound: -1, BlockID: copyPQSigningBlock(vote.BlockID), Timestamp: vote.Timestamp}
	if err := pv.SignProposal(q.f.doc.ChainID, proposal); err != nil {
		t.Fatal(err)
	}
	key, err := pv.GetPubKeyForHeight(q.f.doc.ChainID, vote.Height)
	if err != nil {
		t.Fatal(err)
	}
	fork := key.(ynxpq.PubKey)
	if !fork.VerifyProposal(q.f.doc.ChainID, proposal) {
		t.Fatal("actual fork rejected durable proposal")
	}
	if err = pv.SignVote(q.f.doc.ChainID, vote); err != nil {
		t.Fatal(err)
	}
	if !fork.VerifyVote(q.f.doc.ChainID, vote) || !fork.VerifyVoteExtension(q.f.doc.ChainID, vote) {
		t.Fatal("actual fork rejected ordinary vote or full bound extension")
	}
	wire, err := vote.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	var roundtrip cmtproto.Vote
	if err = roundtrip.Unmarshal(wire); err != nil || !reflect.DeepEqual(vote, &roundtrip) || !fork.VerifyVoteExtension(q.f.doc.ChainID, &roundtrip) {
		t.Fatal("full proto roundtrip failed", err)
	}
	actual, err := cmttypes.VoteFromProto(vote)
	if err != nil || actual.Verify(q.f.doc.ChainID, key) != nil || actual.VerifyExtension(q.f.doc.ChainID, key) != nil {
		t.Fatal("actual types.Vote verification rejected", err)
	}
	for _, field := range []string{"ordinary-A", "ordinary-B", "extension", "block", "chain"} {
		bad := clonePQPVVote(vote)
		chainID := q.f.doc.ChainID
		switch field {
		case "ordinary-A":
			bad.Signature[len(bad.Signature)-ynxconsensusauth.SLHDSASHA2256fSignatureSize-9] ^= 1
		case "ordinary-B":
			bad.Signature[len(bad.Signature)-1] ^= 1
		case "extension":
			bad.Extension[0] ^= 1
		case "block":
			bad.BlockID.Hash[0] ^= 1
		case "chain":
			chainID += "-foreign"
		}
		if field == "extension" {
			if fork.VerifyVoteExtension(chainID, bad) {
				t.Fatal("extension tamper accepted")
			}
		} else if fork.VerifyVote(chainID, bad) {
			t.Fatal("tampered vote accepted:", field)
		}
	}
	original := clonePQPVVote(vote)
	q.signers[proposer].Close()
	registry, err := NewPQCommittedSignerRegistry(q.source, q.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := ynxconsensusauth.ResumeSigner(q.signerPaths[proposer], q.keys[proposer], registry)
	if err != nil {
		t.Fatal(err)
	}
	defer resumed.Close()
	cold, err := NewPQPrivValidator(resumed, q.source)
	if err != nil {
		t.Fatal(err)
	}
	if err = cold.SetConsensusSigningContext(q.f.doc.ChainID, vote.Height, vote.Round, set); err != nil {
		t.Fatal(err)
	}
	vote.Signature, vote.ExtensionSignature = nil, nil
	if err = cold.SignVote(q.f.doc.ChainID, vote); err != nil || !reflect.DeepEqual(vote, original) {
		t.Fatal("cold exact retry changed durable signatures", err)
	}
	bad := clonePQPVVote(original)
	bad.Signature, bad.ExtensionSignature = nil, nil
	bad.Timestamp = bad.Timestamp.Add(time.Nanosecond)
	before := clonePQPVVote(bad)
	if err = cold.SignVote(q.f.doc.ChainID, bad); err == nil || !reflect.DeepEqual(before, bad) {
		t.Fatal("cold double-sign conflict accepted/mutated")
	}
}

func TestPQPrivValidatorMissingStaleAndUntrustedContextsFailWithoutMutation(t *testing.T) {
	q := newPQPVFixture(t, false)
	if _, err := q.pvs[0].GetPubKey(); err == nil {
		t.Fatal("preactivation PQ key exposed as current")
	}
	q.advance(t, q.schedule.ActivationHeight-1)
	set, proposer := q.context(t, 0)
	pv := q.pvs[proposer]
	base := pqPVVote(q, set, proposer, 0)
	for _, test := range []string{"nil-context", "round", "height", "index", "address", "chain", "old-set", "unknown-height", "read-unknown"} {
		t.Run(test, func(t *testing.T) {
			if err := pv.SetConsensusSigningContext(q.f.doc.ChainID, base.Height, 0, set); err != nil {
				t.Fatal(err)
			}
			v := clonePQPVVote(base)
			chainID := q.f.doc.ChainID
			switch test {
			case "nil-context":
				if err := pv.SetConsensusSigningContext(chainID, v.Height, 0, nil); err == nil {
					t.Fatal("nil set accepted")
				}
			case "round":
				v.Round++
			case "height":
				v.Height--
			case "index":
				v.ValidatorIndex++
			case "address":
				v.ValidatorAddress[0] ^= 1
			case "chain":
				chainID += "-wrong"
			case "old-set":
				if err := pv.SetConsensusSigningContext(chainID, v.Height, 0, legacyEngineMembers(q.f.bootstrap)); err == nil {
					t.Fatal("old Ed set accepted")
				}
			case "unknown-height":
				v.Height += 3
			case "read-unknown":
				q.source.err = ynxconsensusauth.ErrSignerDurabilityUncertain
				defer func() { q.source.err = nil }()
			}
			before := clonePQPVVote(v)
			if err := pv.SignVote(chainID, v); err == nil || !reflect.DeepEqual(before, v) {
				t.Fatal("invalid context leaked/changed signature:", err)
			}
		})
	}
	if _, err := pv.GetPubKeyForHeight(q.f.doc.ChainID, base.Height+2); err == nil {
		t.Fatal("unknown future key accepted")
	}
	other := (proposer + 1) % len(q.pvs)
	proposal := &cmtproto.Proposal{Type: cmtproto.ProposalType, Height: base.Height, Round: 0, PolRound: -1, BlockID: copyPQSigningBlock(base.BlockID), Timestamp: base.Timestamp}
	if err := q.pvs[other].SignProposal(q.f.doc.ChainID, proposal); err == nil || len(proposal.Signature) != 0 {
		t.Fatal("non-proposer signed proposal")
	}
	if err := pv.SetConsensusSigningContext(q.f.doc.ChainID, base.Height, 0, set); err != nil {
		t.Fatal(err)
	}
	// Mutation after the setter cannot alter its retained, authenticated view.
	set.Validators[0].VotingPower++
	set.Proposer.Address[0] ^= 1
	if err := pv.SignVote(q.f.doc.ChainID, base); err != nil {
		t.Fatal("setter retained caller-owned set", err)
	}
	if err := pv.SignVote(q.f.doc.ChainID, nil); err == nil {
		t.Fatal("nil vote accepted")
	}
	if err := (*PQPrivValidator)(nil).SignProposal(q.f.doc.ChainID, proposal); err == nil {
		t.Fatal("nil adapter accepted")
	}
}

func TestPQPrivValidatorRollbackAndRealPersistenceFailure(t *testing.T) {
	q := newPQPVFixture(t, false)
	q.advance(t, q.schedule.ActivationHeight-1)
	old, err := q.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	set, _ := q.context(t, 0)
	v := pqPVVote(q, set, 0, 0)
	path := q.signerPaths[0]
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// A real filesystem failure, without fake cryptography or a new signer HRS.
	directory := filepath.Dir(path)
	if err = os.Rename(directory, directory+"-held"); err != nil {
		t.Fatal(err)
	}
	failed := q.pvs[0].SignVote(q.f.doc.ChainID, v)
	restore := os.Rename(directory+"-held", directory)
	if restore != nil {
		t.Fatal(restore)
	}
	if failed == nil || len(v.Signature) != 0 || len(v.ExtensionSignature) != 0 {
		t.Fatal("failed real reservation leaked signature")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("failed reservation rewrote original HRS", err)
	}
	if err = q.pvs[0].SignVote(q.f.doc.ChainID, v); err != nil {
		t.Fatal("exact original retry failed", err)
	}
	q.advance(t, q.schedule.ActivationHeight)
	if _, err = q.pvs[0].GetPubKey(); err != nil {
		t.Fatal(err)
	}
	q.source.override = old
	if _, err = q.pvs[0].GetPubKey(); err == nil {
		t.Fatal("observed committed authority rollback accepted")
	}
	q.source.override = nil
	q.keys[0].Destroy()
	if _, err = q.pvs[0].GetPubKey(); err == nil {
		t.Fatal("destroyed private key exposed as usable signer")
	}
}

func TestPQPrivValidatorTransitionUsesOriginalLegacyThenOnlyPQ(t *testing.T) {
	q := newPQPVFixture(t, false)
	address := q.f.bootstrap.record.Members[0].Address
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(q.f.legacy[string(address)])), filepath.Join(t.TempDir(), "legacy-key.json"), filepath.Join(t.TempDir(), "legacy-state.json"))
	legacy.Save()
	routed, err := NewPQTransitionPrivValidator(legacy, q.pvs[0], q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	key, err := routed.GetPubKey()
	if err != nil || key.Type() != cmted.KeyType || !bytes.Equal(key.Address(), address) {
		t.Fatal("original legacy key not selected", err)
	}
	legacyBytes := bytes.Clone(key.Bytes())
	for q.app.committed.Height < q.schedule.ActivationHeight-1 {
		snapshot, err := q.app.CommittedPQEngineSnapshot()
		if err != nil {
			t.Fatal(err)
		}
		set, err := snapshot.expectedMembersAt(snapshot.through + 1)
		if err != nil {
			t.Fatal(err)
		}
		if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, snapshot.through+1, 0, set); err != nil {
			t.Fatal(err)
		}
		v := pqPVVote(q, set, 0, 0)
		v.Type = cmtproto.PrevoteType
		if err = routed.SignVote(q.f.doc.ChainID, v); err != nil {
			t.Fatal(err)
		}
		if len(v.Signature) != ed25519.SignatureSize || !key.VerifySignature(cmttypes.VoteSignBytes(q.f.doc.ChainID, v), v.Signature) {
			t.Fatal("historical path did not use actual original FilePV")
		}
		q.advance(t, snapshot.through+1)
	}
	set, _ := q.context(t, 0)
	if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, q.schedule.ActivationHeight, 0, set); err != nil {
		t.Fatal(err)
	}
	key, err = routed.GetPubKey()
	if err != nil || key.Type() != ynxpq.KeyType || !bytes.Equal(key.Address(), address) {
		t.Fatal("height transition did not select full logical PQ key", err)
	}
	v := pqPVVote(q, set, 0, 0)
	if err = routed.SignVote(q.f.doc.ChainID, v); err != nil {
		t.Fatal(err)
	}
	if !key.(ynxpq.PubKey).VerifyVote(q.f.doc.ChainID, v) || len(v.Signature) == ed25519.SignatureSize {
		t.Fatal("active height used classic signature")
	}
	oldKey, err := routed.GetPubKeyForHeight(q.f.doc.ChainID, q.schedule.ActivationHeight-1)
	if err != nil || !bytes.Equal(oldKey.Bytes(), legacyBytes) {
		t.Fatal("history reinterpreted original legacy key", err)
	}
	q.signers[0].Close()
	v.Signature = nil
	if err = routed.SignVote(q.f.doc.ChainID, v); err == nil || len(v.Signature) != 0 {
		t.Fatal("closed PQ signer fell back to legacy")
	}
	wrong := privval.GenFilePV(filepath.Join(t.TempDir(), "wrong-key"), filepath.Join(t.TempDir(), "wrong-state"))
	if _, err = NewPQTransitionPrivValidator(wrong, q.pvs[0], q.f.bootstrap, q.authorization); err == nil {
		t.Fatal("different original Ed identity accepted")
	}
}

// A real ordinary signature is durably recorded, then the live registry is
// unavailable for the extension phase. The adapter must publish neither result.
type pqPVSecondPhaseRegistry struct {
	base  *PQCommittedSignerRegistry
	calls int
	fail  bool
}

func (r *pqPVSecondPhaseRegistry) Anchor() ynxconsensusauth.RegistryAnchor { return r.base.Anchor() }
func (r *pqPVSecondPhaseRegistry) ConsensusKeysAt(c string, a []byte, h int64) (ynxconsensusauth.KeyRecord, error) {
	r.calls++
	if r.fail && r.calls == 2 {
		return ynxconsensusauth.KeyRecord{}, errors.New("QA extension registry unavailable")
	}
	return r.base.ConsensusKeysAt(c, a, h)
}

func TestPQPrivValidatorSecondPhaseNeverPublishesPartialVote(t *testing.T) {
	q := newPQPVFixture(t, true)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, _ := q.context(t, 0)
	q.signers[0].Close()
	base, err := NewPQCommittedSignerRegistry(q.source, q.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	registry := &pqPVSecondPhaseRegistry{base: base, fail: true}
	signer, err := ynxconsensusauth.ResumeSigner(q.signerPaths[0], q.keys[0], registry)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	pv, err := NewPQPrivValidator(signer, q.source)
	if err != nil {
		t.Fatal(err)
	}
	if err = pv.SetConsensusSigningContext(q.f.doc.ChainID, q.schedule.ActivationHeight, 0, set); err != nil {
		t.Fatal(err)
	}
	v := pqPVVote(q, set, 0, 0) // empty enabled extension still must be signed
	before := clonePQPVVote(v)
	if err = pv.SignVote(q.f.doc.ChainID, v); err == nil || !reflect.DeepEqual(v, before) || registry.calls != 2 {
		t.Fatal("second phase failure leaked ordinary signature", err)
	}
	registry.fail = false
	if err = pv.SignVote(q.f.doc.ChainID, v); err != nil {
		t.Fatal("original two-phase retry failed", err)
	}
	key, err := pv.GetPubKey()
	if err != nil || !key.(ynxpq.PubKey).VerifyVote(q.f.doc.ChainID, v) || !key.(ynxpq.PubKey).VerifyVoteExtension(q.f.doc.ChainID, v) {
		t.Fatal("full original retry failed actual verification", err)
	}
}

func TestPQPrivValidatorActualFileSourceStartupAndHandshakeBoundary(t *testing.T) {
	q := newPQPVFixture(t, false)
	q.signers[0].Close()
	source, err := NewPQEngineFileSource(q.f.migration, q.path, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := NewPQCommittedSignerRegistry(source, q.f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	// Resume validates the existing state and independent anchor without
	// pretending the application's current file is an engine checkpoint.
	signer, err := ynxconsensusauth.ResumeSigner(q.signerPaths[0], q.keys[0], registry)
	if err != nil {
		t.Fatal(err)
	}
	defer signer.Close()
	pv, err := NewPQPrivValidator(signer, source)
	if err != nil {
		t.Fatal(err)
	}
	address := q.f.bootstrap.record.Members[0].Address
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(q.f.legacy[string(address)])), filepath.Join(t.TempDir(), "legacy-key"), filepath.Join(t.TempDir(), "legacy-state"))
	legacy.Save()
	routed, err := NewPQTransitionPrivValidator(legacy, pv, q.f.bootstrap, q.authorization)
	if err != nil {
		t.Fatal(err)
	}
	key, err := routed.GetPubKey()
	if err != nil || key.Type() != cmted.KeyType || !bytes.Equal(key.Address(), address) {
		t.Fatal("startup lost actual original identity", err)
	}
	if _, err = source.CommittedPQEngineSnapshot(); err == nil {
		t.Fatal("construction self-primed engine authority")
	}
	height := q.app.committed.Height + 1
	if _, err = routed.GetPubKeyForHeight(q.f.doc.ChainID, height); err == nil {
		t.Fatal("unprimed file allowed height authorization")
	}
	if _, err = routed.GetPubKey(); err == nil {
		t.Fatal("height-aware failure fell back to startup identity")
	}
	set := legacyEngineMembers(q.f.bootstrap)
	if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, height, 0, set); err == nil {
		t.Fatal("unprimed engine context accepted")
	}
	v := pqPVVote(q, set, 0, 0)
	if err = routed.SignVote(q.f.doc.ChainID, v); err == nil || len(v.Signature) != 0 {
		t.Fatal("startup identity granted signing authority")
	}
	appHash, err := hex.DecodeString(q.app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.ConsensusAuthorityForState(q.f.doc.ChainID, q.app.committed.Height, appHash); err != nil {
		t.Fatal(err)
	}
	if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, height, 0, set); err != nil {
		t.Fatal(err)
	}
	v.Type = cmtproto.PrevoteType
	if err = routed.SignVote(q.f.doc.ChainID, v); err != nil || !key.VerifySignature(cmttypes.VoteSignBytes(q.f.doc.ChainID, v), v.Signature) {
		t.Fatal("authenticated legacy signing failed", err)
	}
	q.advance(t, q.schedule.ActivationHeight-1)
	appHash, err = hex.DecodeString(q.app.committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	authority, err := source.ConsensusAuthorityForState(q.f.doc.ChainID, q.app.committed.Height, appHash)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := authority.(*PQEngineSnapshot)
	set, err = snapshot.expectedMembersAt(q.schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, q.schedule.ActivationHeight, 0, set); err != nil {
		t.Fatal(err)
	}
	v = pqPVVote(q, set, 0, 0)
	if err = routed.SignVote(q.f.doc.ChainID, v); err != nil {
		t.Fatal(err)
	}
	key, err = routed.GetPubKey()
	if err != nil || !key.(ynxpq.PubKey).VerifyVote(q.f.doc.ChainID, v) {
		t.Fatal("actual file-bound PQ signing failed", err)
	}
	// Invalid replacement must invalidate a formerly usable signing context.
	if err = routed.SetConsensusSigningContext(q.f.doc.ChainID, v.Height, 0, nil); err == nil {
		t.Fatal("nil replacement context accepted")
	}
	v.Signature = nil
	if err = routed.SignVote(q.f.doc.ChainID, v); err == nil || len(v.Signature) != 0 {
		t.Fatal("failed setter retained prior usable context")
	}
}

func TestPQPrivValidatorUnknownApplicationCommitCannotAdvanceAuthority(t *testing.T) {
	q := newPQPVFixture(t, false)
	q.advance(t, q.schedule.ActivationHeight-1)
	set, _ := q.context(t, 0)
	v := pqPVVote(q, set, 0, 0)
	if err := q.pvs[0].SignVote(q.f.doc.ChainID, v); err != nil {
		t.Fatal(err)
	}
	original := bytes.Clone(v.Signature)
	snapshot, err := q.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	nextHash, err := snapshot.ExpectedValidatorHash(v.Height + 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = q.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: v.Height, NextValidatorsHash: nextHash}); err != nil {
		t.Fatal(err)
	}
	q.app.persistenceHooks = &committedPersistenceHooks{syncDirectory: func(string) error { return errors.New("QA directory sync failure") }}
	if _, err = q.app.Commit(context.Background(), &abci.RequestCommit{}); !errors.Is(err, ErrCommittedStateDurabilityUncertain) {
		t.Fatal("actual postrename failure was not UNKNOWN", err)
	}
	next := clonePQPVVote(v)
	next.Height++
	next.Signature = nil
	if err = q.pvs[0].SetConsensusSigningContext(q.f.doc.ChainID, next.Height, 0, set); err == nil {
		t.Fatal("UNKNOWN application candidate became signing authority")
	}
	if err = q.pvs[0].SignVote(q.f.doc.ChainID, next); err == nil || len(next.Signature) != 0 {
		t.Fatal("UNKNOWN next height leaked signature")
	}
	if err = q.pvs[0].SetConsensusSigningContext(q.f.doc.ChainID, v.Height, 0, set); err != nil {
		t.Fatal(err)
	}
	v.Signature = nil
	if err = q.pvs[0].SignVote(q.f.doc.ChainID, v); err != nil || !bytes.Equal(v.Signature, original) {
		t.Fatal("UNKNOWN destroyed original exact result", err)
	}
	q.app.persistenceHooks = nil
	if _, err = q.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	set, _ = q.context(t, 0)
	if err = q.pvs[0].SignVote(q.f.doc.ChainID, next); err != nil {
		t.Fatal("reconciled next height failed", err)
	}
	key, err := q.pvs[0].GetPubKey()
	if err != nil || !key.(ynxpq.PubKey).VerifyVote(q.f.doc.ChainID, next) {
		t.Fatal("reconciled actual signature failed", err)
	}
}

func TestPQPrivValidatorActualNodeConstructorRejectsWrongInputsBeforeServices(t *testing.T) {
	q := newPQPVFixture(t, false)
	address := q.f.bootstrap.record.Members[0].Address
	legacy := privval.NewFilePV(cmted.PrivKey(bytes.Clone(q.f.legacy[string(address)])), filepath.Join(t.TempDir(), "legacy-key"), filepath.Join(t.TempDir(), "legacy-state"))
	config := cmtconfig.DefaultConfig().SetRoot(t.TempDir())
	if err := os.MkdirAll(filepath.Dir(config.GenesisFile()), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.GenesisFile(), q.f.raw, 0600); err != nil {
		t.Fatal(err)
	}
	// A supplied QA node identity, never generated by the production helper.
	nodeKey := &p2p.NodeKey{PrivKey: cmted.PrivKey(bytes.Clone(q.f.legacy[string(address)]))}
	logger := log.NewNopLogger()
	if _, err := NewPQConsensusNode(nil, q.app, legacy, q.signers[0], nodeKey, logger); err == nil {
		t.Fatal("missing config accepted")
	}
	if _, err := NewPQConsensusNode(config, q.app, legacy, q.signers[0], nil, logger); err == nil {
		t.Fatal("missing original node identity accepted")
	}
	config.PrivValidatorListenAddr = "tcp://127.0.0.1:1"
	if _, err := NewPQConsensusNode(config, q.app, legacy, q.signers[0], nodeKey, logger); err == nil {
		t.Fatal("remote configuration silently replaced supplied signer")
	}
	config.PrivValidatorListenAddr = ""
	if err := os.WriteFile(config.GenesisFile(), append(bytes.Clone(q.f.raw), ' '), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPQConsensusNode(config, q.app, legacy, q.signers[0], nodeKey, logger); err == nil {
		t.Fatal("changed original genesis accepted")
	}
	if err := os.WriteFile(config.GenesisFile(), q.f.raw, 0600); err != nil {
		t.Fatal(err)
	}
	wrong := privval.GenFilePV(filepath.Join(t.TempDir(), "wrong-key"), filepath.Join(t.TempDir(), "wrong-state"))
	if _, err := NewPQConsensusNode(config, q.app, wrong, q.signers[0], nodeKey, logger); err == nil {
		t.Fatal("wrong original validator reached node construction")
	}
	if _, err := os.Stat(config.DBDir()); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("rejected inputs started database/service construction", err)
	}
}
