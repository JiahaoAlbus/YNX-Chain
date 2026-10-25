package ynxconsensusauth

import (
	"bytes"
	"testing"
)

func TestCandidateRegistrationPossessionOnlyFullNewPairDomain(t *testing.T) {
	f := newRegistrationFixture(t)
	i := f.first()
	a, b, err := f.keys[0].RegistrationPossession(i)
	if err != nil {
		t.Fatal(err)
	}
	pop, err := i.PossessionSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if err = verifyRegistrationPair(CIRCLProvider{}, f.pa[0], f.pb[0], pop, a, b); err != nil {
		t.Fatal(err)
	}
	authority, err := i.AuthoritySigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if verifyRegistrationPair(CIRCLProvider{}, f.pa[0], f.pb[0], authority, a, b) == nil {
		t.Fatal("new-key possession became current authority")
	}
	i.GenesisID = bytes.Clone(i.GenesisID)
	i.GenesisID[0] ^= 1
	changed, err := i.PossessionSigningBytes()
	if err != nil {
		t.Fatal(err)
	}
	if verifyRegistrationPair(CIRCLProvider{}, f.pa[0], f.pb[0], changed, a, b) == nil {
		t.Fatal("possession proof ignored complete genesis-bound intent")
	}
	first := f.sign(t, f.first(), 0, 0)
	rotate := f.successor(t, first, RotateValidator, 2, 1, 2, 15, 17, 0, 1)
	a, b, err = f.keys[1].RegistrationPossession(rotate)
	if err != nil {
		t.Fatal(err)
	}
	pop, err = rotate.PossessionSigningBytes()
	if err != nil || verifyRegistrationPair(CIRCLProvider{}, f.pa[1], f.pb[1], pop, a, b) != nil {
		t.Fatal("new rotation pair proof failed", err)
	}
	wrong := rotate
	wrong.SLHDSASHA2256fPublicKey = bytes.Clone(f.pb[2])
	for _, invalid := range []RegistrationIntent{wrong, {Kind: 99}, f.successor(t, first, RevokeValidator, 2, 1, 1, 15, 17, 0, 0)} {
		a, b, err = f.keys[1].RegistrationPossession(invalid)
		if err == nil || len(a) != 0 || len(b) != 0 {
			t.Fatal("invalid possession intent returned partial proof")
		}
	}
	f.keys[1].Destroy()
	for _, key := range []*CandidateKey{nil, {}, f.keys[1]} {
		a, b, err = key.RegistrationPossession(rotate)
		if err == nil || len(a) != 0 || len(b) != 0 {
			t.Fatal("missing/destroyed key signed possession")
		}
	}
}
