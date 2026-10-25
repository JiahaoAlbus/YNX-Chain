package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cryptoenc "github.com/cometbft/cometbft/crypto/encoding"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	cmttypes "github.com/cometbft/cometbft/types"
)

func TestPQEngineScheduleActualParamsThenValidatorUpdateTiming(t *testing.T) {
	f, app, _ := committedEngineFixture(t)
	h := app.committed.Height
	if _, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+3); err == nil {
		t.Fatal("params and keys collapsed into unsafe activation interval")
	}
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	if schedule.ParamsUpdateHeight != h+1 || schedule.ValidatorUpdateHeight != h+2 || schedule.ActivationHeight != h+4 {
		t.Fatal("wrong actual H+1/H+2 schedule")
	}
	if _, err = newPQEngineSnapshot(f.bootstrap, app.committed.ValidatorRegistry, schedule, h); err == nil {
		t.Fatal("schedule treated as committed before authorization height")
	}
	paramsStage, err := newPQEngineSnapshot(f.bootstrap, app.committed.ValidatorRegistry, schedule, h+1)
	if err != nil {
		t.Fatal(err)
	}
	params, updates, err := paramsStage.UpdatesAt(h + 1)
	if err != nil || params == nil || len(updates) != 0 || len(params.Validator.PubKeyTypes) != 2 || params.Validator.PubKeyTypes[1] != ynxpq.KeyType {
		t.Fatalf("first step did not exclusively emit key allowlist: %+v %+v %v", params, updates, err)
	}
	oldParams, _ := paramsStage.ParamsAt(h + 1)
	newParams, _ := paramsStage.ParamsAt(h + 2)
	if len(oldParams.Validator.PubKeyTypes) != 1 || len(newParams.Validator.PubKeyTypes) != 2 {
		t.Fatal("parameter update effective at wrong height")
	}
	keysStage, err := newPQEngineSnapshot(f.bootstrap, app.committed.ValidatorRegistry, schedule, h+2)
	if err != nil {
		t.Fatal(err)
	}
	params, updates, err = keysStage.UpdatesAt(h + 2)
	if err != nil || params != nil || len(updates) != len(f.bootstrap.record.Members) {
		t.Fatalf("second step did not emit exact full-key set: %v", err)
	}
	actual := legacyEngineMembers(f.bootstrap)
	var changes []*cmttypes.Validator
	for _, u := range updates {
		pub, err := cryptoenc.PubKeyFromProto(u.PubKey)
		if err != nil {
			t.Fatal(err)
		}
		if pub.Type() != ynxpq.KeyType {
			t.Fatal("update carried abbreviated/classic key")
		}
		changes = append(changes, cmttypes.NewValidator(pub, u.Power))
	}
	if err = actual.UpdateWithChangeSet(changes); err != nil {
		t.Fatal(err)
	}
	expected, err := keysStage.ExpectedValidatorHash(h + 4)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(actual.Hash(), expected) {
		t.Fatal("actual Comet update produced wrong activation validator hash")
	}
	if err = keysStage.ValidateNextValidatorsHash(h+3, expected); err != nil {
		t.Fatal(err)
	}
	if err = keysStage.ValidateNextValidatorsHash(h+3, f.bootstrap.validatorSetHash); err == nil {
		t.Fatal("permanent fixed-Ed hash accepted past transition")
	}
	legacySource := legacyEngineMembers(f.bootstrap)
	legacyBound, err := keysStage.BindValidatorSet(h+3, legacySource)
	if err != nil {
		t.Fatal("old height reinterpreted before activation:", err)
	}
	member := f.bootstrap.record.Members[0]
	index, old := legacyBound.GetByAddress(member.Address)
	oldVote := &cmttypes.Vote{Type: cmtproto.PrevoteType, Height: h + 3, Round: 0, Timestamp: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), ValidatorAddress: bytes.Clone(member.Address), ValidatorIndex: index}
	oldVote.Signature = ed25519.Sign(f.legacy[string(member.Address)], cmttypes.VoteSignBytes(f.doc.ChainID, oldVote.ToProto()))
	if err = oldVote.Verify(f.doc.ChainID, old.PubKey); err != nil {
		t.Fatal("historical Ed signature was reinterpreted:", err)
	}
	legacySource.Validators[index].Address[0] ^= 1
	if !bytes.Equal(old.Address, member.Address) {
		t.Fatal("bound historical address aliases source engine state")
	}
	hash, err := schedule.Hash()
	if err != nil || hash == "" {
		t.Fatal(err)
	}
	changed := clonePQEngineSchedule(schedule)
	changed.ActivationHeight++
	changedHash, _ := changed.Hash()
	if hash == changedHash || validatePQEngineScheduleContinuation(schedule, changed) == nil || validatePQEngineScheduleContinuation(schedule, nil) == nil {
		t.Fatal("schedule rewrite/removal not committed to hash")
	}
	for _, mutate := range []func(*PQEngineSchedule){
		func(s *PQEngineSchedule) { s.GenesisID[0] ^= 1 },
		func(s *PQEngineSchedule) { s.RegistryRoot = "00" },
		func(s *PQEngineSchedule) { s.RegistryEventCount-- },
		func(s *PQEngineSchedule) { s.ActivationValidatorSetHash = s.OriginalValidatorSetHash },
		func(s *PQEngineSchedule) { s.ValidatorUpdateHeight = s.ParamsUpdateHeight },
	} {
		bad := clonePQEngineSchedule(schedule)
		mutate(bad)
		if _, err = newPQEngineSnapshot(f.bootstrap, app.committed.ValidatorRegistry, bad, h+2); err == nil {
			t.Fatal("substituted schedule accepted")
		}
	}
}
func TestPQEngineOperatorPinAdmissionAndWorkingIsolation(t *testing.T) {
	f, app, _ := committedEngineFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	authorization, err := NewPQEngineAuthorization(raw, hash)
	if err != nil {
		t.Fatal(err)
	}
	for _, malformed := range [][]byte{
		append(bytes.Clone(raw), []byte("{}")...),
		append([]byte("{\"version\":1,"), raw[1:]...),
		append([]byte("{\"peerAuthority\":true,"), raw[1:]...),
	} {
		if _, err := NewPQEngineAuthorization(malformed, hash); err == nil {
			t.Fatal("ambiguous or peer-extended operator schedule accepted")
		}
	}
	wrongHash := []byte(hash)
	if wrongHash[0] == '0' {
		wrongHash[0] = '1'
	} else {
		wrongHash[0] = '0'
	}
	if _, err := NewPQEngineAuthorization(raw, string(wrongHash)); err == nil {
		t.Fatal("operator candidate authenticated its own mismatched expected pin")
	}
	var unconfigured *PQEngineAuthorization
	if unconfigured.ValidateCommittedSchedule(schedule, schedule.AuthorizedAt) == nil {
		t.Fatal("restored schedule authorized without independent operator pin")
	}
	if authorization.ValidateCommittedSchedule(nil, schedule.AuthorizedAt) == nil || authorization.ValidateCommittedSchedule(schedule, h) == nil {
		t.Fatal("missed or premature committed schedule accepted")
	}
	if err := authorization.ValidateCommittedSchedule(schedule, schedule.AuthorizedAt); err != nil {
		t.Fatal(err)
	}
	state := app.cloneExecutionState()
	before, err := preparePQEngineExecution(state, h, authorization)
	if err != nil || before.pqEngineSchedule != nil {
		t.Fatal("schedule installed before authorization height:", err)
	}
	working, err := preparePQEngineExecution(state, schedule.AuthorizedAt, authorization)
	if err != nil || working.pqEngineSchedule == nil {
		t.Fatal("exact-height working admission failed:", err)
	}
	if state.pqEngineSchedule != nil || app.committed.PQEngineSchedule != nil || app.pending != nil {
		t.Fatal("working schedule leaked into original/committed/pending state")
	}
	working.pqEngineSchedule.GenesisID[0] ^= 1
	if !bytes.Equal(authorization.schedule.GenesisID, schedule.GenesisID) {
		t.Fatal("working state aliases independent pin")
	}
	if _, err := preparePQEngineExecution(state, schedule.AuthorizedAt+1, authorization); err == nil {
		t.Fatal("missed schedule was automatically admitted at a later height")
	}
	bad := clonePQEngineSchedule(schedule)
	wrongRoot := []byte(bad.RegistryRoot)
	if wrongRoot[0] == '0' {
		wrongRoot[0] = '1'
	} else {
		wrongRoot[0] = '0'
	}
	bad.RegistryRoot = string(wrongRoot)
	badRaw, _ := json.Marshal(bad)
	badHash, _ := bad.Hash()
	badAuthorization, err := NewPQEngineAuthorization(badRaw, badHash)
	if err != nil {
		t.Fatal(err)
	}
	failed, err := preparePQEngineExecution(state, schedule.AuthorizedAt, badAuthorization)
	if err == nil || !reflect.DeepEqual(failed, state) || app.committed.PQEngineSchedule != nil {
		t.Fatal("failed candidate changed the original execution state")
	}
}

