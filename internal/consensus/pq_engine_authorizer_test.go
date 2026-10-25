package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
	abci "github.com/cometbft/cometbft/abci/types"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

type engineTestKey struct {
	a        *mldsa87.PrivateKey
	b        *slhdsa.PrivateKey
	pka, pkb []byte
	address  []byte
}

func (k engineTestKey) signatures(t *testing.T, message []byte) ([]byte, []byte) {
	t.Helper()
	a := make([]byte, ynxconsensusauth.MLDSA87SignatureSize)
	if err := mldsa87.SignTo(k.a, message, nil, false, a); err != nil {
		t.Fatal(err)
	}
	b, err := slhdsa.SignRandomized(k.b, rand.Reader, slhdsa.NewMessage(message), nil)
	if err != nil {
		t.Fatal(err)
	}
	return a, b
}

func engineRegistration(t *testing.T, f *validatorRegistryFixture, index int, height int64) (engineTestKey, []byte) {
	t.Helper()
	pa, a, err := mldsa87.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pb, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		t.Fatal(err)
	}
	pkb, err := pb.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	member := f.bootstrap.record.Members[index]
	k := engineTestKey{a: a, b: &b, pka: pa.Bytes(), pkb: pkb, address: bytes.Clone(member.Address)}
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ValidatorAddress: k.address, Sequence: 1, Epoch: 1, ApprovedAt: height, EffectiveAt: height + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(member.Ed25519), MLDSA87PublicKey: k.pka, SLHDSASHA2256fPublicKey: k.pkb}
	auth, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	pop, err := intent.PossessionSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	aSig, bSig := k.signatures(t, pop)
	wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(f.legacy[string(member.Address)], auth), PossessionMLDSA87: aSig, PossessionSLHDSASHA2256f: bSig}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	return k, wire
}

func committedEngineFixture(t *testing.T) (*validatorRegistryFixture, *Application, []engineTestKey) {
	t.Helper()
	f := newValidatorRegistryFixture(t)
	app := newPinnedRegistryApp(t, f, "")
	var keys []engineTestKey
	var txs [][]byte
	for i := range f.bootstrap.record.Members {
		k, wire := engineRegistration(t, f, i, f.doc.InitialHeight)
		tx, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
		txs = append(txs, tx)
	}
	resp, err := app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: txs})
	if err != nil {
		t.Fatal(err)
	}
	for _, res := range resp.TxResults {
		if res.Code != 0 {
			t.Fatal(res.Log)
		}
	}
	if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	return f, app, keys
}

