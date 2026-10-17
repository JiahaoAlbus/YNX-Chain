package ynxauth

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"sort"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func revokeIntent(f authFixture, revision, through, nonce, height uint64) RevocationIntent {
	return RevocationIntent{ChainID: bytes.Clone(f.state.NetworkID), Owner: f.owner,
		PKA: bytes.Clone(f.firstPublic.PKA), PKB: bytes.Clone(f.firstPublic.PKB),
		AuthorizingRevision: revision, ThroughRevision: through, LedgerNonce: nonce,
		ExecuteAt: height, RevokeAt: height + 1}
}

func signRevocation(t testing.TB, intent RevocationIntent, key *ynxbatch.PrivateKey) Revocation {
	t.Helper()
	message, err := intent.SigningBytes()
	authOK(t, err)
	_, member := authProof(t, key, intent.ChainID, intent.Owner, RevocationPurpose, [][]byte{message})
	return Revocation{Intent: intent, CurrentPQProof: member}
}

func copyRevocation(r Revocation) Revocation {
	r.Intent.ChainID = bytes.Clone(r.Intent.ChainID)
	r.Intent.PKA = bytes.Clone(r.Intent.PKA)
	r.Intent.PKB = bytes.Clone(r.Intent.PKB)
	r.CurrentPQProof = bytes.Clone(r.CurrentPQProof)
	return r
}

func TestRevocationTerminalPreservesHistoricalPQAndNeverRestoresClassic(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	before := state.Clone()
	message := authTransaction(t, f)
	_, member := authProof(t, f.first, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	revoke := signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first)
	revoked, err := state.AdmitRevocation(revoke, 20, 41)
	authOK(t, err)
	if !reflect.DeepEqual(state, before) || !reflect.DeepEqual(revoked.Records, before.Records) || revoked.Version != PolicyRevocationVersion || len(revoked.Revocations) != 1 {
		t.Fatal("revocation mutated source state or registration history")
	}
	for _, height := range []uint64{20, 21, math.MaxUint64} {
		r, isPQ := revoked.PolicyAt(f.owner, height)
		if !isPQ || r.Revision != 1 || !errors.Is(revoked.RequireLegacy(f.owner, height), ErrPolicy) {
			t.Fatal("terminal revocation reopened classic authorization")
		}
		_, effective := revoked.RevocationAt(f.owner, height)
		if effective != (height >= 21) {
			t.Fatal("revocation effective height changed")
		}
	}
	authOK(t, revoked.RequireLegacy(f.owner, 19))
	authOK(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, member, 20))
	authReject(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, member, 21))
	intentBytes, err := revoke.Intent.SigningBytes()
	authOK(t, err)
	authOK(t, revoked.VerifyMember(f.owner, RevocationPurpose, intentBytes, revoke.CurrentPQProof, 20))
	// Even fully valid old-current and fresh proposed-key proofs cannot recover
	// a terminal account. Rotation is a separate operation performed beforehand.
	rotation := authSignMigration(t, authIntent(f, f.nextPublic, 1, 43, 30), nil, f.first, f.next)
	_, err = revoked.AdmitMigration(rotation, 20, 42)
	authReject(t, err)
	_, err = revoked.AdmitMigration(rotation, 21, 42)
	authReject(t, err)
	_, err = revoked.AdmitRevocation(revoke, 20, 41)
	authReject(t, err)
	encoded, err := json.Marshal(revoked)
	authOK(t, err)
	var restored State
	authOK(t, json.Unmarshal(encoded, &restored))
	authOK(t, restored.Validate(state.NetworkID))
	if !reflect.DeepEqual(restored, revoked) {
		t.Fatal("persisted public revocation history changed")
	}
	authOK(t, restored.VerifyMember(f.owner, TransactionPurpose, message, member, 20))
	authReject(t, restored.VerifyMember(f.owner, TransactionPurpose, message, member, 21))
	// Neither admission inputs nor Clone/query results can mutate stored state.
	revoke.Intent.PKA[0] ^= 1
	revoke.Intent.PKB[0] ^= 1
	revoke.Intent.ChainID[0] ^= 1
	detached := revoked.Clone()
	detached.Revocations[0].LedgerNonce++
	detached.Records[0].PKA[0] ^= 1
	detached.NetworkID[0] ^= 1
	trusted, err := revoked.TrustedRegistration(f.owner, TransactionPurpose, 20)
	authOK(t, err)
	trusted.PKA[0] ^= 1
	trusted.PKB[0] ^= 1
	trusted.ChainID[0] ^= 1
	*trusted.RevokedAt++
	if !reflect.DeepEqual(revoked, restored) {
		t.Fatal("revocation public slices or pointers escaped")
	}
}