// Construct an event with real current-pair authorization and run the original
// KeyHistory.Append before the engine-specific admission gate. This separates
// cryptographically lawful registry operations from unsafe activation timing.
func appendEngineRevocation(t *testing.T, f *validatorRegistryFixture, registry *ValidatorRegistryState, key engineTestKey, approved, effective int64) *ValidatorRegistryState {
	t.Helper()
	history, err := replayValidatorRegistry(registry, f.bootstrap, approved)
	if err != nil {
		t.Fatal(err)
	}
	record, err := history.ConsensusKeysAt(f.doc.ChainID, key.address, approved)
	if err != nil {
		t.Fatal(err)
	}
	var previous ynxconsensusauth.Registration
	var previousHash [32]byte
	for _, event := range registry.Events {
		registration, err := ynxconsensusauth.DecodeRegistration(event.Wire)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Equal(registration.Intent.ValidatorAddress, key.address) {
			previous = registration
			previousHash, err = ynxconsensusauth.RegistrationHash(event.Wire)
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RevokeValidator, GenesisID: bytes.Clone(f.bootstrap.genesisID), ChainID: f.doc.ChainID, ValidatorAddress: bytes.Clone(key.address), Sequence: previous.Intent.Sequence + 1, AuthorizingEpoch: record.Epoch, Epoch: record.Epoch, ApprovedAt: approved, EffectiveAt: effective, PreviousEventHash: previousHash[:], AuthorityMLDSA87PublicKey: key.pka, AuthoritySLHDSASHA2256fPublicKey: key.pkb}
	message, err := intent.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	a, b := key.signatures(t, message)
	wire, err := (ynxconsensusauth.Registration{Intent: intent, AuthorityMLDSA87: a, AuthoritySLHDSASHA2256f: b}).MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	history, err = history.Append(wire, approved, f.bootstrap.membershipAt(approved))
	if err != nil {
		t.Fatal("real registry prerequisite failed:", err)
	}
	op, err := ynxconsensusauth.RegistrationHash(wire)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		t.Fatal(err)
	}
	next := cloneValidatorRegistry(registry)
	root := history.Root()
	next.Root = hex.EncodeToString(root[:])
	index := uint32(0)
	if last := next.Events[len(next.Events)-1]; last.Height == approved {
		index = last.TransactionIndex + 1
	}
	next.Events = append(next.Events, ValidatorRegistryEvent{Index: uint64(len(next.Events)), Height: approved, TransactionIndex: index, ABCIHash: SignedTransactionHash(tx), OperationHash: "0x" + hex.EncodeToString(op[:]), Wire: wire})
	return next
}

