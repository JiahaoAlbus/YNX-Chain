package ynxconsensusauth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

type registrationStateFixture struct {
	anchor          RegistryAnchor
	address, legacy []byte
	calls           int
	mutate          func(*RegistrationState)
	err             error
}

func (s *registrationStateFixture) ConsensusRegistrationStateAt(_ []byte, _ string, _ []byte, height int64) (RegistrationState, error) {
	s.calls++
	if s.err != nil {
		return RegistrationState{}, s.err
	}
	state := RegistrationState{GenesisID: bytes.Clone(s.anchor.GenesisID), ChainID: s.anchor.ChainID, ValidatorAddress: bytes.Clone(s.address), Height: height, VotingPower: 7, LegacyEd25519PublicKey: bytes.Clone(s.legacy)}
	if s.mutate != nil {
		s.mutate(&state)
	}
	return state, nil
}

type registrationFixture struct {
	anchor  RegistryAnchor
	address []byte
	legacy  ed25519.PrivateKey
	keys    [3]*CandidateKey
	pa, pb  [3][]byte
	source  *registrationStateFixture
}

func newRegistrationFixture(t *testing.T) *registrationFixture {
	t.Helper()
	f := &registrationFixture{anchor: RegistryAnchor{GenesisID: bytes.Repeat([]byte{0xa7}, 32), ChainID: "ynx-registry-test"}, legacy: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x42}, ed25519.SeedSize))}
	legacy := f.legacy.Public().(ed25519.PublicKey)
	address := sha256.Sum256(legacy)
	f.address = bytes.Clone(address[:validatorAddressSize])
	for i := range f.keys {
		var err error
		f.keys[i], f.pa[i], f.pb[i], err = GenerateCandidateKey()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(f.keys[i].Destroy)
	}
	f.source = &registrationStateFixture{anchor: f.anchor, address: f.address, legacy: bytes.Clone(legacy)}
	return f
}

// Test-only access to primitive keys signs registration domains. Production
// CandidateKey still exposes no raw signer and no second HRS implementation.
func signRegistrationPairForTest(t *testing.T, key *CandidateKey, message []byte) ([]byte, []byte) {
	t.Helper()
	key.state.mu.Lock()
	defer key.state.mu.Unlock()
	a := make([]byte, MLDSA87SignatureSize)
	if err := mldsa87.SignTo(key.state.a, message, nil, false, a); err != nil {
		t.Fatal(err)
	}
	b, err := slhdsa.SignRandomized(key.state.b, rand.Reader, slhdsa.NewMessage(message), nil)
	if err != nil {
		t.Fatal(err)
	}
	return a, b
}

func (f *registrationFixture) first() RegistrationIntent {
	return RegistrationIntent{Kind: RegisterValidator, GenesisID: bytes.Clone(f.anchor.GenesisID), ChainID: f.anchor.ChainID, ValidatorAddress: bytes.Clone(f.address), Sequence: 1, Epoch: 1, ApprovedAt: 10, EffectiveAt: 12, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(f.legacy.Public().(ed25519.PublicKey)), MLDSA87PublicKey: bytes.Clone(f.pa[0]), SLHDSASHA2256fPublicKey: bytes.Clone(f.pb[0])}
}

func (f *registrationFixture) successor(t *testing.T, previous []byte, kind RegistrationKind, sequence, authorizing, epoch uint64, approved, effective int64, authorityIndex, newIndex int) RegistrationIntent {
	t.Helper()
	hash, err := RegistrationHash(previous)
	if err != nil {
		t.Fatal(err)
	}
	i := RegistrationIntent{Kind: kind, GenesisID: bytes.Clone(f.anchor.GenesisID), ChainID: f.anchor.ChainID, ValidatorAddress: bytes.Clone(f.address), Sequence: sequence, AuthorizingEpoch: authorizing, Epoch: epoch, ApprovedAt: approved, EffectiveAt: effective, PreviousEventHash: bytes.Clone(hash[:]), AuthorityMLDSA87PublicKey: bytes.Clone(f.pa[authorityIndex]), AuthoritySLHDSASHA2256fPublicKey: bytes.Clone(f.pb[authorityIndex])}
	if kind != RevokeValidator {
		i.MLDSA87PublicKey, i.SLHDSASHA2256fPublicKey = bytes.Clone(f.pa[newIndex]), bytes.Clone(f.pb[newIndex])
	}
	return i
}

