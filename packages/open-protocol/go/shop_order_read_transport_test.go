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

type shopTransportVector struct {
	Status                                                                               string
	Binding                                                                              ShopOrderReadTaskEffectBindingDATA
	Expected                                                                             ShopOrderReadExpectedProfileDATA
	InputHex, GrantPayloadHex, GrantWireHex, HolderPayloadHex, HolderWireHex, RequestHex string
	ResponseValue                                                                        ShopOrderReadResponseValueDATA
	ExpectedResponse                                                                     ShopOrderReadExpectedResponseDATA
	ResponseHex, SourceHex                                                               string
	ResponseBinding, SourceBinding                                                       GrantBindV1
}

func shopTransportFixtures(t *testing.T) []shopTransportVector {
	t.Helper()
	raw, e := os.ReadFile("../test/fixtures/shop-order-read-transport.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		RequestDomain, ContentType, ResultProfile string
		Vectors                                   []shopTransportVector
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	if v.RequestDomain != ShopOrderReadRequestDomain || v.ContentType != ShopOrderReadRequestContentType || v.ResultProfile != ShopOrderReadResultProfile {
		t.Fatal("profile")
	}
	return v.Vectors
}
func shopTransportCall(t *testing.T, v shopTransportVector) OriginalShopTaskOrderCallDATA {
	t.Helper()
	decode := func(s string) []byte {
		b, e := hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	return OriginalShopTaskOrderCallDATA{Binding: v.Binding, Grant: ShopOrderReadProofDATA{BoundGrantDomain, decode(v.GrantPayloadHex), decode(v.GrantWireHex)}, Holder: ShopOrderReadProofDATA{GrantEffectDomain, decode(v.HolderPayloadHex), decode(v.HolderWireHex)}, Input: decode(v.InputHex)}
}
func TestShopOrderReadTransportGoTSNormalVectors(t *testing.T) {
	for _, v := range shopTransportFixtures(t) {
		call := shopTransportCall(t, v)
		wire, e := EncodeShopOrderReadRequestDATA(call, v.Expected)
		if e != nil || hex.EncodeToString(wire) != v.RequestHex {
			t.Fatal("request cross-language", e)
		}
		out, e := DecodeShopOrderReadRequestDATA(wire, v.Expected, ShopOrderReadRequestContentType)
		if e != nil || !reflect.DeepEqual(out, call) {
			t.Fatal("normal original call decode", e)
		}
		result, e := EncodeShopOrderReadResponseDATA(v.ResponseValue, v.ExpectedResponse)
		if e != nil {
			t.Fatal("normal projection encode", e)
		}
		if hex.EncodeToString(result.ResponseOriginal) != v.ResponseHex || hex.EncodeToString(result.SourceBytes) != v.SourceHex || result.ResponseBinding != v.ResponseBinding || result.SourceBinding != v.SourceBinding {
			t.Fatal("canonical Go/TS response/SourceBytes/fullBind")
		}
		back, e := DecodeShopOrderReadResponseDATA(result.ResponseOriginal, v.ExpectedResponse)
		if e != nil || !reflect.DeepEqual(back, result) {
			t.Fatal("normal independent selected source readback", e)
		}
		if !result.DataOnly || result.SourceVerified || result.OperationVerified {
			t.Fatal("must stay DATA")
		}
		if result.Projection.Data["status"] != v.Status {
			t.Fatal("projection status changed")
		}
	}
}
func TestShopOrderReadTransportRequestRefusals(t *testing.T) {
	v := shopTransportFixtures(t)[0]
	base := shopTransportCall(t, v)
	for _, mutate := range []func(*OriginalShopTaskOrderCallDATA){func(c *OriginalShopTaskOrderCallDATA) { c.Grant.Purpose = "WRONG" }, func(c *OriginalShopTaskOrderCallDATA) { c.Holder.Purpose = "WRONG" }, func(c *OriginalShopTaskOrderCallDATA) { c.Binding.ChannelBinding = "OUTER-channel" }, func(c *OriginalShopTaskOrderCallDATA) { c.Binding.Generation = "3" }, func(c *OriginalShopTaskOrderCallDATA) { c.Binding.GrantRevision = "2" }, func(c *OriginalShopTaskOrderCallDATA) { c.Input = append(bytes.Clone(c.Input), ' ') }} {
		c := base
		mutate(&c)
		if _, e := EncodeShopOrderReadRequestDATA(c, v.Expected); e == nil {
			t.Fatal("inconsistent request")
		}
	}
	c := base
	g, e := DecodeBoundGrant(c.Grant.Payload)
	if e != nil {
		t.Fatal(e)
	}
	g.Nonce = strings.Repeat("33", 16)
	c.Holder.Payload, e = EncodeGrantEffect(g, g.Binding)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = EncodeShopOrderReadRequestDATA(c, v.Expected); e == nil {
		t.Fatal("holder grant differs")
	}
	wire, _ := hex.DecodeString(v.RequestHex)
	for _, mime := range []string{"", "application/json", ShopOrderReadRequestContentType + "; charset=utf-8"} {
		if _, e = DecodeShopOrderReadRequestDATA(wire, v.Expected, mime); e == nil {
			t.Fatal("wrong MIME")
		}
	}
	if _, e = DecodeShopOrderReadRequestDATA(append(bytes.Clone(wire), 0), v.Expected, ShopOrderReadRequestContentType); e == nil {
		t.Fatal("trailing")
	}
	f, _ := DecodeFields(wire, 5)
	f[0] = []byte("OLD")
	bad, _ := EncodeFields(f...)
	if _, e = DecodeShopOrderReadRequestDATA(bad, v.Expected, ShopOrderReadRequestContentType); e == nil {
		t.Fatal("old request domain")
	}
}
func TestShopOrderReadTransportResponseRefusals(t *testing.T) {
	v := shopTransportFixtures(t)[0]
	raw, e := hex.DecodeString(v.ResponseHex)
	if e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{" " + string(raw), string(raw) + "\n", strings.Replace(string(raw), `"version":"1"`, `"version":"1","version":"1"`, 1), strings.Replace(string(raw), `"totalYNXT":"100"`, `"totalYNXT":100`, 1), strings.Replace(string(raw), `"version":"1"`, `"version":"1","verified":true`, 1), `{"projection":{},"label":"TENANT","authScope":"egress-only-read-fence"}`} {
		if _, e = DecodeShopOrderReadResponseDATA([]byte(bad), v.ExpectedResponse); e == nil {
			t.Fatal("bad canonical/new profile response")
		}
	}
	for _, mutate := range []func(*ShopOrderReadResponseValueDATA){func(r *ShopOrderReadResponseValueDATA) { r.Projection.OrderID = "another" }, func(r *ShopOrderReadResponseValueDATA) { r.Projection.Snapshot = strings.Repeat("ab", 64) }, func(r *ShopOrderReadResponseValueDATA) { r.Source.Resource.Rev = "2" }, func(r *ShopOrderReadResponseValueDATA) { r.Source.Label = "PUBLIC" }, func(r *ShopOrderReadResponseValueDATA) { r.Source.Binding.SHA512 = strings.Repeat("00", 64) }, func(r *ShopOrderReadResponseValueDATA) { r.AuthFence = "verified" }} {
		r := v.ResponseValue
		mutate(&r)
		if _, e = EncodeShopOrderReadResponseDATA(r, v.ExpectedResponse); e == nil {
			t.Fatal("response mismatch")
		}
	}
	if _, e = DecodeShopOrderReadResponseDATA(make([]byte, MaxControlBytes+1), v.ExpectedResponse); e == nil {
		t.Fatal("response limit")
	}
}
