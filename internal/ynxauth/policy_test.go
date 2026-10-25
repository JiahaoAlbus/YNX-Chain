package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
	"golang.org/x/crypto/sha3"
)

// These fixtures create fresh test-only standard keys. No fixture is treated as
// an existing production account: the owner is derived from its QA classic key.
type authFixture struct {
	state                   State
	classic                 *secp256k1.PrivateKey
	owner                   string
	first, next             *ynxbatch.PrivateKey
	firstPublic, nextPublic ynxbatch.PublicKey
}

func newAuthFixture(t testing.TB) authFixture {
	t.Helper()
	classic, err := secp256k1.GeneratePrivateKey()
	authOK(t, err)
	t.Cleanup(classic.Zero)
	h := sha3.NewLegacyKeccak256()
	_, err = h.Write(classic.PubKey().SerializeUncompressed()[1:])
	authOK(t, err)
	digest := h.Sum(nil)
	first, firstPublic, err := ynxbatch.KeyGen()
	authOK(t, err)
	t.Cleanup(first.Destroy)
	next, nextPublic, err := ynxbatch.KeyGen()
	authOK(t, err)
	t.Cleanup(next.Destroy)
	return authFixture{state: State{Version: PolicyVersion, NetworkID: authNetwork(t), EnableAt: 10},
		classic: classic, owner: "0x" + hex.EncodeToString(digest[len(digest)-20:]),
		first: first, next: next, firstPublic: firstPublic, nextPublic: nextPublic}
}

func authProof(t testing.TB, key *ynxbatch.PrivateKey, network []byte, owner, purpose string, messages [][]byte) (whole, member []byte) {
	t.Helper()
	b, err := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: network, Owner: owner, Purpose: purpose}, messages, ynxbatch.SignOptions{Optimized: true})
	authOK(t, err)
	defer b.Discard()
	whole, err = b.WholeWire()
	authOK(t, err)
	m, err := ynxbatch.Extract(b, 0)
	authOK(t, err)
	member, err = ynxbatch.EncodeMember(m)
	authOK(t, err)
	return whole, member
}

func authIntent(f authFixture, pub ynxbatch.PublicKey, prior, nonce, activate uint64) RegistrationIntent {
	return RegistrationIntent{ChainID: bytes.Clone(f.state.NetworkID), Owner: f.owner,
		PKA: bytes.Clone(pub.PKA), PKB: bytes.Clone(pub.PKB), PriorRevision: prior,
		NewRevision: prior + 1, LedgerNonce: nonce, ActivateAt: activate}
}

func authSignMigration(t testing.TB, intent RegistrationIntent, classic *secp256k1.PrivateKey, current, proposed *ynxbatch.PrivateKey) Migration {
	t.Helper()
	message, err := intent.SigningBytes()
	authOK(t, err)
	m := Migration{Intent: intent}
	m.NewKeyProof, _ = authProof(t, proposed, intent.ChainID, intent.Owner, MigrationPurpose, [][]byte{message})
	if current != nil {
		_, m.CurrentPQProof = authProof(t, current, intent.ChainID, intent.Owner, MigrationPurpose, [][]byte{message})
	} else if classic != nil {
		digest := sha256.Sum256(message)
		m.ClassicPublicKey = classic.PubKey().SerializeCompressed()
		m.ClassicSignature = ecdsa.Sign(classic, digest[:]).Serialize()
	}
	return m
}

func authCopyMigration(m Migration) Migration {
	m.Intent.ChainID = bytes.Clone(m.Intent.ChainID)
	m.Intent.PKA = bytes.Clone(m.Intent.PKA)
	m.Intent.PKB = bytes.Clone(m.Intent.PKB)
	m.ClassicPublicKey = bytes.Clone(m.ClassicPublicKey)
	m.ClassicSignature = bytes.Clone(m.ClassicSignature)
	m.CurrentPQProof = bytes.Clone(m.CurrentPQProof)
	m.NewKeyProof = bytes.Clone(m.NewKeyProof)
	return m
}

func authInitial(t testing.TB, f authFixture) (State, Migration) {
	t.Helper()
	m := authSignMigration(t, authIntent(f, f.firstPublic, 0, 41, 20), f.classic, nil, f.first)
	s, err := f.state.AdmitMigration(m, 10, 40)
	authOK(t, err)
	return s, m
}

