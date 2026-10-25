package ynxconsensusauth

import (
	"bytes"
	"testing"
)

func realKeyFixture(t *testing.T) (*CandidateKey, *registryFixture, Policy) {
	t.Helper()
	k, a, b, err := GenerateCandidateKey()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(k.Destroy)
	r := fixtureRegistry()
	r.record.MLDSA87PublicKey, r.record.SLHDSASHA2256fPublicKey = a, b
	return k, r, Policy{Version: ConsensusGenesisVersion, GenesisID: fixtureGenesis(), ChainID: "ynx-research-only", ActivationHeight: 100}
}

func TestCIRCLConsensusRealANDAndContext(t *testing.T) {
	k, r, policy := realKeyFixture(t)
	request := fixtureRequest(t, 100)
	wire, err := k.signRequest(request, r.record)
	if err != nil {
		t.Fatal(err)
	}
	v, err := NewCIRCLVerifier(policy, r, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := v.Verify(request, wire); err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"ML", "SLH"} {
		e, err := ParseEnvelope(wire)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "ML" {
			e.MLDSA87[100] ^= 1
		} else {
			e.SLHDSASHA2256f[100] ^= 1
		}
		bad, err := e.MarshalBinary()
		if err != nil || v.Verify(request, bad) == nil {
			t.Fatalf("%s corruption was accepted", branch)
		}
	}
	for _, mutate := range []func(*Request){
		func(q *Request) { q.height++ },
		func(q *Request) { q.round++ },
		func(q *Request) { q.kind = Prevote },
		func(q *Request) { q.canonical[0] ^= 1 },
		func(q *Request) { q.address[0] ^= 1 },
		func(q *Request) { q.chainID = "ynx-another" },
	} {
		q := fixtureRequest(t, 100)
		mutate(&q)
		if v.Verify(q, wire) == nil {
			t.Fatal("changed full consensus context accepted")
		}
	}
	r.record.Epoch++
	if v.Verify(request, wire) == nil {
		t.Fatal("retired epoch accepted")
	}
	r.record.Epoch--
	r.record.ValidUntilHeight = 100
	if v.Verify(request, wire) == nil {
		t.Fatal("revoked key accepted")
	}
	r.record.ValidUntilHeight = 0
	copyHandle := *k
	k.Destroy()
	if _, err := copyHandle.signRequest(request, r.record); err == nil {
		t.Fatal("copied handle survived destruction")
	}
}

func TestCIRCLConsensusDetachedPublicKeys(t *testing.T) {
	k, r, _ := realKeyFixture(t)
	pa, pb, err := k.publicMaterial()
	if err != nil {
		t.Fatal(err)
	}
	pa[0] ^= 1
	pb[0] ^= 1
	a, b, err := k.publicMaterial()
	if err != nil || !bytes.Equal(a, r.record.MLDSA87PublicKey) || !bytes.Equal(b, r.record.SLHDSASHA2256fPublicKey) {
		t.Fatal("caller mutated owned public material")
	}
}