func TestPQEngineFrozenRootCodecInteroperatesWithActualForkVerifier(t *testing.T) {
	f, app, keys := committedEngineFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := newPQEngineSnapshot(f.bootstrap, app.committed.ValidatorRegistry, schedule, schedule.ActivationHeight-1)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := snapshot.expectedMembersAt(schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	// Preserve actual priorities across binding; neither reconstructed membership
	// nor a peer-supplied proposer is substituted for this engine state.
	expected.IncrementProposerPriority(3)
	bound, err := snapshot.BindValidatorSet(schedule.ActivationHeight, expected)
	if err != nil {
		t.Fatal(err)
	}
	if bound.Proposer.ProposerPriority != expected.Proposer.ProposerPriority || !bytes.Equal(bound.Proposer.Address, expected.Proposer.Address) {
		t.Fatal("binding rewrote actual proposer priority")
	}
	key := keys[0]
	index, validator := bound.GetByAddress(key.address)
	forkKey := validator.PubKey.(ynxpq.PubKey)
	vote := &cmttypes.Vote{Type: cmtproto.PrecommitType, Height: schedule.ActivationHeight, Round: 2, ValidatorIndex: index, ValidatorAddress: bytes.Clone(key.address), Timestamp: time.Date(2026, 10, 18, 2, 3, 4, 5, time.UTC), BlockID: cmttypes.BlockID{Hash: bytes.Repeat([]byte{6}, 32), PartSetHeader: cmttypes.PartSetHeader{Total: 1, Hash: bytes.Repeat([]byte{7}, 32)}}}
	request, err := ynxconsensusauth.NewVoteRequestV2(f.bootstrap.genesisID, f.doc.ChainID, vote.ToProto())
	if err != nil {
		t.Fatal(err)
	}
	rootMessage, err := request.SigningBytes(1)
	if err != nil {
		t.Fatal(err)
	}
	forkMessage, err := forkKey.OrdinarySigningBytes(cmttypes.VoteSignBytes(f.doc.ChainID, vote.ToProto()))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(rootMessage, forkMessage) {
		t.Fatal("root/fork v2 message byte divergence")
	}
	a, b := key.signatures(t, rootMessage)
	vote.Signature, err = (ynxconsensusauth.Envelope{KeyEpoch: 1, MLDSA87: a, SLHDSASHA2256f: b}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	if err = vote.Verify(f.doc.ChainID, forkKey); err != nil {
		t.Fatal("actual fork rejected real root-domain signatures:", err)
	}
	policy, err := snapshot.Policy()
	if err != nil {
		t.Fatal(err)
	}
	rootVerifier, err := ynxconsensusauth.NewCIRCLVerifier(policy, snapshot, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = rootVerifier.Verify(request, vote.Signature); err != nil {
		t.Fatal(err)
	}
	for _, offset := range []int{len(vote.Signature) - 1, len(vote.Signature) - ynxconsensusauth.SLHDSASHA2256fSignatureSize - 9} {
		bad := vote.Copy()
		bad.Signature = bytes.Clone(vote.Signature)
		bad.Signature[offset] ^= 1
		if err = bad.Verify(f.doc.ChainID, forkKey); err == nil {
			t.Fatal("either corrupted proof branch accepted")
		}
	}
	wire, err := cryptoenc.PubKeyToProto(forkKey)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := cryptoenc.PubKeyFromProto(wire)
	if err != nil {
		t.Fatal(err)
	}
	if vote.Verify(f.doc.ChainID, decoded) == nil {
		t.Fatal("network key transport carried authority")
	}
	decodedSet := expected.Copy()
	decodedSet.Validators[index] = cmttypes.NewValidator(decoded, validator.VotingPower)
	rebound, err := snapshot.BindValidatorSet(vote.Height, decodedSet)
	if err != nil {
		t.Fatal(err)
	}
	if err = vote.Verify(f.doc.ChainID, rebound.Validators[index].PubKey); err != nil {
		t.Fatal(err)
	}
	wrong := expected.Copy()
	wrong.Validators[index].VotingPower++
	if _, err = snapshot.BindValidatorSet(vote.Height, wrong); err == nil {
		t.Fatal("actual power mismatch accepted")
	}
	if _, err = snapshot.BindValidatorSet(vote.Height, legacyEngineMembers(f.bootstrap)); err == nil {
		t.Fatal("classic fallback at active height")
	}
	if _, err = snapshot.BindValidatorSet(schedule.ActivationHeight-1, expected); err == nil {
		t.Fatal("PQ set activated before committed profile")
	}
	if err = snapshot.AuthorizeConsensusKey(forkKey.Bytes(), vote.Height, 2, ynxpq.VoteExtension); err == nil {
		t.Fatal("extension enabled by registration instead of params")
	}
	if err = snapshot.AuthorizeConsensusKey(forkKey.Bytes(), snapshot.through+3, 2, ynxpq.Prevote); err == nil {
		t.Fatal("unknown future membership authorized")
	}
}

func TestPQEngineCommittedViewExcludesWorkingAndRevocationPreservesHistory(t *testing.T) {
	f, app, keys := committedEngineFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	pending := app.committed
	pending.Height = h + 1
	pending.PQEngineSchedule = clonePQEngineSchedule(schedule)
	app.pending = &pending
	visible, err := app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = visible.Policy(); err == nil {
		t.Fatal("pending activation escaped committed accessor")
	}
	app.pending = nil
	original := cloneValidatorRegistry(app.committed.ValidatorRegistry)
	before, err := newPQEngineSnapshot(f.bootstrap, original, schedule, schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	key := keys[0]
	record, err := before.history.ConsensusKeysAt(f.doc.ChainID, key.address, schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	previousHash, err := ynxconsensusauth.RegistrationHash(original.Events[0].Wire)
	if err != nil {
		t.Fatal(err)
	}
	revokeAt := schedule.ActivationHeight + 1
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RevokeValidator, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ValidatorAddress: bytes.Clone(key.address), Sequence: 2, AuthorizingEpoch: record.Epoch, Epoch: record.Epoch, ApprovedAt: revokeAt, EffectiveAt: revokeAt + 2, PreviousEventHash: previousHash[:], AuthorityMLDSA87PublicKey: key.pka, AuthoritySLHDSASHA2256fPublicKey: key.pkb}
	message, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	a, b := key.signatures(t, message)
	wire, err := (ynxconsensusauth.Registration{Intent: intent, AuthorityMLDSA87: a, AuthoritySLHDSASHA2256f: b}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	history, err := before.history.Append(wire, revokeAt, f.bootstrap.membershipAt(revokeAt))
	if err != nil {
		t.Fatal(err)
	}
	op, _ := ynxconsensusauth.RegistrationHash(wire)
	tx, _ := EncodeValidatorRegistryTransaction(wire)
	next := cloneValidatorRegistry(original)
	root := history.Root()
	next.Root = hex.EncodeToString(root[:])
	next.Events = append(next.Events, ValidatorRegistryEvent{Index: uint64(len(next.Events)), Height: revokeAt, TransactionIndex: 0, ABCIHash: SignedTransactionHash(tx), OperationHash: "0x" + hex.EncodeToString(op[:]), Wire: wire})
	after, err := newPQEngineSnapshot(f.bootstrap, next, schedule, revokeAt)
	if err != nil {
		t.Fatal(err)
	}
	binding, err := before.history.PublicKeyBindingAt(f.doc.ChainID, key.address, schedule.ActivationHeight)
	if err != nil {
		t.Fatal(err)
	}
	if err = after.AuthorizeConsensusKey(binding, schedule.ActivationHeight, 0, ynxpq.Precommit); err != nil {
		t.Fatal("future tombstone invalidated original height:", err)
	}
	if err = after.AuthorizeConsensusKey(binding, revokeAt+2, 0, ynxpq.Precommit); err == nil {
		t.Fatal("effective revoked key accepted")
	}
	_, updates, err := after.UpdatesAt(revokeAt)
	if err != nil || len(updates) != 1 || updates[0].Power != 0 {
		t.Fatalf("revocation did not produce exact H+2 removal: %+v %v", updates, err)
	}
	if _, err = before.ConsensusKeysAt(f.doc.ChainID, key.address, schedule.ActivationHeight); err != nil {
		t.Fatal("detached original snapshot mutated:", err)
	}
}