func authTransaction(t testing.TB, f authFixture) []byte {
	t.Helper()
	message, err := (Transfer{ChainID: f.state.NetworkID, NativeChainID: 1<<40 + 17,
		From: f.owner, To: qaTo, Amount: 7, Fee: 1, Nonce: 1<<48 + 43}).SigningBytes()
	authOK(t, err)
	return message
}

func TestClassicMigrationActivationThenPQRotationPreservesHistory(t *testing.T) {
	f := newAuthFixture(t)
	initialState := f.state.Clone()
	s, firstMigration := authInitial(t, f)
	if !reflect.DeepEqual(f.state, initialState) || len(s.Records) != 1 {
		t.Fatal("admission mutated the original state")
	}
	authOK(t, s.Validate(f.state.NetworkID))
	authOK(t, s.RequireLegacy(f.owner, 19))
	if !errors.Is(s.RequireLegacy(f.owner, 20), ErrPolicy) {
		t.Fatal("classic authorization survived activation")
	}
	if _, ok := s.PolicyAt(f.owner, 19); ok {
		t.Fatal("pending registration became active early")
	}
	active, ok := s.PolicyAt(f.owner, 20)
	if !ok || active.Revision != 1 || active.RegisteredAt != 10 || active.ActiveFrom != 20 || active.LedgerNonce != 41 {
		t.Fatal("wrong activation record")
	}
	message := authTransaction(t, f)
	_, oldMember := authProof(t, f.first, f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	authReject(t, s.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 19))
	authOK(t, s.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 20))
	firstRecord := s.Clone().Records[0]
	rotation := authSignMigration(t, authIntent(f, f.nextPublic, 1, 43, 30), nil, f.first, f.next)
	s2, err := s.AdmitMigration(rotation, 20, 42)
	authOK(t, err)
	if len(s2.Records) != 2 || len(s.Records) != 1 || !reflect.DeepEqual(s2.Records[0], firstRecord) {
		t.Fatal("rotation lost prior authorization history")
	}
	for _, item := range []struct{ height, revision uint64 }{{19, 0}, {20, 1}, {29, 1}, {30, 2}, {math.MaxUint64, 2}} {
		r, active := s2.PolicyAt(f.owner, item.height)
		if active != (item.revision != 0) || r.Revision != item.revision {
			t.Fatal("policy selected the wrong historical revision")
		}
	}
	_, newMember := authProof(t, f.next, f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	authOK(t, s2.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 20))
	authOK(t, s2.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 29))
	authReject(t, s2.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 30))
	authReject(t, s2.VerifyMember(f.owner, TransactionPurpose, message, newMember, 29))
	authOK(t, s2.VerifyMember(f.owner, TransactionPurpose, message, newMember, 30))
	authOK(t, s2.RequireLegacy(f.owner, 19))
	if !errors.Is(s2.RequireLegacy(f.owner, math.MaxUint64), ErrPolicy) {
		t.Fatal("classic fallback returned after rotation")
	}
	// Persistence/recovery here restores public policy history only. Wallet secret
	// backup recovery is a separate integration gate; this test makes no such claim.
	encoded, err := json.Marshal(s2)
	authOK(t, err)
	var recovered State
	authOK(t, json.Unmarshal(encoded, &recovered))
	authOK(t, recovered.Validate(f.state.NetworkID))
	authOK(t, recovered.VerifyMember(f.owner, TransactionPurpose, message, newMember, 30))
	authOK(t, recovered.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 20))
	// Admission, query and Clone all detach public slices from their callers.
	firstMigration.Intent.PKA[0] ^= 1
	rotation.Intent.PKB[0] ^= 1
	active.PKA[0] ^= 1
	copyState := s2.Clone()
	copyState.NetworkID[0] ^= 1
	copyState.Records[0].PKA[0] ^= 1
	if !reflect.DeepEqual(s2.Records[0], firstRecord) {
		t.Fatal("caller mutation changed immutable history")
	}
}

