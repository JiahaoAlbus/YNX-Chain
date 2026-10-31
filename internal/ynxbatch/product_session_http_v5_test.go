package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

type productHTTPV5Golden struct {
	BodyBase64url, ContentType, Header, MemberBase64url, MessageBase64url     string
	NetworkID, PKA, PKB, UnsignedCanonicalJSON                                string
	NonSingleMemberBase64url, WrongPurposeMemberBase64url, V4MessageBase64url string
}

func httpV5Golden(t *testing.T) (productHTTPV5Golden, ProductSessionHTTPBinding, []byte, []byte, []byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/product-session-proof-v5-public.json")
	if err != nil {
		t.Fatal(err)
	}
	d := sha256.Sum256(raw)
	if hex.EncodeToString(d[:]) != "caaf17f69d655d4cc2167767fc3130cac68fec579f00f87d79e4cce79be8aa2d" {
		t.Fatal("SDK final-path original changed")
	}
	var g productHTTPV5Golden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	h := func(s string) []byte {
		b, e := hex.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	b64 := func(s string) []byte {
		b, e := base64.RawURLEncoding.DecodeString(s)
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	var u productSessionHTTPV5Unsigned
	if err := json.Unmarshal([]byte(g.UnsignedCanonicalJSON), &u); err != nil {
		t.Fatal(err)
	}
	b := ProductSessionHTTPBinding{NetworkID: h(g.NetworkID), Owner: u.CanonicalOwner, PKA: h(g.PKA), PKB: h(g.PKB)}
	return g, b, b64(g.BodyBase64url), b64(g.MessageBase64url), b64(g.MemberBase64url)
}

func TestProductSessionHTTPV5FinalSDKOriginalAND(t *testing.T) {
	g, b, body, message, member := httpV5Golden(t)
	got, err := BuildProductSessionHTTPV5Message([]byte(g.UnsignedCanonicalJSON), body, g.ContentType, b)
	if err != nil || !bytes.Equal(got, message) {
		t.Fatalf("SDK exact E6 mismatch: %v", err)
	}
	if len(body) != 267 || len(message) != 1532 || len(member) != 59159 || len(g.Header) != 106843 {
		t.Fatal("final-path SDK measured lengths changed")
	}
	inspected, err := InspectProductSessionHTTPV5Member(member, b, message)
	if err != nil || !bytes.Equal(inspected.MessageOriginal, message) {
		t.Fatalf("real SDK AND failed: %v", err)
	}
	f, err := DecodeFields(message, 6, MaxProductSessionHTTPV5MessageBytes)
	if err != nil {
		t.Fatal(err)
	}
	bind, err := DecodeDeploymentV2Bind(f[5])
	if err != nil || bind.Bytes != "267" || len(f[5]) != 152 {
		t.Fatal("shared BindE3 mismatch")
	}
	for _, field := range []int{0, 1, 2, 3, 4, 5} {
		bad := make([][]byte, len(f))
		for i := range f {
			bad[i] = bytes.Clone(f[i])
		}
		bad[field][len(bad[field])-1] ^= 1
		wire, _ := EncodeFields(bad...)
		if _, err := InspectProductSessionHTTPV5Member(member, b, wire); err == nil {
			t.Fatalf("E6 field %d mutation accepted", field)
		}
	}
	for _, branch := range []string{"A", "B"} {
		m, err := DecodeMember(member)
		if err != nil {
			t.Fatal(err)
		}
		if branch == "A" {
			m.Certificate.SigmaA[0] ^= 1
		} else {
			m.Certificate.SigmaB[0] ^= 1
		}
		wire, err := EncodeMember(m)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := InspectProductSessionHTTPV5Member(wire, b, message); err == nil {
			t.Fatal("invalid AND branch accepted", branch)
		}
	}
	for _, s := range []string{g.NonSingleMemberBase64url, g.WrongPurposeMemberBase64url} {
		bad, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := InspectProductSessionHTTPV5Member(bad, b, message); err == nil {
			t.Fatal("wrong signed purpose or N admitted")
		}
	}
	v4, err := base64.RawURLEncoding.DecodeString(g.V4MessageBase64url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InspectProductSessionHTTPV5Message(v4, b); err == nil {
		t.Fatal("V4 downgrade accepted")
	}
	if _, err := InspectProductSessionHTTPMessage(message, b, []byte(g.UnsignedCanonicalJSON)); err == nil {
		t.Fatal("V5 admitted as V4")
	}
	for _, which := range []int{0, 1, 2, 3} {
		wrong := b
		wrong.NetworkID = bytes.Clone(b.NetworkID)
		wrong.PKA = bytes.Clone(b.PKA)
		wrong.PKB = bytes.Clone(b.PKB)
		switch which {
		case 0:
			wrong.NetworkID[0] ^= 1
		case 1:
			wrong.Owner = "0x" + strings.Repeat("22", 20)
		case 2:
			wrong.PKA[0] ^= 1
		case 3:
			wrong.PKB[0] ^= 1
		}
		if _, err := InspectProductSessionHTTPV5Member(member, wrong, message); err == nil {
			t.Fatal("independent expected binding ignored", which)
		}
	}
	// Returned originals and full pair are detached from the untrusted buffers.
	member[0] ^= 1
	message[0] ^= 1
	b.PKA[0] ^= 1
	if inspected.MessageOriginal[0] == message[0] || inspected.Binding.PKA[0] == b.PKA[0] {
		t.Fatal("retained caller-owned input")
	}
}

func TestProductSessionHTTPV5ActualBinaryAndStrict23(t *testing.T) {
	g, b, body, _, _ := httpV5Golden(t)
	u := []byte(g.UnsignedCanonicalJSON)
	for _, bad := range [][]byte{nil, append(bytes.Clone(body), 0), append([]byte{body[0] ^ 1}, body[1:]...)} {
		if _, err := BuildProductSessionHTTPV5Message(u, bad, g.ContentType, b); err == nil {
			t.Fatal("actual complete body not bound")
		}
	}
	for _, bad := range []string{g.ContentType + " ", strings.Replace(g.ContentType, "SDK5", "SDK6", 1), "multipart/form-data", "multipart/form-data; boundary=" + strings.Repeat("a", 71), "multipart/form-data; boundary=\"abc\""} {
		if _, err := BuildProductSessionHTTPV5Message(u, body, bad, b); err == nil {
			t.Fatal("actual content type mismatch admitted")
		}
	}
	cases := map[string][]byte{
		"newline": append(bytes.Clone(u), '\n'), "trailing": append(bytes.Clone(u), []byte(`{}`)...),
		"duplicate":        bytes.Replace(u, []byte(`"version":"5"`), []byte(`"version":"5","version":"5"`), 1),
		"extra":            bytes.Replace(u, []byte(`"version":"5"`), []byte(`"version":"5","permit":true`), 1),
		"old_version":      bytes.Replace(u, []byte(`"version":"5"`), []byte(`"version":"4"`), 1),
		"number_version":   bytes.Replace(u, []byte(`"version":"5"`), []byte(`"version":5`), 1),
		"shortpath":        bytes.Replace(u, []byte(ProductSessionHTTPV5Path), []byte("/ide/deployments"), 1),
		"method":           bytes.Replace(u, []byte(`"method":"POST"`), []byte(`"method":"PUT"`), 1),
		"missing_nullable": bytes.Replace(u, []byte(`,"packageId":null`), nil, 1),
		"length_number":    bytes.Replace(u, []byte(`"bytes":"267"`), []byte(`"bytes":267`), 1),
		"leading_zero":     bytes.Replace(u, []byte(`"bytes":"267"`), []byte(`"bytes":"0267"`), 1),
		"overflow":         bytes.Replace(u, []byte(`"bytes":"267"`), []byte(`"bytes":"18446744073709551616"`), 1),
		"length_cap":       bytes.Replace(u, []byte(`"bytes":"267"`), []byte(`"bytes":"68288513"`), 1),
		"null_binding":     bytes.Replace(u, []byte(`"bodyBinding":{`), []byte(`"bodyBinding":null,"x":{`), 1),
		"duplicate_digest": bytes.Replace(u, []byte(`"bytes":"267"`), []byte(`"bytes":"267","bytes":"267"`), 1),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if bytes.Equal(raw, u) {
				t.Fatal("negative did not mutate")
			}
			if _, err := BuildProductSessionHTTPV5Message(raw, body, g.ContentType, b); err == nil {
				t.Fatal("noncanonical unsigned23 accepted")
			}
		})
	}
	var parsed productSessionHTTPV5Unsigned
	if err := json.Unmarshal(u, &parsed); err != nil {
		t.Fatal(err)
	}
	for _, edit := range []func(*productSessionHTTPV5Unsigned){
		func(p *productSessionHTTPV5Unsigned) { p.BodyDigest = strings.Repeat("0", 64) },
		func(p *productSessionHTTPV5Unsigned) { p.BodyBinding.SHA3_512 = strings.Repeat("0", 128) },
		func(p *productSessionHTTPV5Unsigned) { p.BodyBinding.SHA512 = strings.Repeat("0", 128) },
		func(p *productSessionHTTPV5Unsigned) { p.BodyBinding.SHA512 = strings.ToUpper(p.BodyBinding.SHA512) },
	} {
		x := parsed
		edit(&x)
		if _, err := BuildProductSessionHTTPV5Message(productSessionHTTPV5Canonical(x), body, g.ContentType, b); err == nil {
			t.Fatal("independent actual body digest mismatch accepted")
		}
	}
}

func TestProductSessionHTTPV5BinaryBodyCapAndSharedE3(t *testing.T) {
	g, b, _, _, _ := httpV5Golden(t)
	var u productSessionHTTPV5Unsigned
	if err := json.Unmarshal([]byte(g.UnsignedCanonicalJSON), &u); err != nil {
		t.Fatal(err)
	}
	// Non-UTF8 is valid body data. This exercises the new cap, not V4 or the
	// separate 64MiB deployment-artifact helper's unchanged bound.
	body := make([]byte, MaxProductSessionHTTPV5BodyBytes+1)
	body[0] = 0xff
	body[1] = 0
	body[MaxProductSessionHTTPV5BodyBytes-1] = 0x80
	actual := body[:MaxProductSessionHTTPV5BodyBytes]
	d := sha256.Sum256(actual)
	a := sha3.Sum512(actual)
	z := sha512.Sum512(actual)
	u.BodyDigest = hex.EncodeToString(d[:])
	u.BodyBinding = DeploymentV2Bind{Bytes: strconv.Itoa(len(actual)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(z[:])}
	raw := productSessionHTTPV5Canonical(u)
	message, err := BuildProductSessionHTTPV5Message(raw, actual, g.ContentType, b)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InspectProductSessionHTTPV5Message(message, b); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildProductSessionHTTPV5Message(raw, body, g.ContentType, b); err == nil {
		t.Fatal("body cap exceeded")
	}
	if _, err := BindDeploymentV2Bytes(actual); err == nil {
		t.Fatal("old artifact cap was relaxed")
	}
}