func TestRevocationCancelsPendingRotationWithoutDeletingEitherFullPair(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	rotation := authSignMigration(t, authIntent(f, f.nextPublic, 1, 42, 30), nil, f.first, f.next)
	pending, err := state.AdmitMigration(rotation, 20, 41)
	authOK(t, err)
	valid := signRevocation(t, revokeIntent(f, 1, 2, 43, 20), f.first)
	revoked, err := pending.AdmitRevocation(valid, 20, 42)
	authOK(t, err)
	if !reflect.DeepEqual(revoked.Records, pending.Records) || revoked.Revocations[0].ThroughRevision != 2 {
		t.Fatal("pending key schedule was lost")
	}
	message := authTransaction(t, f)
	_, oldMember := authProof(t, f.first, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	_, nextMember := authProof(t, f.next, state.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	authOK(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, oldMember, 20))
	for _, height := range []uint64{21, 29, 30, math.MaxUint64} {
		authReject(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, oldMember, height))
		authReject(t, revoked.VerifyMember(f.owner, TransactionPurpose, message, nextMember, height))
		authReject(t, revoked.RequireLegacy(f.owner, height))
	}
	// The pending pair has proved possession, but is not yet lawful authority.
	wrong := valid.Intent
	wrong.PKA, wrong.PKB = bytes.Clone(f.nextPublic.PKA), bytes.Clone(f.nextPublic.PKB)
	_, err = pending.AdmitRevocation(signRevocation(t, wrong, f.next), 20, 42)
	authReject(t, err)
	stale := revokeIntent(f, 1, 1, 43, 20)
	_, err = pending.AdmitRevocation(signRevocation(t, stale, f.first), 20, 42)
	authReject(t, err)
}