func TestMigrationRejectsNonceRevisionActivationAndPendingReplacement(t *testing.T) {
	f := newAuthFixture(t)
	s, initial := authInitial(t, f)
	base := f.state.Clone()
	for name, run := range map[string]func() error{
		"before protocol enable": func() error { _, e := base.AdmitMigration(initial, 9, 40); return e },
		"wrong ledger nonce":     func() error { _, e := base.AdmitMigration(initial, 10, 41); return e },
		"ledger nonce overflow":  func() error { _, e := base.AdmitMigration(initial, 10, math.MaxUint64); return e },
		"activation same height": func() error {
			m := authCopyMigration(initial)
			m.Intent.ActivateAt = 10
			_, e := base.AdmitMigration(m, 10, 40)
			return e
		},
		"activation in past": func() error {
			m := authCopyMigration(initial)
			m.Intent.ActivateAt = 9
			_, e := base.AdmitMigration(m, 10, 40)
			return e
		},
		"revision skip": func() error {
			m := authCopyMigration(initial)
			m.Intent.NewRevision = 2
			_, e := base.AdmitMigration(m, 10, 40)
			return e
		},
		"wrong prior": func() error {
			m := authCopyMigration(initial)
			m.Intent.PriorRevision = 1
			m.Intent.NewRevision = 2
			_, e := base.AdmitMigration(m, 10, 40)
			return e
		},
		"initial replay pending": func() error { _, e := s.AdmitMigration(initial, 11, 40); return e },
	} {
		t.Run(name, func(t *testing.T) { authReject(t, run()) })
	}
	// Even a fully signed new classic migration cannot replace a not-yet-active pair.
	pending := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 25), f.classic, nil, f.next)
	_, err := s.AdmitMigration(pending, 19, 41)
	authReject(t, err)
	// A valid old-classic signature cannot recover/replace the pair after activation.
	classicFallback := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 30), f.classic, nil, f.next)
	_, err = s.AdmitMigration(classicFallback, 20, 41)
	authReject(t, err)
	// A proposed key proving possession is not the current account's authority.
	selfAuthorized := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 30), nil, f.next, f.next)
	_, err = s.AdmitMigration(selfAuthorized, 20, 41)
	authReject(t, err)
	// Retain high nonce and activation bits through real migration and persisted state.
	high := authSignMigration(t, authIntent(f, f.firstPublic, 0, 1<<55+7, 1<<60+11), f.classic, nil, f.first)
	highState, err := base.AdmitMigration(high, 1<<40+3, 1<<55+6)
	authOK(t, err)
	if highState.Records[0].LedgerNonce != 1<<55+7 || highState.Records[0].ActiveFrom != 1<<60+11 || highState.Records[0].RegisteredAt != 1<<40+3 {
		t.Fatal("migration uint64 high bits lost")
	}
	if !reflect.DeepEqual(base, f.state) {
		t.Fatal("rejection mutated source state")
	}
}

