package ynxbatch

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type resourcePublicVector struct {
	NowMillis                                                int64 `json:"nowMillis"`
	InputHex, ScopeOriginal, MessageHex, MemberHex, PKA, PKB string
	Binding                                                  struct{ NetworkID, CanonicalSignerOwner, KeyEpoch, IssuedHeight string }
}

func resourceVector(t *testing.T) (resourcePublicVector, NetworkResourceConsentBinding, []byte, []byte) {
	t.Helper()
	raw, err := os.ReadFile("testdata/network-resource-consent-v1-public.json")
	if err != nil {
		t.Fatal(err)
	}
	var v resourcePublicVector
	if err = json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	h := func(s string) []byte {
		v, err := hex.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	b := NetworkResourceConsentBinding{NetworkID: h(v.Binding.NetworkID), Owner: v.Binding.CanonicalSignerOwner, KeyEpoch: v.Binding.KeyEpoch, IssuedHeight: v.Binding.IssuedHeight, PKA: h(v.PKA), PKB: h(v.PKB)}
	return v, b, h(v.InputHex), h(v.MemberHex)
}

func TestNetworkResourceConsentSoleSDKOriginalSevenFieldsAndAND(t *testing.T) {
	v, b, input, member := resourceVector(t)
	m, err := BuildNetworkResourceConsentMessage([]byte(v.ScopeOriginal), input, v.NowMillis, b)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := hex.DecodeString(v.MessageHex)
	if !bytes.Equal(m.MessageOriginal, expected) {
		t.Fatal("fixed Go frame differs from original sole SDK bytes")
	}
	f, err := DecodeFields(expected, 7, MaxNetworkResourceMessageBytes)
	if err != nil || len(f) != 7 || string(f[4]) != "1" || string(f[5]) != "20" {
		t.Fatal("epoch/issuedHeight were lost from original seven-field frame", err)
	}
	if _, err = InspectNetworkResourceConsentMessage(expected, input, v.NowMillis, b); err != nil {
		t.Fatal(err)
	}
	if _, err = InspectNetworkResourceConsentMember(member, []byte(v.ScopeOriginal), input, v.NowMillis, b); err != nil {
		t.Fatal(err)
	}
	for _, branch := range []string{"A", "B"} {
		t.Run(branch, func(t *testing.T) {
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
			if _, err = InspectNetworkResourceConsentMember(wire, []byte(v.ScopeOriginal), input, v.NowMillis, b); err == nil {
				t.Fatal("single corrupt branch accepted")
			}
		})
	}
	for _, which := range []string{"network", "owner", "epoch", "issued", "pair", "purpose", "index"} {
		t.Run(which, func(t *testing.T) {
			bound := b
			raw := member
			switch which {
			case "network":
				bound.NetworkID = bytes.Repeat([]byte{3}, 32)
			case "owner":
				bound.Owner = "0x" + strings.Repeat("22", 20)
			case "epoch":
				bound.KeyEpoch = "2"
			case "issued":
				bound.IssuedHeight = "21"
			case "pair":
				bound.PKB = bytes.Repeat([]byte{1}, PublicKeyBSize)
			case "purpose":
				m, _ := DecodeMember(member)
				m.Certificate.Purpose = "TX-BATCH"
				raw, _ = EncodeMember(m)
			case "index":
				m, _ := DecodeMember(member)
				m.Index = 1
				var e error
				raw, e = EncodeMember(m)
				if e != nil {
					return
				}
			}
			if _, err := InspectNetworkResourceConsentMember(raw, []byte(v.ScopeOriginal), input, v.NowMillis, bound); err == nil {
				t.Fatal("cross binding accepted")
			}
		})
	}
}

func TestNetworkResourceConsentClosedOriginalGrammarAndBounds(t *testing.T) {
	v, b, input, _ := resourceVector(t)
	var scope NetworkResourceScope
	if json.Unmarshal([]byte(v.ScopeOriginal), &scope) != nil {
		t.Fatal("scope")
	}
	var work NetworkResourceWork
	json.Unmarshal([]byte(scope.ManifestOriginal), &work)
	var consent NetworkResourceConsent
	json.Unmarshal([]byte(scope.ConsentOriginal), &consent)
	for _, which := range []string{"unknown", "duplicate", "trailing", "null", "noncanonical", "utf8", "bom-input", "array-input", "wrong-input", "oversize", "epoch-overflow", "scope-epoch", "work-kind", "work-issuer", "work-hash", "work-limits", "consent-manifest", "consent-principal", "consent-limit", "expired", "future-expiry", "consent-after-work"} {
		t.Run(which, func(t *testing.T) {
			s, w, c := scope, work, consent
			bound := b
			actual := input
			at := v.NowMillis
			raw := []byte(v.ScopeOriginal)
			switch which {
			case "unknown":
				raw = append([]byte(`{"extra":1,`), raw[1:]...)
			case "duplicate":
				raw = append([]byte(`{"version":1,`), raw[1:]...)
			case "trailing":
				raw = append(raw, ' ')
			case "null":
				raw = bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":null`), 1)
			case "noncanonical":
				raw = bytes.Replace(raw, []byte(`PUBLIC.resource`), []byte(`PUBLIC\u002eresource`), 1)
			case "utf8":
				raw = append(raw, 255)
			case "bom-input":
				actual = append([]byte{239, 187, 191}, input...)
			case "array-input":
				actual = []byte(`[]`)
			case "wrong-input":
				actual = []byte(`{"PUBLIC":"another"}`)
			case "oversize":
				actual = make([]byte, MaxNetworkResourceInputBytes+1)
			case "epoch-overflow":
				bound.KeyEpoch = "18446744073709551616"
			case "scope-epoch":
				s.Request.PrincipalKeyEpoch = "2"
			case "work-kind":
				w.Kind = "unregistered_shell"
			case "work-issuer":
				w.Issuer = "OTHER"
			case "work-hash":
				w.Input.SHA512 = strings.Repeat("0", 128)
			case "work-limits":
				w.Limits.CPUMilli = "1001"
			case "consent-manifest":
				c.Manifest.Bytes = "1"
			case "consent-principal":
				c.Principal = "OTHER"
			case "consent-limit":
				c.Limits.DurationMillis = "2"
			case "expired":
				at = 160000
			case "future-expiry":
				w.ExpiresAt = "1970-01-03T00:00:00Z"
			case "consent-after-work":
				c.ExpiresAt = "1970-01-01T00:02:40.000000001Z"
			}
			if w != work {
				s.ManifestOriginal = string(resourceCanonical(w))
			}
			if c != consent {
				s.ConsentOriginal = string(resourceCanonical(c))
			}
			if s != scope {
				raw = resourceCanonical(s)
			}
			if _, err := BuildNetworkResourceConsentMessage(raw, actual, at, bound); err == nil {
				t.Fatal("malformed original accepted")
			}
		})
	}
	// A denial is an exact signed DATA statement, not execution consent.
	consent.Allow = false
	scope.ConsentOriginal = string(resourceCanonical(consent))
	if m, err := BuildNetworkResourceConsentMessage(resourceCanonical(scope), input, v.NowMillis, b); err != nil || m.Consent.Allow {
		t.Fatal("original DENY grammar changed", err)
	}
	// Neither uint64 scalar is silently truncated to JS's safe integer range.
	scope.Request.PrincipalKeyEpoch = "18446744073709551615"
	b.KeyEpoch = scope.Request.PrincipalKeyEpoch
	b.IssuedHeight = "18446744073709551615"
	if _, err := BuildNetworkResourceConsentMessage(resourceCanonical(scope), input, v.NowMillis, b); err != nil {
		t.Fatal(err)
	}
}

func TestNetworkResourceConsentFixedSignAndDestroyedKey(t *testing.T) {
	v, b, input, _ := resourceVector(t)
	key, pub, err := KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	b.PKA, b.PKB = pub.PKA, pub.PKB
	out, err := SignNetworkResourceConsentDATA(key, []byte(v.ScopeOriginal), input, v.NowMillis, b)
	if err != nil || !out.SignatureVerified || !out.BatchCleanupComplete || len(out.MemberOriginal) == 0 {
		t.Fatal("real fixed AND signing failed", err)
	}
	if _, err = InspectNetworkResourceConsentMember(out.MemberOriginal, []byte(v.ScopeOriginal), input, v.NowMillis, b); err != nil {
		t.Fatal(err)
	}
	wrong := b
	wrong.PKA = bytes.Repeat([]byte{0}, PublicKeyASize)
	if out, err = SignNetworkResourceConsentDATA(key, []byte(v.ScopeOriginal), input, v.NowMillis, wrong); err == nil || len(out.MemberOriginal) != 0 {
		t.Fatal("wrong registered pair entered private signing")
	}
	m, _ := BuildNetworkResourceConsentMessage([]byte(v.ScopeOriginal), input, v.NowMillis, b)
	batch, err := BatchSign(key, Metadata{ChainID: b.NetworkID, Owner: b.Owner, Purpose: NetworkResourceConsentPurpose}, [][]byte{m.MessageOriginal, m.MessageOriginal}, SignOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer batch.Discard()
	member, _ := Extract(batch, 0)
	wire, _ := EncodeMember(member)
	if _, err = InspectNetworkResourceConsentMember(wire, []byte(v.ScopeOriginal), input, v.NowMillis, b); err == nil {
		t.Fatal("N2 accepted for fixed resource N1")
	}
	key.Destroy()
	if out, err = SignNetworkResourceConsentDATA(key, []byte(v.ScopeOriginal), input, v.NowMillis, b); err == nil || len(out.MemberOriginal) != 0 {
		t.Fatal("destroyed key signed")
	}
}

func TestNetworkResourceConsentGoPublicInteropOriginal(t *testing.T) {
	v, b, input, _ := resourceVector(t)
	key, pub, err := KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer key.Destroy()
	b.PKA, b.PKB = pub.PKA, pub.PKB
	out, err := SignNetworkResourceConsentDATA(key, []byte(v.ScopeOriginal), input, v.NowMillis, b)
	if err != nil || !out.SignatureVerified || !out.BatchCleanupComplete {
		t.Fatal(err)
	}
	m, err := InspectNetworkResourceConsentMember(out.MemberOriginal, []byte(v.ScopeOriginal), input, v.NowMillis, b)
	if err != nil {
		t.Fatal(err)
	}
	// Optional public-only interoperability output. No seed, DER or private
	// handle is serialized; originals are never overwritten on a failed retry.
	path := os.Getenv("YNX_RESOURCE_CONSENT_PUBLIC_OUT")
	if path == "" {
		return
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		t.Fatal("exact absolute public output required")
	}
	raw, err := json.Marshal(struct {
		Version          string `json:"version"`
		SyntheticOnly    bool   `json:"syntheticOnly"`
		AuthorityGranted bool   `json:"authorityGranted"`
		NowMillis        int64  `json:"nowMillis"`
		ScopeOriginal    string `json:"scopeOriginal"`
		InputHex         string `json:"inputHex"`
		MessageHex       string `json:"messageHex"`
		MemberHex        string `json:"memberHex"`
		NetworkID        string `json:"networkId"`
		Owner            string `json:"owner"`
		KeyEpoch         string `json:"keyEpoch"`
		IssuedHeight     string `json:"issuedHeight"`
		PKA              string `json:"pkA"`
		PKB              string `json:"pkB"`
	}{"YNX-NETWORK-RESOURCE-CONSENT-GO-PUBLIC/v1", true, false, v.NowMillis, v.ScopeOriginal, v.InputHex, hex.EncodeToString(m.MessageOriginal), hex.EncodeToString(out.MemberOriginal), hex.EncodeToString(b.NetworkID), b.Owner, b.KeyEpoch, b.IssuedHeight, hex.EncodeToString(b.PKA), hex.EncodeToString(b.PKB)})
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		t.Fatal("public result UNKNOWN retained", writeErr, syncErr, closeErr)
	}
}
