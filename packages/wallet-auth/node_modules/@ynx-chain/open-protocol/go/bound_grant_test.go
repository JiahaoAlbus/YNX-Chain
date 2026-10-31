package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type boundGrantVector struct {
	Name      string       `json:"name"`
	Grant     BoundGrantV1 `json:"grant"`
	GrantHex  string       `json:"grantHex"`
	EffectHex string       `json:"effectHex"`
}

func boundVectors(t *testing.T) []boundGrantVector {
	t.Helper()
	raw, e := os.ReadFile("../test/fixtures/bound-grant-v1.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		Vectors []boundGrantVector `json:"vectors"`
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	return v.Vectors
}
func boundClone(t *testing.T, g BoundGrantV1) BoundGrantV1 {
	t.Helper()
	raw, e := json.Marshal(g)
	if e != nil {
		t.Fatal(e)
	}
	var out BoundGrantV1
	if e = json.Unmarshal(raw, &out); e != nil {
		t.Fatal(e)
	}
	return out
}
func TestBoundGrantEffectSharedInterop(t *testing.T) {
	for _, v := range boundVectors(t) {
		wire, e := EncodeBoundGrant(v.Grant)
		if e != nil || hex.EncodeToString(wire) != v.GrantHex {
			t.Fatalf("grant shared vector differs: %v", e)
		}
		g, e := DecodeBoundGrant(wire)
		if e != nil {
			t.Fatal(e)
		}
		if g.Holder.ID != strings.Repeat("d", 32) || g.IssuerEpoch != "9007199254740993" || g.Cap != "18446744073709551615" {
			t.Fatal("legacy ID/integer changed")
		}
		again, e := EncodeBoundGrant(g)
		if e != nil || !bytes.Equal(again, wire) {
			t.Fatal("grant roundtrip")
		}
		effect, e := EncodeGrantEffect(g, g.Binding)
		if e != nil || hex.EncodeToString(effect) != v.EffectHex {
			t.Fatalf("effect shared vector differs: %v", e)
		}
		parsed, e := DecodeGrantEffect(effect)
		if e != nil {
			t.Fatal(e)
		}
		effect2, e := EncodeGrantEffect(parsed.Grant, parsed.Step)
		if e != nil || !bytes.Equal(effect2, effect) {
			t.Fatal("effect roundtrip")
		}
	}
}
func TestBoundGrantCanonicalSetRefusals(t *testing.T) {
	base := boundVectors(t)[0].Grant
	for _, change := range []func(*BoundGrantV1){func(g *BoundGrantV1) { g.Resources[0], g.Resources[1] = g.Resources[1], g.Resources[0] }, func(g *BoundGrantV1) { g.Resources = append(g.Resources, g.Resources[0]) }, func(g *BoundGrantV1) {
		g.Binding.Sources[0], g.Binding.Sources[1] = g.Binding.Sources[1], g.Binding.Sources[0]
	}, func(g *BoundGrantV1) { g.Binding.Sources = append(g.Binding.Sources, g.Binding.Sources[0]) }, func(g *BoundGrantV1) { f := g.Binding.Sources[0].Fields; f[0], f[1] = f[1], f[0] }, func(g *BoundGrantV1) {
		g.Binding.Sources[0].Fields = append(g.Binding.Sources[0].Fields, g.Binding.Sources[0].Fields[0])
	}} {
		g := boundClone(t, base)
		change(&g)
		if _, e := EncodeBoundGrant(g); e == nil {
			t.Fatal("noncanonical set accepted")
		}
	}
}
func TestBoundGrantCompatibilityAndStructuralRefusals(t *testing.T) {
	base := boundVectors(t)[0].Grant
	for _, change := range []func(*BoundGrantV1){func(g *BoundGrantV1) { g.ID = "legacy-grant" }, func(g *BoundGrantV1) { g.Nonce = "legacy-nonce" }, func(g *BoundGrantV1) { g.ID = strings.Repeat("AB", 16) }, func(g *BoundGrantV1) { g.Cap = "01" }, func(g *BoundGrantV1) { g.Rev = "18446744073709551616" }, func(g *BoundGrantV1) { g.NonDelegable = false }, func(g *BoundGrantV1) { g.Holder.Kind = "human" }, func(g *BoundGrantV1) { g.Issuer.Kind = "agent" }, func(g *BoundGrantV1) { g.Binding.Target.Service = "foreign" }, func(g *BoundGrantV1) { g.Resources[0].Tenant = "foreign" }, func(g *BoundGrantV1) { g.Binding.Sources[0].Ref.ID = "neighbor" }, func(g *BoundGrantV1) { g.Cap = "1" }, func(g *BoundGrantV1) { g.Expires = g.ValidFrom }, func(g *BoundGrantV1) { g.Binding.Sources[0].Fields = []string{"*"} }, func(g *BoundGrantV1) { g.Binding.Sources[0].Fields = []string{string([]byte{0xed, 0xa0, 0x80})} }, func(g *BoundGrantV1) { g.Binding.Sources[0].Fields = []string{strings.Repeat("x", 129)} }} {
		g := boundClone(t, base)
		change(&g)
		if _, e := EncodeBoundGrant(g); e == nil {
			t.Fatal("structural invalid DATA accepted")
		}
	}
}
func TestBoundGrantEffectBindingAndMalformed(t *testing.T) {
	v := boundVectors(t)[0]
	g := boundClone(t, v.Grant)
	step := g.Binding
	step.Input.SHA512 = strings.Repeat("c", 128)
	if _, e := EncodeGrantEffect(g, step); e == nil {
		t.Fatal("changed step")
	}
	wire, e := hex.DecodeString(v.GrantHex)
	if e != nil {
		t.Fatal(e)
	}
	for _, bad := range [][]byte{wire[:len(wire)-1], append(append([]byte{}, wire...), 0), make([]byte, MaxControlBytes+1)} {
		if _, e = DecodeBoundGrant(bad); e == nil {
			t.Fatal("malformed grant")
		}
	}
	f, _ := DecodeFields(wire, 21)
	f[18] = []byte{0}
	bad, _ := EncodeFields(f...)
	if _, e = DecodeBoundGrant(bad); e == nil {
		t.Fatal("false boolean")
	}
	f, _ = DecodeFields(wire, 21)
	f[0], f[1] = f[1], f[0]
	bad, _ = EncodeFields(f...)
	if _, e = DecodeBoundGrant(bad); e == nil {
		t.Fatal("wrong domain order")
	}
	g = boundClone(t, v.Grant)
	g.Binding.Purpose = strings.Repeat("x", MaxControlBytes+1)
	if _, e = EncodeBoundGrant(g); e != ErrBounds {
		t.Fatal("preflight budget missing")
	}
}
func TestBoundGrantRiskIsNotPermission(t *testing.T) {
	v := boundVectors(t)[1]
	wire, e := EncodeBoundGrant(v.Grant)
	if e != nil {
		t.Fatal(e)
	}
	g, e := DecodeBoundGrant(wire)
	if e != nil || g.Binding.Risk != "asset" || g.Operation != "wallet.approve" || g.Binding.Sources[0].Label != "VAULT" {
		t.Fatal("DATA labels incorrectly treated as a policy decision")
	}
}