func TestInitialMigrationRequiresClassicAndBothNewPossessionBranches(t *testing.T) {
	f := newAuthFixture(t)
	valid := authSignMigration(t, authIntent(f, f.firstPublic, 0, 41, 20), f.classic, nil, f.first)
	message, err := valid.Intent.SigningBytes()
	authOK(t, err)
	otherWhole, _ := authProof(t, f.first, f.state.NetworkID, f.owner, MigrationPurpose, [][]byte{message})
	otherCert, err := ynxbatch.DecodeWhole(otherWhole)
	authOK(t, err)
	for name, change := range map[string]func(*Migration){
		"missing classic signature": func(m *Migration) { m.ClassicSignature = nil },
		"missing classic key":       func(m *Migration) { m.ClassicPublicKey = nil },
		"bad classic":               func(m *Migration) { m.ClassicSignature[len(m.ClassicSignature)-1] ^= 1 },
		"unexpected current PQ":     func(m *Migration) { m.CurrentPQProof = []byte{1} },
		"missing new proof":         func(m *Migration) { m.NewKeyProof = nil },
		"wrong network":             func(m *Migration) { m.Intent.ChainID[0] ^= 1 },
		"wrong owner":               func(m *Migration) { m.Intent.Owner = qaFrom },
		"ML public length":          func(m *Migration) { m.Intent.PKA = m.Intent.PKA[:2591] },
		"SLH public length":         func(m *Migration) { m.Intent.PKB = m.Intent.PKB[:63] },
		"truncated proof":           func(m *Migration) { m.NewKeyProof = m.NewKeyProof[:len(m.NewKeyProof)-1] },
		"proof trailing bytes":      func(m *Migration) { m.NewKeyProof = append(m.NewKeyProof, 0) },
		"ML signature branch": func(m *Migration) {
			w, e := ynxbatch.DecodeWhole(m.NewKeyProof)
			authOK(t, e)
			w.Certificate.SigmaA[0] ^= 1
			m.NewKeyProof, e = ynxbatch.EncodeWhole(w)
			authOK(t, e)
		},
		"SLH signature branch": func(m *Migration) {
			w, e := ynxbatch.DecodeWhole(m.NewKeyProof)
			authOK(t, e)
			w.Certificate.SigmaB[0] ^= 1
			m.NewKeyProof, e = ynxbatch.EncodeWhole(w)
			authOK(t, e)
		},
		"mixed batch ML signature": func(m *Migration) {
			w, e := ynxbatch.DecodeWhole(m.NewKeyProof)
			authOK(t, e)
			w.Certificate.SigmaA = bytes.Clone(otherCert.Certificate.SigmaA)
			m.NewKeyProof, e = ynxbatch.EncodeWhole(w)
			authOK(t, e)
		},
		"mixed batch SLH signature": func(m *Migration) {
			w, e := ynxbatch.DecodeWhole(m.NewKeyProof)
			authOK(t, e)
			w.Certificate.SigmaB = bytes.Clone(otherCert.Certificate.SigmaB)
			m.NewKeyProof, e = ynxbatch.EncodeWhole(w)
			authOK(t, e)
		},
	} {
		t.Run(name, func(t *testing.T) {
			m := authCopyMigration(valid)
			change(&m)
			_, err := f.state.AdmitMigration(m, 10, 40)
			authReject(t, err)
		})
	}
	// Re-sign classic over mismatched full public keys: this isolates the new-pair
	// binding gate instead of failing only because a prior signature went stale.
	for _, branch := range []string{"A", "B"} {
		intent := authIntent(f, f.firstPublic, 0, 41, 20)
		if branch == "A" {
			intent.PKA = bytes.Clone(f.nextPublic.PKA)
		} else {
			intent.PKB = bytes.Clone(f.nextPublic.PKB)
		}
		m := authSignMigration(t, intent, f.classic, nil, f.first)
		_, err = f.state.AdmitMigration(m, 10, 40)
		authReject(t, err)
	}
	for name, spec := range map[string]struct {
		network        []byte
		owner, purpose string
		messages       [][]byte
	}{
		"proof wrong network": {authNetwork(t), f.owner, MigrationPurpose, [][]byte{message}},
		"proof wrong owner":   {f.state.NetworkID, qaFrom, MigrationPurpose, [][]byte{message}},
		"proof wrong purpose": {f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message}},
		"proof wrong message": {f.state.NetworkID, f.owner, MigrationPurpose, [][]byte{[]byte("TEST ONLY wrong intent")}},
		"proof N must be one": {f.state.NetworkID, f.owner, MigrationPurpose, [][]byte{message, message}},
	} {
		t.Run(name, func(t *testing.T) {
			m := authCopyMigration(valid)
			m.NewKeyProof, _ = authProof(t, f.first, spec.network, spec.owner, spec.purpose, spec.messages)
			_, err := f.state.AdmitMigration(m, 10, 40)
			authReject(t, err)
		})
	}
	if len(f.state.Records) != 0 {
		t.Fatal("rejected proposed keys polluted registration state")
	}
}

func TestActiveRotationRequiresCurrentPQAndBothBranches(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	valid := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 30), nil, f.first, f.next)
	other := authSignMigration(t, valid.Intent, nil, f.first, f.next)
	otherMember, err := ynxbatch.DecodeMember(other.CurrentPQProof)
	authOK(t, err)
	for name, change := range map[string]func(*Migration){
		"missing current":              func(m *Migration) { m.CurrentPQProof = nil },
		"unexpected classic pub":       func(m *Migration) { m.ClassicPublicKey = f.classic.PubKey().SerializeCompressed() },
		"unexpected classic signature": func(m *Migration) { m.ClassicSignature = []byte{1} },
		"wrong current ML": func(m *Migration) {
			p, e := ynxbatch.DecodeMember(m.CurrentPQProof)
			authOK(t, e)
			p.Certificate.SigmaA[0] ^= 1
			m.CurrentPQProof, e = ynxbatch.EncodeMember(p)
			authOK(t, e)
		},
		"wrong current SLH": func(m *Migration) {
			p, e := ynxbatch.DecodeMember(m.CurrentPQProof)
			authOK(t, e)
			p.Certificate.SigmaB[0] ^= 1
			m.CurrentPQProof, e = ynxbatch.EncodeMember(p)
			authOK(t, e)
		},
		"mixed current signature": func(m *Migration) {
			p, e := ynxbatch.DecodeMember(m.CurrentPQProof)
			authOK(t, e)
			p.Certificate.SigmaB = bytes.Clone(otherMember.Certificate.SigmaB)
			m.CurrentPQProof, e = ynxbatch.EncodeMember(p)
			authOK(t, e)
		},
		"changed intent nonce":      func(m *Migration) { m.Intent.LedgerNonce++ },
		"changed intent activation": func(m *Migration) { m.Intent.ActivateAt++ },
	} {
		t.Run(name, func(t *testing.T) {
			m := authCopyMigration(valid)
			change(&m)
			_, err := state.AdmitMigration(m, 20, 41)
			authReject(t, err)
		})
	}
	// A transaction-purpose authorization is not an account-rotation authorization.
	message, err := valid.Intent.SigningBytes()
	authOK(t, err)
	wrongPurpose := authCopyMigration(valid)
	_, wrongPurpose.CurrentPQProof = authProof(t, f.first, f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	_, err = state.AdmitMigration(wrongPurpose, 20, 41)
	authReject(t, err)
	if len(state.Records) != 1 {
		t.Fatal("failed rotation modified history")
	}
}