func TestPQEngineRegistryAdmissionRejectsInitialConflictAndDistantEmptySet(t *testing.T) {
	f, app, keys := committedEngineFixture(t)
	h := app.committed.Height
	schedule, err := NewPQEngineSchedule(f.bootstrap, app.committed.ValidatorRegistry, h, h+4)
	if err != nil {
		t.Fatal(err)
	}
	state := app.cloneExecutionState()
	state.pqEngineSchedule = clonePQEngineSchedule(schedule)
	initialConflict := appendEngineRevocation(t, f, state.validatorRegistry, keys[0], h+2, schedule.ActivationHeight)
	if err := validatePQEngineRegistryTransition(state, initialConflict, h+2); err == nil {
		t.Fatal("lawfully signed later event changed the pinned initial activation set")
	}
	approved := schedule.ActivationHeight + 1
	first := appendEngineRevocation(t, f, state.validatorRegistry, keys[0], approved, approved+2)
	if err := validatePQEngineRegistryTransition(state, first, approved); err != nil {
		t.Fatal("safe partial member removal rejected:", err)
	}
	if err := validatePQEngineRegistryTransition(state, first, approved+1); err == nil {
		t.Fatal("original event execution height was relabeled")
	}
	state.validatorRegistry = first
	second := appendEngineRevocation(t, f, first, keys[1], approved+1, schedule.ActivationHeight+100)
	if err := validatePQEngineRegistryTransition(state, second, approved+1); err == nil {
		t.Fatal("distant declared effective boundary removes all validators")
	}
	if _, err := newPQEngineSnapshot(f.bootstrap, second, schedule, approved+1); err == nil {
		t.Fatal("restart accepted a future empty validator set")
	}
	if len(state.validatorRegistry.Events) != len(app.committed.ValidatorRegistry.Events)+1 || len(app.committed.ValidatorRegistry.Events) != 2 {
		t.Fatal("failed registry candidates changed committed or previous accepted history")
	}
}
