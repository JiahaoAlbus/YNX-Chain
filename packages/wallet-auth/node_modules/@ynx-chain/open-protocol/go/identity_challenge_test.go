package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

type challengeVector struct {
	Input struct {
		RealmHex, TenantHex, AgentIDHex, Epoch, AudienceHex, ChannelBindingHex, NonceHex, IssuedAt, ExpiresAt string
		NetworkBinding                                                                                        struct{ Kind, GenesisHex, NativeChainID, NetworkIDHex string }
	}
	WireHex string
}

func challengeVectors(t *testing.T) []challengeVector {
	t.Helper()
	var v struct{ Vectors []challengeVector }
	raw, e := os.ReadFile("../test/fixtures/identity-challenge-v1.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	return v.Vectors
}
func challengeInput(t *testing.T, v challengeVector) IdentityChallengeV1DATA {
	t.Helper()
	hx := func(s string) []byte {
		b, e := hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	u := func(s string) uint64 {
		n, e := strconv.ParseUint(s, 10, 64)
		if e != nil {
			t.Fatal(e)
		}
		return n
	}
	a := v.Input
	n := NetworkBindingV1{Kind: a.NetworkBinding.Kind}
	if n.Kind == "ynx-chain" {
		n.Genesis = hx(a.NetworkBinding.GenesisHex)
		n.NetworkID = hx(a.NetworkBinding.NetworkIDHex)
		n.NativeChainID = u(a.NetworkBinding.NativeChainID)
	}
	return IdentityChallengeV1DATA{Realm: hx(a.RealmHex), Tenant: hx(a.TenantHex), AgentID: hx(a.AgentIDHex), Epoch: u(a.Epoch), Audience: hx(a.AudienceHex), ChannelBinding: hx(a.ChannelBindingHex), Nonce: hx(a.NonceHex), IssuedAt: u(a.IssuedAt), ExpiresAt: u(a.ExpiresAt), NetworkBinding: n}
}
func TestOPEN02NewIdentityChallengeSharedVectors(t *testing.T) {
	for _, v := range challengeVectors(t) {
		c := challengeInput(t, v)
		wire, e := EncodeIdentityChallengeV1DATA(c)
		if e != nil || hex.EncodeToString(wire) != v.WireHex {
			t.Fatalf("new typed vector differs: %v", e)
		}
		d, e := DecodeIdentityChallengeV1DATA(wire)
		if e != nil {
			t.Fatal(e)
		}
		if d.Epoch != 9007199254740993 {
			t.Fatal("epoch truncated")
		}
		again, e := EncodeIdentityChallengeV1DATA(d)
		if e != nil || !bytes.Equal(again, wire) {
			t.Fatal("roundtrip differs")
		}
	}
}
func TestOPEN02ChallengeBindingsAndRefusals(t *testing.T) {
	c := challengeInput(t, challengeVectors(t)[0])
	wire, _ := EncodeIdentityChallengeV1DATA(c)
	f, _ := DecodeFields(wire, 11)
	f[1], f[3] = f[3], f[1]
	changed, _ := EncodeFields(f...)
	d, e := DecodeIdentityChallengeV1DATA(changed)
	if e != nil {
		t.Fatal("syntax-only DATA unexpectedly rejected")
	}
	expected := IdentityChallengeV1ExpectedDATA{Realm: c.Realm, Tenant: c.Tenant, AgentID: c.AgentID, Audience: c.Audience, ChannelBinding: c.ChannelBinding, Epoch: c.Epoch, NetworkBinding: c.NetworkBinding}
	if AssertIdentityChallengeV1BindingDATA(d, expected) == nil {
		t.Fatal("swapped same-width binding accepted")
	}
	for _, i := range []int{0, 6} {
		f, _ = DecodeFields(wire, 11)
		f[i][0] ^= 1
		bad, _ := EncodeFields(f...)
		if _, e = DecodeIdentityChallengeV1DATA(bad); e == nil {
			t.Fatal("wrong domain or purpose")
		}
	}
	for _, bad := range [][]byte{wire[:len(wire)-1], append(append([]byte{}, wire...), 0)} {
		if _, e = DecodeIdentityChallengeV1DATA(bad); e == nil {
			t.Fatal("bad framing")
		}
	}
	c.ExpiresAt = c.IssuedAt
	if _, e = EncodeIdentityChallengeV1DATA(c); e == nil {
		t.Fatal("zero lifetime")
	}
	c.ExpiresAt = c.IssuedAt + 60001
	if _, e = EncodeIdentityChallengeV1DATA(c); e == nil {
		t.Fatal("long lifetime")
	}
	c = challengeInput(t, challengeVectors(t)[1])
	c.NetworkBinding.Genesis = make([]byte, 32)
	if _, e = EncodeIdentityChallengeV1DATA(c); e == nil {
		t.Fatal("zero genesis")
	}
}