func TestStateMemberBindsFullExecutionMessageAndCurrentPair(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	message := authTransaction(t, f)
	_, wire := authProof(t, f.first, f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	authOK(t, state.VerifyMember(f.owner, TransactionPurpose, message, wire, 20))
	transfer, err := DecodeTransfer(message)
	authOK(t, err)
	transfer.Amount++
	changed, err := transfer.SigningBytes()
	authOK(t, err)
	authReject(t, state.VerifyMember(f.owner, TransactionPurpose, changed, wire, 20))
	authReject(t, state.VerifyMember(qaFrom, TransactionPurpose, message, wire, 20))
	authReject(t, state.VerifyMember(f.owner, MigrationPurpose, message, wire, 20))
	for _, key := range []*ynxbatch.PrivateKey{f.next} {
		_, wrong := authProof(t, key, f.state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, wrong, 20))
	}
	_, wrongNetwork := authProof(t, f.first, authNetwork(t), f.owner, TransactionPurpose, [][]byte{message})
	authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, wrongNetwork, 20))
	for _, branch := range []string{"A", "B"} {
		m, err := ynxbatch.DecodeMember(wire)
		authOK(t, err)
		if branch == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(m)
		authOK(t, err)
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, bad, 20))
	}
	for _, bad := range [][]byte{nil, wire[:len(wire)-1], append(bytes.Clone(wire), 0), make([]byte, ynxbatch.MaxMemberBytes+1)} {
		authReject(t, state.VerifyMember(f.owner, TransactionPurpose, message, bad, 20))
	}
}

func TestStateValidationAndMigrationEnvelopeRejectMalformedHistory(t *testing.T) {
	f := newAuthFixture(t)
	state, migration := authInitial(t, f)
	rotation := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 30), nil, f.first, f.next)
	history, err := state.AdmitMigration(rotation, 20, 41)
	authOK(t, err)
	for name, change := range map[string]func(*State){
		"version":                      func(s *State) { s.Version = "future" },
		"chain length":                 func(s *State) { s.NetworkID = s.NetworkID[:31] },
		"disabled activation":          func(s *State) { s.EnableAt = 0 },
		"registration before enable":   func(s *State) { s.Records[0].RegisteredAt = 9 },
		"same registration activation": func(s *State) { s.Records[0].ActiveFrom = s.Records[0].RegisteredAt },
		"missing revision one":         func(s *State) { s.Records[0].Revision = 2 },
		"skipped revision":             func(s *State) { s.Records[1].Revision = 3 },
		"pending replaced":             func(s *State) { s.Records[1].RegisteredAt = 19 },
		"nonce reused":                 func(s *State) { s.Records[1].LedgerNonce = s.Records[0].LedgerNonce },
		"wrong algorithm":              func(s *State) { s.Records[0].AlgorithmVersion = "classic" },
		"truncated ML public":          func(s *State) { s.Records[0].PKA = s.Records[0].PKA[:2591] },
		"truncated SLH public":         func(s *State) { s.Records[0].PKB = s.Records[0].PKB[:63] },
		"unsorted owners": func(s *State) {
			s.Records[0].Owner = "0xffffffffffffffffffffffffffffffffffffffff"
			s.Records[1].Owner = "0x0000000000000000000000000000000000000000"
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := history.Clone()
			change(&bad)
			authReject(t, bad.Validate(f.state.NetworkID))
		})
	}
	authReject(t, history.Validate(authNetwork(t)))
	authOK(t, (State{}).Validate(f.state.NetworkID))
	_, err = (State{}).AdmitMigration(migration, 10, 40)
	authReject(t, err)
	wire, err := migration.Encode()
	authOK(t, err)
	decoded, err := DecodeMigration(wire)
	authOK(t, err)
	if !reflect.DeepEqual(decoded, migration) {
		t.Fatal("migration envelope roundtrip changed bytes")
	}
	clear(wire)
	admitted, err := f.state.AdmitMigration(decoded, 10, 40)
	authOK(t, err)
	if len(admitted.Records) != 1 {
		t.Fatal("detached decoded envelope failed")
	}
	wire, err = migration.Encode()
	authOK(t, err)
	flds := authFields(t, wire, 6)
	flds[0] = []byte("wrong migration domain")
	for _, bad := range [][]byte{nil, wire[:len(wire)-1], append(bytes.Clone(wire), 0), authFrame(t, flds), make([]byte, MaxMigrationBytes+1)} {
		_, err := DecodeMigration(bad)
		authReject(t, err)
	}
	oversized := authCopyMigration(migration)
	oversized.NewKeyProof = make([]byte, MaxMigrationBytes+1)
	_, err = oversized.Encode()
	authReject(t, err)
}

