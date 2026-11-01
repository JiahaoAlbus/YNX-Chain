package ynxbatch

import (
	"bytes"
	"encoding/hex"
	"strings"
	"testing"
)

func TestAuthSourceStatementV2PUBLICOriginalE8(t *testing.T) {
	body := []byte(`{"a":1,"b":"original"}`)
	b := AuthSourceStatementV2Binding{AuthSourceEnrollmentV2, "SYNTHETIC-INDEPENDENT-RELEASE-FRAME", bytes.Repeat([]byte{0x31}, 32), "0x" + strings.Repeat("ab", 20), 18446744073709551615, 18446744073709551614}
	got, err := BuildAuthSourceStatementV2(body, b)
	if err != nil {
		t.Fatal(err)
	}
	want, err := EncodeFields([]byte("YNX/AUTH/SOURCE-ORIGINAL/V2"), []byte("enrollment"), []byte(b.Frame), []byte(hex.EncodeToString(b.NetworkID)), []byte(b.Owner), []byte("18446744073709551615"), []byte("18446744073709551614"), body)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatal("original E8 text/framing changed")
	}
	if InspectAuthSourceStatementV2(got, body, b) != nil {
		t.Fatal("same E8 refused")
	}
	for _, r := range []AuthSourceStatementV2Role{AuthSourceProfileV2, AuthSourceCurrentV2} {
		b.Role = r
		if InspectAuthSourceStatementV2(got, body, b) == nil {
			t.Fatal("role substitution accepted")
		}
	}
	b.Role = AuthSourceEnrollmentV2
	b.Frame += "wrong"
	if InspectAuthSourceStatementV2(got, body, b) == nil {
		t.Fatal("independent frame substitution accepted")
	}
}
func TestAuthSourceStatementV2PUBLICCanonicalAndBounds(t *testing.T) {
	b := AuthSourceStatementV2Binding{AuthSourceCurrentV2, "SYNTHETIC-RELEASE", make([]byte, 32), "0x" + strings.Repeat("11", 20), 1, 0}
	for _, body := range []string{`{"z":0,"a":1}`, `{"a":1,"a":1}`, ` {}`, `{"a":1.0}`, `{"a":-0}`, `{"a":9007199254740992}`, `{"a":"\u0041"}`, `{"a":"\ud83d\ude00"}`, `{}x`} {
		if _, err := BuildAuthSourceStatementV2([]byte(body), b); err == nil {
			t.Fatal("noncanonical original accepted")
		}
	}
	for _, body := range []string{`null`, `{"a":"\ud800"}`, `{"a":"😀"}`, `{"𐀀":0,"":1}`, `[true,-9007199254740991]`} {
		if _, err := BuildAuthSourceStatementV2([]byte(body), b); err != nil {
			t.Fatal("canonical JS spelling refused")
		}
	}
	body := []byte(`"` + strings.Repeat("a", AuthSourceStatementV2BodyMaximum-2) + `"`)
	wire, err := BuildAuthSourceStatementV2(body, b)
	if err != nil || len(wire) <= 65536 || len(wire) > AuthSourceStatementV2MessageMaximum {
		t.Fatal("full original body capacity was truncated")
	}
	if _, err := BuildAuthSourceStatementV2(append(body, ' '), b); err == nil {
		t.Fatal("oversized body accepted")
	}
	for _, change := range []func(*AuthSourceStatementV2Binding){func(x *AuthSourceStatementV2Binding) { x.Role = 0 }, func(x *AuthSourceStatementV2Binding) { x.Frame = "" }, func(x *AuthSourceStatementV2Binding) { x.Frame = "a\x00b" }, func(x *AuthSourceStatementV2Binding) { x.Frame = string([]byte{255}) }, func(x *AuthSourceStatementV2Binding) { x.Frame = strings.Repeat("x", 513) }, func(x *AuthSourceStatementV2Binding) { x.KeyVersion = 0 }, func(x *AuthSourceStatementV2Binding) { x.NetworkID = nil }, func(x *AuthSourceStatementV2Binding) { x.Owner = "0x" + strings.Repeat("AB", 20) }} {
		bad := b
		change(&bad)
		if _, err := BuildAuthSourceStatementV2([]byte(`{}`), bad); err == nil {
			t.Fatal("invalid fixed statement binding accepted")
		}
	}
}
