package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"os"
	"strconv"
	"strings"
	"testing"
)

// Exact sole-SDK PUBLIC vectors, never a Root policy or Source authority.
// No keys/signing/issuance/OS capture or original production account is used.
func TestAuthSourceStatementV2SDKSoleGoldenActualCAND(t *testing.T) {
	raw, err := os.ReadFile("testdata/source_v2_sdk_public_golden.json")
	requireNoError(t, err)
	sum := sha256.Sum256(raw)
	if len(raw) != 596364 || hex.EncodeToString(sum[:]) != "919afe400d5ac8279ed330d00c9da0d8a5aeca77885008bb799f08b7ee4a8392" {
		t.Fatal("sole SDK original public vector pin changed")
	}
	type record struct {
		PKA        string `json:"pkA"`
		PKB        string `json:"pkB"`
		Revision   string `json:"revision"`
		ActiveFrom string `json:"activeFrom"`
	}
	type registration struct {
		Owner, NetworkID, ExecutionHeight, ActiveRevision string
		Enabled                                           bool
		Records                                           []record
	}
	var golden struct {
		PublicOnly                                      bool `json:"PUBLIC_ONLY"`
		RootAdmission, SourceAdmission, NativeAdmission bool
		Policy                                          struct{ SignatureContract map[string]string }
		Registrations                                   map[string]registration
		Vectors                                         []struct {
			Role, SnapshotKey, Frame, CertificatePurpose, BodyOriginal, MessageBase64url, MemberBase64url, MessageSHA256, MemberSHA256 string
			MessageBytes, MemberBytes                                                                                                  int
			Binding                                                                                                                    struct{ NetworkID, Owner, KeyVersion, ExecutionHeight string }
		}
	}
	requireNoError(t, json.Unmarshal(raw, &golden))
	if !golden.PublicOnly || golden.RootAdmission || golden.SourceAdmission || golden.NativeAdmission || len(golden.Vectors) != 3 {
		t.Fatal("public DATA-only golden shape changed")
	}
	u64 := func(s string) uint64 {
		t.Helper()
		v, e := strconv.ParseUint(s, 10, 64)
		requireNoError(t, e)
		if strconv.FormatUint(v, 10) != s {
			t.Fatal("noncanonical golden uint64")
		}
		return v
	}
	unhex := func(s string) []byte {
		t.Helper()
		v, e := hex.DecodeString(s)
		requireNoError(t, e)
		if hex.EncodeToString(v) != s {
			t.Fatal("noncanonical golden hex")
		}
		return v
	}
	decode := func(s, want string, n int) []byte {
		t.Helper()
		b, e := base64.RawURLEncoding.Strict().DecodeString(s)
		requireNoError(t, e)
		h := sha256.Sum256(b)
		if len(b) != n || hex.EncodeToString(h[:]) != want || base64.RawURLEncoding.EncodeToString(b) != s {
			t.Fatal("exact public bytes differ")
		}
		return b
	}
	seen := map[string]bool{}
	for _, v := range golden.Vectors {
		role := map[string]ynxbatch.AuthSourceStatementV2Role{"enrollment": 1, "profile": 2, "current": 3}[v.Role]
		if role == 0 || seen[v.Role] {
			t.Fatal("closed distinct role set required")
		}
		seen[v.Role] = true
		frame := golden.Policy.SignatureContract[v.Role+"Frame"]
		if frame == "" || frame != v.Frame {
			t.Fatal("independent policy frame changed")
		}
		reg := golden.Registrations[v.SnapshotKey]
		if !reg.Enabled || len(reg.Records) != 1 || reg.Owner != v.Binding.Owner || reg.NetworkID != v.Binding.NetworkID || reg.ActiveRevision != v.Binding.KeyVersion {
			t.Fatal("public registered role tuple differs")
		}
		rec := reg.Records[0]
		if rec.Revision != v.Binding.KeyVersion {
			t.Fatal("public revision differs")
		}
		message := decode(v.MessageBase64url, v.MessageSHA256, v.MessageBytes)
		member := decode(v.MemberBase64url, v.MemberSHA256, v.MemberBytes)
		in := sourceStatementV2Inputs{body: []byte(v.BodyOriginal), frame: frame, role: role, issuedHeight: u64(v.Binding.ExecutionHeight), registration: registeredN1Inputs{member: member, network: unhex(reg.NetworkID), owner: reg.Owner, pkA: unhex(rec.PKA), pkB: unhex(rec.PKB), policyRevision: u64(rec.Revision), observedHeight: u64(reg.ExecutionHeight), activeFrom: u64(rec.ActiveFrom), enabled: 1}}
		built, e := ynxbatch.BuildAuthSourceStatementV2(in.body, ynxbatch.AuthSourceStatementV2Binding{Role: role, Frame: frame, NetworkID: in.registration.network, Owner: reg.Owner, KeyVersion: in.registration.policyRevision, IssuedHeight: in.issuedHeight})
		requireNoError(t, e)
		if !bytes.Equal(built, message) {
			t.Fatal("sole EncodeFields E8 bytes differ")
		}
		purpose, e := ynxbatch.AuthSourceStatementV2Purpose(role)
		requireNoError(t, e)
		if purpose != v.CertificatePurpose {
			t.Fatal("fixed role certificate purpose differs")
		}
		if got := verifySourceStatementV2(in); got != registeredN1OK {
			t.Fatalf("sole SDK %s AND result %d", v.Role, got)
		}
		if failed := sourceStatementV2ForeignControls(in); failed != 0 {
			t.Fatalf("sole SDK %s actual C control %d", v.Role, failed)
		}
		for _, branch := range []string{"A", "B", "purpose"} {
			m, e := ynxbatch.DecodeMember(member)
			requireNoError(t, e)
			switch branch {
			case "A":
				m.Certificate.SigmaA[0] ^= 1
			case "B":
				m.Certificate.SigmaB[0] ^= 1
			case "purpose":
				m.Certificate.Purpose = "SOURCE-ROOT-READ-V2"
			}
			bad := in
			bad.registration.member, e = ynxbatch.EncodeMember(m)
			requireNoError(t, e)
			if verifySourceStatementV2(bad) == registeredN1OK {
				t.Fatal("changed public signature/purpose admitted")
			}
		}
		for _, change := range []func(*sourceStatementV2Inputs){func(x *sourceStatementV2Inputs) { x.frame += "wrong" }, func(x *sourceStatementV2Inputs) { x.body = []byte(`{}`) }, func(x *sourceStatementV2Inputs) { x.body = append([]byte{0xef, 0xbb, 0xbf}, x.body...) }, func(x *sourceStatementV2Inputs) { x.body = []byte(`"` + strings.Repeat("x", 65535) + `"`) }} {
			bad := in
			change(&bad)
			if verifySourceStatementV2(bad) == registeredN1OK {
				t.Fatal("changed frame/original/BOM/over-cap body admitted")
			}
		}
		generic := in.registration
		generic.purpose = purpose
		generic.message = make([]byte, 65537)
		if verifyRegisteredANDMemberN1(generic) != registeredN1Argument {
			t.Fatal("old generic message cap widened")
		}
		generic.message = message
		generic.member = make([]byte, 98305)
		if verifyRegisteredANDMemberN1(generic) != registeredN1Argument {
			t.Fatal("old generic member cap widened")
		}
	}
	t.Log("sole SDK three public roles: exact E8, original AND, actual C-to-export; no Root/Source/Native admission; no supplied maximum-body golden claimed")
}