func TestClassicMigrationCanonicalSecpAuthorization(t *testing.T) {
	f := newAuthFixture(t)
	intent := authIntent(f, f.firstPublic, 0, 41, 20)
	message, err := intent.SigningBytes()
	authOK(t, err)
	digest := sha256.Sum256(message)
	signature := ecdsa.Sign(f.classic, digest[:]).Serialize()
	pub := f.classic.PubKey().SerializeCompressed()
	authOK(t, VerifyClassicMigration(f.owner, message, pub, signature))
	authReject(t, VerifyClassicMigration(qaFrom, message, pub, signature))
	changed := bytes.Clone(message)
	changed[len(changed)-1] ^= 1
	authReject(t, VerifyClassicMigration(f.owner, changed, pub, signature))
	authReject(t, VerifyClassicMigration(f.owner, message, f.classic.PubKey().SerializeUncompressed(), signature))
	authReject(t, VerifyClassicMigration(f.owner, message, pub, append(bytes.Clone(signature), 0)))
	authReject(t, VerifyClassicMigration(f.owner, message, pub, make([]byte, 73)))
	var parsed struct{ R, S *big.Int }
	rest, err := asn1.Unmarshal(signature, &parsed)
	authOK(t, err)
	if len(rest) != 0 {
		t.Fatal("unexpected signature trailing bytes")
	}
	order, ok := new(big.Int).SetString("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)
	if !ok {
		t.Fatal("bad test curve order")
	}
	parsed.S = new(big.Int).Sub(order, parsed.S)
	highS, err := asn1.Marshal(parsed)
	authOK(t, err)
	authReject(t, VerifyClassicMigration(f.owner, message, pub, highS))
}

func TestLegacyGuardRejectsAddressAliasesAndInvalidPolicyState(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	alias, err := accountaddress.Encode(f.owner)
	authOK(t, err)
	// A guard must not return "classic allowed" and leave a subsequent ledger
	// normalization step to reinterpret the same input as a migrated account.
	for _, owner := range []string{strings.ToUpper(f.owner), alias, " " + f.owner, f.owner + " "} {
		authReject(t, state.RequireLegacy(owner, 20))
	}
	for name, invalid := range map[string]State{
		"unknown version":     {Version: "future-policy", NetworkID: bytes.Clone(f.state.NetworkID), EnableAt: 10},
		"partial empty state": {NetworkID: bytes.Clone(f.state.NetworkID)},
		"invalid network":     {Version: PolicyVersion, NetworkID: make([]byte, 31), EnableAt: 10},
	} {
		t.Run(name, func(t *testing.T) {
			authReject(t, invalid.Validate(f.state.NetworkID))
			authReject(t, invalid.RequireLegacy(f.owner, 20))
		})
	}
	// Valid historical legacy state and unrelated canonical accounts remain legal.
	authOK(t, (State{}).RequireLegacy(f.owner, 1))
	authOK(t, state.RequireLegacy(qaTo, 20))
}
