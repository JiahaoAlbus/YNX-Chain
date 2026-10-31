package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestShopOrderReadOriginalInputVectors(t *testing.T) {
	raw, e := os.ReadFile("../test/fixtures/shop-order-read-input.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		Tool    ShopOrderReadTool
		Vectors []struct {
			Input       ShopOrderReadSelection
			OriginalHex string
			Binding     GrantBindV1
		}
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	if ShopOrderReadToolDescriptorDATA() != v.Tool {
		t.Fatal("original P07 tool/schema mismatch")
	}
	for _, row := range v.Vectors {
		w, e := EncodeShopOrderReadInputDATA(row.Input)
		if e != nil || hex.EncodeToString(w) != row.OriginalHex {
			t.Fatal("canonical input vector", e)
		}
		out, e := DecodeShopOrderReadInputDATA(w)
		if e != nil || !reflect.DeepEqual(out, row.Input) {
			t.Fatal(out, e)
		}
		b, e := BindShopOrderReadInputDATA(w)
		if e != nil || b != row.Binding {
			t.Fatal("original input Bind", e)
		}
	}
	source, e := os.ReadFile("../schema/shop-order-read-input.schema.json")
	if e != nil || !bytes.Equal(source, ShopOrderReadInputSchemaDATA()) {
		t.Fatal("schema original", e)
	}
}
func TestShopOrderReadInputRefusals(t *testing.T) {
	s := ShopOrderReadSelection{"PUBLIC-order", []string{"currency", "status"}, strings.Repeat("12", 64)}
	w, e := EncodeShopOrderReadInputDATA(s)
	if e != nil {
		t.Fatal(e)
	}
	raw := string(w)
	for _, bad := range []string{raw + " {}", strings.Replace(raw, `"orderId":`, `"orderId":"other","orderId":`, 1), strings.Replace(raw, "PUBLIC-order", `\ud800`, 1), strings.Replace(raw, `"currency"`, `"address"`, 1), strings.TrimSuffix(raw, "}") + `,"approved":true}`, strings.TrimSuffix(raw, "}") + `,"grant":{}}`, strings.Replace(raw, `["currency","status"]`, `["status","currency"]`, 1)} {
		if _, e = DecodeShopOrderReadInputDATA([]byte(bad)); e == nil {
			t.Fatal("bad input accepted", bad)
		}
	}
}

type shopBindingVector struct {
	Binding              ShopOrderReadTaskEffectBindingDATA
	Expected             ShopOrderReadExpectedProfileDATA
	InputHex, BindingHex string
	Proof                struct{ Purpose, PayloadHex, WireHex, EncodedHex string }
}

func shopBindingFixture(t *testing.T) shopBindingVector {
	t.Helper()
	raw, e := os.ReadFile("../test/fixtures/shop-order-read-binding.json")
	if e != nil {
		t.Fatal(e)
	}
	var v shopBindingVector
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	return v
}
func TestShopOrderReadBindingProofVectors(t *testing.T) {
	v := shopBindingFixture(t)
	input, e := hex.DecodeString(v.InputHex)
	if e != nil {
		t.Fatal(e)
	}
	w, e := EncodeShopOrderReadBindingDATA(v.Binding, input, v.Expected)
	if e != nil || hex.EncodeToString(w) != v.BindingHex {
		t.Fatal("Binding E21 TS/Go", e)
	}
	out, e := DecodeShopOrderReadBindingDATA(w, input, v.Expected)
	if e != nil || !reflect.DeepEqual(out, v.Binding) {
		t.Fatal("binding roundtrip", out, e)
	}
	payload, _ := hex.DecodeString(v.Proof.PayloadHex)
	proofWire, _ := hex.DecodeString(v.Proof.WireHex)
	p := ShopOrderReadProofDATA{v.Proof.Purpose, payload, proofWire}
	encoded, e := EncodeShopOrderReadProofDATA(p, p.Purpose)
	if e != nil || hex.EncodeToString(encoded) != v.Proof.EncodedHex {
		t.Fatal("proof original vector", e)
	}
	decoded, e := DecodeShopOrderReadProofDATA(encoded, p.Purpose)
	if e != nil || !reflect.DeepEqual(decoded, p) {
		t.Fatal("opaque proof bytes", e)
	}
	if _, e = DecodeShopOrderReadProofDATA(encoded, "OTHER-PURPOSE"); e == nil {
		t.Fatal("wrong typed purpose")
	}
}
func TestShopOrderReadBindingRefusals(t *testing.T) {
	v := shopBindingFixture(t)
	input, _ := hex.DecodeString(v.InputHex)
	cases := []func(*ShopOrderReadTaskEffectBindingDATA){func(b *ShopOrderReadTaskEffectBindingDATA) { b.Tenant = "other" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Holder.Kind = "human" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Task.Tenant = "other" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Tool.Version = "2" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Target.Path = "/api/tools/other" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Fields = []string{"status"} }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Input.SHA512 = strings.Repeat("0", 128) }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.Generation = "02" }, func(b *ShopOrderReadTaskEffectBindingDATA) { b.EgressActual = &b.Input }}
	for i, mutate := range cases {
		b := v.Binding
		mutate(&b)
		if _, e := EncodeShopOrderReadBindingDATA(b, input, v.Expected); e == nil {
			t.Fatalf("invalid binding %d", i)
		}
	}
	w, _ := hex.DecodeString(v.BindingHex)
	if _, e := DecodeShopOrderReadBindingDATA(append(bytes.Clone(w), 0), input, v.Expected); e == nil {
		t.Fatal("trailing")
	}
	if _, e := DecodeShopOrderReadBindingDATA(w, append(bytes.Clone(input), ' '), v.Expected); e == nil {
		t.Fatal("input bytes changed")
	}
	expected := v.Expected
	expected.Target.Origin = "https://other.invalid"
	if _, e := DecodeShopOrderReadBindingDATA(w, input, expected); e == nil {
		t.Fatal("independent target")
	}
	f, _ := DecodeFields(w, 21)
	f[20], _ = EncodeFields([]byte{1})
	wrong, _ := EncodeFields(f...)
	if _, e := DecodeShopOrderReadBindingDATA(wrong, input, v.Expected); e == nil {
		t.Fatal("egress marker")
	}
}