func (f *registrationFixture) sign(t *testing.T, i RegistrationIntent, authorityIndex, newIndex int) []byte {
	t.Helper()
	r := Registration{Intent: i}
	message, err := i.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if i.Kind == RegisterValidator {
		r.LegacyApproval = ed25519.Sign(f.legacy, message)
	} else {
		r.AuthorityMLDSA87, r.AuthoritySLHDSASHA2256f = signRegistrationPairForTest(t, f.keys[authorityIndex], message)
	}
	if i.Kind != RevokeValidator {
		pop, err := i.PossessionSigningBytes()
		if err != nil {
			t.Fatal(err)
		}
		r.PossessionMLDSA87, r.PossessionSLHDSASHA2256f = signRegistrationPairForTest(t, f.keys[newIndex], pop)
	}
	wire, err := r.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	return wire
}

func mustAppendRegistration(t *testing.T, history *KeyHistory, wire []byte, source RegistrationStateSource) *KeyHistory {
	t.Helper()
	r, err := DecodeRegistration(wire)
	if err != nil {
		t.Fatal(err)
	}
	next, err := history.Append(wire, r.Intent.ApprovedAt, source)
	if err != nil {
		t.Fatal(err)
	}
	return next
}

func TestRegistrationStrictCodecAndFullWidthIntegers(t *testing.T) {
	// Shape-only fixture; these zero signatures do not establish authorization.
	i := RegistrationIntent{Kind: RotateValidator, GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: "codec", ValidatorAddress: bytes.Repeat([]byte{2}, 20), Sequence: math.MaxUint64, AuthorizingEpoch: math.MaxUint64 - 1, Epoch: math.MaxUint64, ApprovedAt: math.MaxInt64 - 2, EffectiveAt: math.MaxInt64, PreviousEventHash: bytes.Repeat([]byte{3}, 32), AuthorityMLDSA87PublicKey: make([]byte, MLDSA87PublicKeySize), AuthoritySLHDSASHA2256fPublicKey: make([]byte, SLHDSASHA2256fPublicKeySize), MLDSA87PublicKey: make([]byte, MLDSA87PublicKeySize), SLHDSASHA2256fPublicKey: make([]byte, SLHDSASHA2256fPublicKeySize)}
	r := Registration{Intent: i, AuthorityMLDSA87: make([]byte, MLDSA87SignatureSize), AuthoritySLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize), PossessionMLDSA87: make([]byte, MLDSA87SignatureSize), PossessionSLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize)}
	wire, err := r.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeRegistration(wire)
	if err != nil {
		t.Fatal(err)
	}
	again, err := decoded.MarshalBinary()
	if err != nil || !bytes.Equal(wire, again) || decoded.Intent.Epoch != math.MaxUint64 || decoded.Intent.ApprovedAt != math.MaxInt64-2 {
		t.Fatal("codec lost exact high/low U32 values")
	}
	body, _ := i.MarshalBinary()
	fields, _ := regDecode(body, 22, MaxRegistrationIntentBytes)
	for _, n := range []int{1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15} {
		if len(fields[n]) != 4 {
			t.Fatalf("integer field %d not U32", n)
		}
	}
	mutations := map[string]func([][]byte){
		"version":         func(f [][]byte) { f[1] = regU32(2) },
		"kind":            func(f [][]byte) { f[2] = regU32(9) },
		"genesis":         func(f [][]byte) { f[3] = make([]byte, 32) },
		"wrong width":     func(f [][]byte) { f[6] = make([]byte, 8) },
		"overflow height": func(f [][]byte) { f[12] = regU32(math.MaxUint32) },
		"H+1": func(f [][]byte) {
			f[14], f[15] = regPair(uint64(i.ApprovedAt + 1))[0], regPair(uint64(i.ApprovedAt + 1))[1]
		},
		"unknown branch size": func(f [][]byte) { f[21] = make([]byte, 32) },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			f, _ := regDecode(body, 22, MaxRegistrationIntentBytes)
			mutate(f)
			bad, _ := regEncode(MaxRegistrationIntentBytes, f...)
			if _, err := DecodeRegistrationIntent(bad); err == nil {
				t.Fatal("accepted malformed intent")
			}
		})
	}
	for _, bad := range [][]byte{wire[:len(wire)-1], append(bytes.Clone(wire), 0), make([]byte, MaxRegistrationBytes+1), {0xff, 0xff, 0xff, 0xff}} {
		if _, err := DecodeRegistration(bad); err == nil {
			t.Fatal("accepted malformed operation frame")
		}
	}
	f, _ := regDecode(wire, 8, MaxRegistrationBytes)
	f[4] = f[4][:len(f[4])-1]
	bad, _ := regEncode(MaxRegistrationBytes, f...)
	if _, err := DecodeRegistration(bad); err == nil {
		t.Fatal("accepted short authority branch")
	}
	before := bytes.Clone(decoded.Intent.GenesisID)
	clear(wire)
	if !bytes.Equal(before, decoded.Intent.GenesisID) {
		t.Fatal("decoder retained caller aliases")
	}
	tooLate := i
	tooLate.ApprovedAt = math.MaxInt64 - 1
	if _, err := tooLate.MarshalBinary(); err == nil {
		t.Fatal("H+2 arithmetic overflow")
	}
}

