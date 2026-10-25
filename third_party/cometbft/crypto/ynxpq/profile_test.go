package ynxpq_test

import (
	"bytes"
	"testing"

	"github.com/cometbft/cometbft/crypto/ynxpq"
)

func TestConsensusProfileStrictCanonicalIdentityAndHeights(t *testing.T) {
	p := ynxpq.ConsensusProfile{GenesisID: bytes.Repeat([]byte{1}, 32), ChainID: "ynx-profile-qa", ParamsUpdateHeight: 10, ActivationHeight: 13, ScheduleHash: bytes.Repeat([]byte{2}, 32), RegistryRoot: bytes.Repeat([]byte{3}, 32)}
	wire, err := p.MarshalBinary()
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := ynxpq.DecodeConsensusProfile(wire)
	if err != nil {
		t.Fatal(err)
	}
	again, err := decoded.MarshalBinary()
	if err != nil || !bytes.Equal(wire, again) {
		t.Fatal("profile roundtrip differs", err)
	}
	for _, bad := range [][]byte{nil, wire[:len(wire)-1], append(bytes.Clone(wire), 0), append(bytes.Clone(wire), 0, 0, 0, 0), make([]byte, ynxpq.MaxConsensusProfileBytes+1)} {
		if _, err := ynxpq.DecodeConsensusProfile(bad); err == nil {
			t.Fatal("noncanonical profile accepted")
		}
	}
	for _, mutate := range []func(*ynxpq.ConsensusProfile){
		func(p *ynxpq.ConsensusProfile) { p.GenesisID = make([]byte, 32) },
		func(p *ynxpq.ConsensusProfile) { p.ChainID = string([]byte{0xff}) },
		func(p *ynxpq.ConsensusProfile) { p.ActivationHeight = 12 },
		func(p *ynxpq.ConsensusProfile) { p.ParamsUpdateHeight = 0 },
		func(p *ynxpq.ConsensusProfile) { p.ScheduleHash = nil },
		func(p *ynxpq.ConsensusProfile) { p.RegistryRoot = make([]byte, 32) },
	} {
		bad := p
		mutate(&bad)
		if _, err := bad.MarshalBinary(); err == nil {
			t.Fatal("invalid identity or timing accepted")
		}
	}
	wire[len(wire)-1] ^= 1
	if bytes.Equal(decoded.RegistryRoot, p.RegistryRoot) == false {
		t.Fatal("decoder retained input aliases")
	}
}