func TestRevocationRequiresBothCurrentSignaturesAndExactAdmissionContext(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	before := state.Clone()
	valid := signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first)
	for name, change := range map[string]func(*Revocation){
		"missing current proof": func(r *Revocation) { r.CurrentPQProof = nil },
		"truncated proof":       func(r *Revocation) { r.CurrentPQProof = r.CurrentPQProof[:len(r.CurrentPQProof)-1] },
		"proof trailing bytes":  func(r *Revocation) { r.CurrentPQProof = append(r.CurrentPQProof, 0) },
		"changed full ML key":   func(r *Revocation) { r.Intent.PKA[0] ^= 1 },
		"changed full SLH key":  func(r *Revocation) { r.Intent.PKB[0] ^= 1 },
		"changed network":       func(r *Revocation) { r.Intent.ChainID[0] ^= 1 },
		"changed owner":         func(r *Revocation) { r.Intent.Owner = qaTo },
		"changed nonce":         func(r *Revocation) { r.Intent.LedgerNonce++ },
		"changed current revision": func(r *Revocation) {
			r.Intent.AuthorizingRevision, r.Intent.ThroughRevision = 2, 2
		},
		"changed latest revision": func(r *Revocation) { r.Intent.ThroughRevision++ },
		"same height revocation":  func(r *Revocation) { r.Intent.RevokeAt-- },
		"delayed revocation":      func(r *Revocation) { r.Intent.RevokeAt++ },
		"ML signature branch": func(r *Revocation) {
			member, e := ynxbatch.DecodeMember(r.CurrentPQProof)
			authOK(t, e)
			member.Certificate.SigmaA[0] ^= 1
			r.CurrentPQProof, e = ynxbatch.EncodeMember(member)
			authOK(t, e)
		},
		"SLH signature branch": func(r *Revocation) {
			member, e := ynxbatch.DecodeMember(r.CurrentPQProof)
			authOK(t, e)
			member.Certificate.SigmaB[0] ^= 1
			r.CurrentPQProof, e = ynxbatch.EncodeMember(member)
			authOK(t, e)
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyRevocation(valid)
			change(&bad)
			_, err := state.AdmitRevocation(bad, 20, 41)
			authReject(t, err)
		})
	}
	message, err := valid.Intent.SigningBytes()
	authOK(t, err)
	for name, spec := range map[string]struct {
		network        []byte
		owner, purpose string
		messages       [][]byte
	}{
		"proof network": {authNetwork(t), f.owner, RevocationPurpose, [][]byte{message}},
		"proof owner":   {state.NetworkID, qaTo, RevocationPurpose, [][]byte{message}},
		"proof purpose": {state.NetworkID, f.owner, TransactionPurpose, [][]byte{message}},
		"proof message": {state.NetworkID, f.owner, RevocationPurpose, [][]byte{[]byte("QA incorrect revocation")}},
		"proof N2":      {state.NetworkID, f.owner, RevocationPurpose, [][]byte{message, message}},
	} {
		t.Run(name, func(t *testing.T) {
			bad := copyRevocation(valid)
			_, bad.CurrentPQProof = authProof(t, f.first, spec.network, spec.owner, spec.purpose, spec.messages)
			_, err := state.AdmitRevocation(bad, 20, 41)
			authReject(t, err)
		})
	}
	// These are freshly signed intents, not merely mutations that invalidate an
	// otherwise stale signature. They isolate authority, nonce and height gates.
	for name, spec := range map[string]struct {
		intent        RevocationIntent
		height, nonce uint64
	}{
		"before first activation":          {revokeIntent(f, 1, 1, 42, 19), 19, 41},
		"delayed inclusion":                {revokeIntent(f, 1, 1, 42, 20), 21, 41},
		"wrong ledger nonce":               {revokeIntent(f, 1, 1, 42, 20), 20, 42},
		"nonce before latest registration": {revokeIntent(f, 1, 1, 41, 20), 20, 40},
		"overflow nonce":                   {revokeIntent(f, 1, 1, 42, 20), 20, math.MaxUint64},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := state.AdmitRevocation(signRevocation(t, spec.intent, f.first), spec.height, spec.nonce)
			authReject(t, err)
		})
	}
	_, err = state.AdmitRevocation(signRevocation(t, valid.Intent, f.next), 20, 41)
	authReject(t, err)
	_, err = f.state.AdmitRevocation(valid, 20, 41)
	authReject(t, err)
	if !reflect.DeepEqual(state, before) {
		t.Fatal("rejected revocation mutated authoritative policy")
	}
}

func TestRevocationWholeResolverRechecksTombstoneAndCachedHandles(t *testing.T) {
	f := newAuthFixture(t)
	current, _ := authInitial(t, f)
	message := authTransaction(t, f)
	whole, memberWire := authProof(t, f.first, current.NetworkID, f.owner, TransactionPurpose, [][]byte{message})
	member, err := ynxbatch.DecodeMember(memberWire)
	authOK(t, err)
	certificate, err := ynxbatch.EncodeCertificate(member.Certificate)
	authOK(t, err)
	verifier, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: current.NetworkID, Purpose: TransactionPurpose, CacheEntries: 1,
		ResolveTrustedOwner: func(request ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			return current.TrustedRegistration(request.Owner, request.Purpose, request.Height)
		}})
	authOK(t, err)
	defer verifier.Clear()
	handle, err := verifier.AuthenticateCertificate(certificate, 20)
	authOK(t, err)
	authOK(t, verifier.VerifyMember(handle, message, member.Proof, 20))
	current, err = current.AdmitRevocation(signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first), 20, 41)
	authOK(t, err)
	if !errors.Is(verifier.VerifyMember(handle, message, member.Proof, 20), ynxbatch.ErrHandle) {
		t.Fatal("cached handle ignored newly registered revocation")
	}
	authOK(t, verifier.VerifyWhole(whole, 20))
	authOK(t, verifier.VerifyOne(memberWire, 20))
	authReject(t, verifier.VerifyWhole(whole, 21))
	authReject(t, verifier.VerifyOne(memberWire, 21))
	_, err = current.TrustedRegistration(f.owner, TransactionPurpose, 21)
	if !errors.Is(err, ErrPolicy) {
		t.Fatal("unified resolver granted revoked account authority")
	}
}