func TestRegistrationRealAuthorityPoPAndEveryBoundField(t *testing.T) {
	f := newRegistrationFixture(t)
	first := f.sign(t, f.first(), 0, 0)
	rotation := f.sign(t, f.successor(t, first, RotateValidator, 2, 1, 2, 15, 20, 0, 1), 0, 1)
	revocation := f.sign(t, f.successor(t, rotation, RevokeValidator, 3, 1, 2, 16, 18, 0, 0), 0, 0)
	for _, wire := range [][]byte{first, rotation, revocation} {
		r, _ := DecodeRegistration(wire)
		if err := verifyRegistration(r); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"legacy", "authority A", "authority B", "possession A", "possession B"} {
			x, _ := DecodeRegistration(wire)
			var proof *[]byte
			switch name {
			case "legacy":
				proof = &x.LegacyApproval
			case "authority A":
				proof = &x.AuthorityMLDSA87
			case "authority B":
				proof = &x.AuthoritySLHDSASHA2256f
			case "possession A":
				proof = &x.PossessionMLDSA87
			case "possession B":
				proof = &x.PossessionSLHDSASHA2256f
			}
			if len(*proof) == 0 {
				continue
			}
			(*proof)[17] ^= 1
			if verifyRegistration(x) == nil {
				t.Fatalf("accepted corrupt %s", name)
			}
		}
	}
	for name, tc := range map[string]struct {
		wire   []byte
		mutate func(*Registration)
	}{
		"first missing old approval":   {first, func(r *Registration) { r.LegacyApproval = nil }},
		"first extra PQ authority":     {first, func(r *Registration) { r.AuthorityMLDSA87 = make([]byte, MLDSA87SignatureSize) }},
		"first missing PoP A":          {first, func(r *Registration) { r.PossessionMLDSA87 = nil }},
		"first missing PoP B":          {first, func(r *Registration) { r.PossessionSLHDSASHA2256f = nil }},
		"rotation classic fallback":    {rotation, func(r *Registration) { r.LegacyApproval = make([]byte, ed25519.SignatureSize) }},
		"rotation missing authority A": {rotation, func(r *Registration) { r.AuthorityMLDSA87 = nil }},
		"rotation missing authority B": {rotation, func(r *Registration) { r.AuthoritySLHDSASHA2256f = nil }},
		"revocation extraneous PoP":    {revocation, func(r *Registration) { r.PossessionMLDSA87 = make([]byte, MLDSA87SignatureSize) }},
		"revocation proposed keys": {revocation, func(r *Registration) {
			r.Intent.MLDSA87PublicKey = bytes.Clone(f.pa[2])
			r.Intent.SLHDSASHA2256fPublicKey = bytes.Clone(f.pb[2])
		}},
	} {
		t.Run(name, func(t *testing.T) {
			r, _ := DecodeRegistration(tc.wire)
			tc.mutate(&r)
			if _, err := r.MarshalBinary(); err == nil {
				t.Fatal("accepted omitted or extraneous authorization branch")
			}
		})
	}
	for name, mutate := range map[string]func(*RegistrationIntent){
		"genesis":          func(i *RegistrationIntent) { i.GenesisID[0] ^= 1 },
		"chain":            func(i *RegistrationIntent) { i.ChainID = "another-chain" },
		"logical address":  func(i *RegistrationIntent) { i.ValidatorAddress[0] ^= 1 },
		"sequence":         func(i *RegistrationIntent) { i.Sequence++ },
		"epochs":           func(i *RegistrationIntent) { i.AuthorizingEpoch++; i.Epoch++ },
		"approval height":  func(i *RegistrationIntent) { i.ApprovedAt++ },
		"effective height": func(i *RegistrationIntent) { i.EffectiveAt++ },
		"previous event":   func(i *RegistrationIntent) { i.PreviousEventHash[0] ^= 1 },
		"authority A":      func(i *RegistrationIntent) { i.AuthorityMLDSA87PublicKey[0] ^= 1 },
		"authority B":      func(i *RegistrationIntent) { i.AuthoritySLHDSASHA2256fPublicKey[0] ^= 1 },
		"new A":            func(i *RegistrationIntent) { i.MLDSA87PublicKey[0] ^= 1 },
		"new B":            func(i *RegistrationIntent) { i.SLHDSASHA2256fPublicKey[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			r, _ := DecodeRegistration(rotation)
			mutate(&r.Intent)
			if verifyRegistration(r) == nil {
				t.Fatal("changed full signed field accepted")
			}
		})
	}
	r, _ := DecodeRegistration(first)
	auth, _ := r.Intent.AuthoritySigningBytes()
	pop, _ := r.Intent.PossessionSigningBytes()
	if bytes.Equal(auth, pop) || !bytes.Contains(auth, f.pa[0]) || !bytes.Contains(pop, f.pb[0]) {
		t.Fatal("domains or complete key payload missing")
	}
	r.PossessionMLDSA87, r.PossessionSLHDSASHA2256f = signRegistrationPairForTest(t, f.keys[0], auth)
	if verifyRegistration(r) == nil {
		t.Fatal("authority-domain signature used as PoP")
	}
	r, _ = DecodeRegistration(rotation)
	auth, _ = r.Intent.AuthoritySigningBytes()
	r.AuthorityMLDSA87, r.AuthoritySLHDSASHA2256f = signRegistrationPairForTest(t, f.keys[1], auth)
	if verifyRegistration(r) == nil {
		t.Fatal("new-key-only rotation accepted")
	}
	// The injected spy is reachable only through this private helper; Append
	// installs real CIRCL and has no caller-supplied signature callback.
	for _, failA := range []bool{false, true} {
		for _, failB := range []bool{false, true} {
			p := &providerSpy{mutate: true}
			if failA {
				p.errA = errors.New("A")
			}
			if failB {
				p.errB = errors.New("B")
			}
			err := verifyRegistrationPair(p, f.pa[0], f.pb[0], pop, make([]byte, MLDSA87SignatureSize), make([]byte, SLHDSASHA2256fSignatureSize))
			if (err != nil) != (failA || failB) || p.callsA != 1 || p.callsB != 1 || !bytes.Equal(p.messages[0], pop) || !bytes.Equal(p.messages[1], pop) {
				t.Fatal("registration AND or detached complete messages failed")
			}
		}
	}
}