func TestRevocationWireHighUint64AndV1JSONRemainExact(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	// This is the original v1 public serializer shape, without any new field.
	legacy := struct {
		Version   string   `json:"version"`
		NetworkID []byte   `json:"networkId"`
		EnableAt  uint64   `json:"enableAt"`
		Records   []Record `json:"records"`
	}{state.Version, state.NetworkID, state.EnableAt, state.Records}
	oldJSON, err := json.Marshal(legacy)
	authOK(t, err)
	currentJSON, err := json.Marshal(state)
	authOK(t, err)
	if !bytes.Equal(oldJSON, currentJSON) || PolicyVersion != "YNX-ACCOUNT-POLICY/v1" {
		t.Fatal("revocation silently changed v1 policy bytes")
	}
	intent := revokeIntent(f, 1, 1, 1<<55+43, 1<<60+7)
	valid := signRevocation(t, intent, f.first)
	wire, err := valid.Encode()
	authOK(t, err)
	decoded, err := DecodeRevocation(wire)
	authOK(t, err)
	if !reflect.DeepEqual(decoded, valid) {
		t.Fatal("revocation roundtrip changed complete bytes or uint64 high bits")
	}
	clear(wire)
	revoked, err := state.AdmitRevocation(decoded, intent.ExecuteAt, intent.LedgerNonce-1)
	authOK(t, err)
	if revoked.Revocations[0].RegisteredAt != intent.ExecuteAt || revoked.Revocations[0].RevokedFrom != intent.RevokeAt || revoked.Revocations[0].LedgerNonce != intent.LedgerNonce {
		t.Fatal("revocation admission truncated uint64")
	}
	wire, err = valid.Encode()
	authOK(t, err)
	fields := authFields(t, wire, 3)
	fields[0] = []byte(MigrationDomain)
	for _, invalid := range [][]byte{nil, wire[:len(wire)-1], append(bytes.Clone(wire), 0), authFrame(t, fields), make([]byte, MaxRevocationBytes+1)} {
		_, err = DecodeRevocation(invalid)
		authReject(t, err)
	}
	intentWire, err := valid.Intent.SigningBytes()
	authOK(t, err)
	for name, mutate := range map[string]func([][]byte){
		"domain":  func(f [][]byte) { f[0] = []byte(RegistrationDomain) },
		"version": func(f [][]byte) { f[1] = ynxbatch.U32(2) },
		"suite":   func(f [][]byte) { f[4] = []byte("classic") },
		"u64":     func(f [][]byte) { f[7] = append(f[7], 0) },
	} {
		t.Run(name, func(t *testing.T) {
			f := authFields(t, intentWire, 17)
			mutate(f)
			_, err := DecodeRevocationIntent(authFrame(t, f))
			authReject(t, err)
		})
	}
	for _, bad := range []RevocationIntent{revokeIntent(f, 0, 1, 42, 20), revokeIntent(f, 2, 1, 42, 20), revokeIntent(f, 1, 1, 0, 20), revokeIntent(f, 1, 1, 42, 0), revokeIntent(f, 1, 1, 42, math.MaxUint64)} {
		_, err = bad.SigningBytes()
		authReject(t, err)
	}
	oversized := copyRevocation(valid)
	oversized.CurrentPQProof = make([]byte, MaxRevocationBytes)
	_, err = oversized.Encode()
	authReject(t, err)
}

func TestRevocationUnsignedIndependentNodeWireVector(t *testing.T) {
	// Public syntax vector only. These patterned bytes are never admitted as
	// account keys or substituted for the real fresh-key acceptance tests above.
	intent := RevocationIntent{ChainID: make([]byte, 32), Owner: "0x1111111111111111111111111111111111111111", PKA: make([]byte, ynxbatch.PublicKeyASize), PKB: make([]byte, ynxbatch.PublicKeyBSize), AuthorizingRevision: 1<<35 + 3, ThroughRevision: 1<<35 + 4, LedgerNonce: 1<<55 + 5, ExecuteAt: 1<<48 + 19, RevokeAt: 1<<48 + 20}
	for i := range intent.ChainID {
		intent.ChainID[i] = byte(i)
	}
	for i := range intent.PKA {
		intent.PKA[i] = byte(i)
	}
	for i := range intent.PKB {
		intent.PKB[i] = byte(255 - i)
	}
	wire, err := intent.SigningBytes()
	authOK(t, err)
	digest := sha256.Sum256(wire)
	// Generated by independent Node Buffer framing with BigInt, recorded in the
	// revocation contract. SHA256 is only this test vector's byte-equality oracle.
	if len(wire) != 2885 || hex.EncodeToString(digest[:]) != "4a79f4f550d9f297b9d6bbff1a6413a1d1a8d477f1b8d52dea14d1a085e27a10" {
		t.Fatal("revocation bytes differ from independent high-U64 Node vector")
	}
	decoded, err := DecodeRevocationIntent(wire)
	authOK(t, err)
	if !reflect.DeepEqual(decoded, intent) {
		t.Fatal("independent revocation vector changed on decode")
	}
}

func TestRevocationStateRejectsMissingRewrittenAndUnorderedTombstones(t *testing.T) {
	f := newAuthFixture(t)
	state, _ := authInitial(t, f)
	revoked, err := state.AdmitRevocation(signRevocation(t, revokeIntent(f, 1, 1, 42, 20), f.first), 20, 41)
	authOK(t, err)
	for name, mutate := range map[string]func(*State){
		"v1 tombstone":           func(s *State) { s.Version = PolicyVersion },
		"v2 without tombstone":   func(s *State) { s.Revocations = nil },
		"unknown version":        func(s *State) { s.Version = "YNX-ACCOUNT-POLICY/v3" },
		"duplicate tombstone":    func(s *State) { s.Revocations = append(s.Revocations, s.Revocations[0]) },
		"unknown owner":          func(s *State) { s.Revocations[0].Owner = qaTo },
		"noncanonical owner":     func(s *State) { s.Revocations[0].Owner = " " + s.Revocations[0].Owner },
		"wrong current revision": func(s *State) { s.Revocations[0].AuthorizingRevision++ },
		"wrong through revision": func(s *State) { s.Revocations[0].ThroughRevision++ },
		"nonce reused":           func(s *State) { s.Revocations[0].LedgerNonce = s.Records[0].LedgerNonce },
		"same height effective":  func(s *State) { s.Revocations[0].RevokedFrom-- },
		"before first activation": func(s *State) {
			s.Revocations[0].RegisteredAt, s.Revocations[0].RevokedFrom = 19, 20
		},
		"later registration": func(s *State) {
			r := s.Records[0]
			r.Revision, r.RegisteredAt, r.ActiveFrom, r.LedgerNonce = 2, 21, 30, 43
			s.Records = append(s.Records, r)
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := revoked.Clone()
			mutate(&bad)
			authReject(t, bad.Validate(state.NetworkID))
			authReject(t, bad.RequireLegacy(f.owner, 21))
			_, err := bad.TrustedRegistration(f.owner, TransactionPurpose, 20)
			authReject(t, err)
		})
	}
	// Distinct accounts can revoke independently; sorted insertion must preserve
	// both original immutable tombstones and all full-key registration histories.
	other := newAuthFixture(t)
	other.state.NetworkID = bytes.Clone(state.NetworkID)
	initial := authSignMigration(t, authIntent(other, other.firstPublic, 0, 41, 22), other.classic, nil, other.first)
	combined, err := revoked.AdmitMigration(initial, 21, 40)
	authOK(t, err)
	both, err := combined.AdmitRevocation(signRevocation(t, revokeIntent(other, 1, 1, 42, 22), other.first), 22, 41)
	authOK(t, err)
	if len(both.Revocations) != 2 || !sort.SliceIsSorted(both.Revocations, func(i, j int) bool { return both.Revocations[i].Owner < both.Revocations[j].Owner }) {
		t.Fatal("per-account revocations are not retained in canonical order")
	}
	first, ok := both.RevocationAt(f.owner, 23)
	if !ok || first != revoked.Revocations[0] {
		t.Fatal("independent revocation changed original tombstone")
	}
	bad := both.Clone()
	bad.Revocations[0], bad.Revocations[1] = bad.Revocations[1], bad.Revocations[0]
	authReject(t, bad.Validate(state.NetworkID))
}