func TestRegistrationTrustedMembershipAndNoFallback(t *testing.T) {
	f := newRegistrationFixture(t)
	h, err := NewKeyHistory(f.anchor)
	if err != nil {
		t.Fatal(err)
	}
	wire := f.sign(t, f.first(), 0, 0)
	root := h.Root()
	for name, mutate := range map[string]func(*RegistrationState){
		"network": func(s *RegistrationState) { s.GenesisID[0] ^= 1 }, "chain": func(s *RegistrationState) { s.ChainID = "wrong" }, "address": func(s *RegistrationState) { s.ValidatorAddress[0] ^= 1 }, "height": func(s *RegistrationState) { s.Height++ }, "membership": func(s *RegistrationState) { s.VotingPower = 0 }, "old key": func(s *RegistrationState) { s.LegacyEd25519PublicKey[0] ^= 1 },
	} {
		t.Run(name, func(t *testing.T) {
			f.source.mutate = mutate
			if _, err := h.Append(wire, 10, f.source); err == nil {
				t.Fatal("untrusted membership source accepted")
			}
			if h.Root() != root || h.EventCount() != 0 {
				t.Fatal("failed append mutated prior history")
			}
		})
	}
	f.source.mutate = nil
	if _, err := h.Append(wire, 11, f.source); err == nil {
		t.Fatal("execution height replay accepted")
	}
	if _, err := h.Append(wire, 10, nil); err == nil {
		t.Fatal("nil source accepted")
	}
	f.source.err = errors.New("historical source unavailable")
	if _, err := h.Append(wire, 10, f.source); err == nil {
		t.Fatal("missing historical membership accepted")
	}
	f.source.err = nil
	h1 := mustAppendRegistration(t, h, wire, f.source)
	if _, err := h1.Append(wire, 10, f.source); err == nil {
		t.Fatal("duplicate registration replay accepted")
	}
	if !h1.HasPQHistory(f.address) {
		t.Fatal("registration history missing")
	}
	for _, height := range []int64{10, 11} {
		if _, err := h1.ConsensusKeysAt(f.anchor.ChainID, f.address, height); !errors.Is(err, ErrValidatorKeyUnavailable) {
			t.Fatal("key activated before H+2")
		}
	}
	if _, err := h1.ConsensusKeysAt("wrong", f.address, 12); err == nil {
		t.Fatal("wrong-chain lookup")
	}
	for _, branch := range []string{"A", "B"} {
		i := f.successor(t, wire, RotateValidator, 2, 1, 2, 15, 20, 0, 1)
		if branch == "A" {
			i.MLDSA87PublicKey = bytes.Clone(f.pa[0])
		} else {
			i.SLHDSASHA2256fPublicKey = bytes.Clone(f.pb[0])
		}
		r := Registration{Intent: i, AuthorityMLDSA87: make([]byte, MLDSA87SignatureSize), AuthoritySLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize), PossessionMLDSA87: make([]byte, MLDSA87SignatureSize), PossessionSLHDSASHA2256f: make([]byte, SLHDSASHA2256fSignatureSize)}
		bad, _ := r.MarshalBinary()
		if _, err := h1.Append(bad, 15, f.source); err == nil || !strings.Contains(err.Error(), "historical key branch") {
			t.Fatalf("reused %s was not explicitly rejected: %v", branch, err)
		}
	}
	// A new full pair alone, without the old approval, cannot enter history.
	r, _ := DecodeRegistration(wire)
	r.LegacyApproval = make([]byte, ed25519.SignatureSize)
	bad, _ := r.MarshalBinary()
	if _, err := h.Append(bad, 10, f.source); err == nil {
		t.Fatal("new PoP alone authorized first registration")
	}
}

func TestRegistrationFrameLengthIsCheckedBeforeCopy(t *testing.T) {
	for _, n := range []uint32{math.MaxUint32, MaxRegistrationBytes} {
		wire := make([]byte, 8)
		binary.BigEndian.PutUint32(wire, n)
		if _, err := DecodeRegistration(wire); err == nil {
			t.Fatal("oversized field accepted")
		}
	}
	if _, err := regDecode([]byte{}, math.MaxInt, MaxRegistrationBytes); err == nil {
		t.Fatal("unbounded field-list allocation")
	}
}
