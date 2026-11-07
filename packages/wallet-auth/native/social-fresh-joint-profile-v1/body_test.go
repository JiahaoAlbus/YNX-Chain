package socialfreshjointprofile

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

func public() (CapturedDATA, RegisteredBindingDATA, *Policy10DATA, *Policy10DATA, WindowDATA) {
	c := CapturedDATA{HistoryEnvelopeOriginal: []byte(`{"PUBLIC_SIGNED_history":"nonce_A"}`), IssuerCredentialOriginal: []byte("PUBLIC_registered_issuer"), AnchorCredentialOriginal: []byte("PUBLIC_registered_anchor"), RegistrationOriginal: []byte("PUBLIC_registration"), Scope: ScopeDATA{"source", "store", "schema", "inode", "restore", 9007199254740993, 18446744073709551615}, IssuerEpoch: 17, AnchorEpoch: 9007199254740995, HistoryIssuedMS: 1000, HistoryExpiresMS: 30000, CapturedDeadlineMS: 25000}
	b := RegisteredBindingDATA{Realm: "realm", Client: "social-client", Network: "policy-network-ASCII", Identity: "identity", Device: "signal-device", HeaderSHA256: strings.Repeat("a", 64), ClassicPublic: append([]byte{5}, make([]byte, 32)...), PQPublic: make([]byte, 2592), Expected: Expected17DATA{NetworkID: strings.Repeat("b", 64), CanonicalOwner: "0x" + strings.Repeat("c", 40), Account: "account", SessionBinding: "session", ProductID: "social", ClientID: "client", Platform: "linux", ApplicationID: "app", Origin: "https://social.invalid", Callback: "callback", DeviceID: "device", Generation: "9007199254740997", RegistrationID: "registration", Revision: "11", RegistrationDigest: strings.Repeat("d", 64)}}
	i := &Policy10DATA{1, Purpose, "issuer", b.Realm, b.Client, b.Network, b.HeaderSHA256, 500, 40000, 30000}
	a := *i
	a.Role = "anchor"
	return c, b, i, &a, WindowDATA{2000, 24000, 3000}
}
func TestFreshSameCaptureCanonicalBody16(t *testing.T) {
	c, b, i, a, w := public()
	p, e := PrepareBodyDATA(c, b, i, a, w)
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(p.BodyOriginal, []byte(`"sourceGeneration":9007199254740993`)) || !bytes.Contains(p.BodyOriginal, []byte(`"nativeRestoreIncarnation":18446744073709551615`)) || !bytes.Contains(p.BodyOriginal, []byte(`"anchorEpoch":9007199254740995`)) {
		t.Fatal("u64 rounded")
	}
	if p.RootAdmission || p.SourceAdmission || p.NativeAdmission {
		t.Fatal("DATA grant")
	}
	if _, e = InspectBodyOriginalDATA(p.BodyOriginal, c, b, i, a, w); e != nil {
		t.Fatal(e)
	}
	var v map[string]json.RawMessage
	json.Unmarshal(p.BodyOriginal, &v)
	if len(v) != 16 {
		t.Fatal("body fields")
	}
}
func TestStaticProfileCrossFreshNonceRejectsThenFreshBodyPasses(t *testing.T) {
	c, b, i, a, w := public()
	old, _ := PrepareBodyDATA(c, b, i, a, w)
	c.HistoryEnvelopeOriginal = []byte(`{"PUBLIC_SIGNED_history":"nonce_B"}`)
	if _, e := InspectBodyOriginalDATA(old.BodyOriginal, c, b, i, a, w); e == nil {
		t.Fatal("crosscapture profile reused")
	}
	fresh, e := PrepareBodyDATA(c, b, i, a, w)
	if e != nil || bytes.Equal(old.BodyOriginal, fresh.BodyOriginal) {
		t.Fatal("fresh original not bound")
	}
	if _, e = InspectBodyOriginalDATA(fresh.BodyOriginal, c, b, i, a, w); e != nil {
		t.Fatal(e)
	}
}
func TestIndependentEpochAndScopeNotCounterAliases(t *testing.T) {
	c, b, i, a, w := public()
	old, _ := PrepareBodyDATA(c, b, i, a, w)
	for _, mutate := range []func(*CapturedDATA){func(c *CapturedDATA) { c.IssuerEpoch++ }, func(c *CapturedDATA) { c.AnchorEpoch++ }, func(c *CapturedDATA) { c.Scope.SourceGeneration++ }, func(c *CapturedDATA) { c.Scope.NativeRestoreIncarnation-- }} {
		next := c
		mutate(&next)
		if _, e := InspectBodyOriginalDATA(old.BodyOriginal, next, b, i, a, w); e == nil {
			t.Fatal("different tuple accepted")
		}
	}
}
func TestIndependentDeviceSessionFullPairBinding(t *testing.T) {
	c, b, i, a, w := public()
	old, _ := PrepareBodyDATA(c, b, i, a, w)
	for _, mutate := range []func(*RegisteredBindingDATA){func(b *RegisteredBindingDATA) { b.Expected.Account = "foreign" }, func(b *RegisteredBindingDATA) { b.Expected.SessionBinding = "foreign" }, func(b *RegisteredBindingDATA) { b.Expected.DeviceID = "foreign" }, func(b *RegisteredBindingDATA) {
		b.ClassicPublic = append([]byte(nil), b.ClassicPublic...)
		b.ClassicPublic[1] = 7
	}, func(b *RegisteredBindingDATA) { b.PQPublic = append([]byte(nil), b.PQPublic...); b.PQPublic[1] = 7 }} {
		next := b
		mutate(&next)
		if _, e := InspectBodyOriginalDATA(old.BodyOriginal, c, next, i, a, w); e == nil {
			t.Fatal("foreign binding accepted")
		}
	}
}
func TestWindowsBoundToSameCaptureAndPolicy(t *testing.T) {
	c, b, i, a, w := public()
	for _, bad := range []WindowDATA{{999, 24000, 3000}, {2000, 25001, 3000}, {2000, 30001, 3000}, {2000, 24000, 24000}, {2000, 24000, 1999}, {2000, 9007199254740992, 3000}} {
		if _, e := PrepareBodyDATA(c, b, i, a, bad); e == nil {
			t.Fatal("window")
		}
	}
	i2 := *i
	i2.ExpiresMS = 23000
	a2 := *a
	a2.ExpiresMS = 23000
	if _, e := PrepareBodyDATA(c, b, &i2, &a2, w); e == nil {
		t.Fatal("policy expiry")
	}
}
func TestAbsentIssuerRowsDoNotBecomePermit(t *testing.T) {
	c, b, i, a, w := public()
	if _, e := PrepareBodyDATA(c, b, nil, a, w); !errors.Is(e, ErrNotSupplied) {
		t.Fatal(e)
	}
	bad := *i
	bad.Role = "anchor"
	if _, e := PrepareBodyDATA(c, b, &bad, a, w); e == nil {
		t.Fatal("role")
	}
	b.ClassicPublic[0] = 4
	if _, e := PrepareBodyDATA(c, b, i, a, w); e == nil {
		t.Fatal("wrong classic domain")
	}
}
func TestCanonicalOriginalBOMDuplicateUnknownTrailingReject(t *testing.T) {
	c, b, i, a, w := public()
	p, _ := PrepareBodyDATA(c, b, i, a, w)
	for _, raw := range [][]byte{append([]byte{239, 187, 191}, p.BodyOriginal...), append(append([]byte(nil), p.BodyOriginal...), ' '), append(append([]byte(nil), p.BodyOriginal...), []byte("{}")...), bytes.Replace(p.BodyOriginal, []byte(`"version":1`), []byte(`"version":1,"version":1`), 1), bytes.Replace(p.BodyOriginal, []byte(`"version":1`), []byte(`"version":1,"unknown":1`), 1)} {
		if _, e := InspectBodyOriginalDATA(raw, c, b, i, a, w); e == nil {
			t.Fatal("noncanonical")
		}
	}
}
func TestGoHTMLEscapeAndIndependentOriginalMutation(t *testing.T) {
	c, b, i, a, w := public()
	b.Identity = "identity<>&"
	p, e := PrepareBodyDATA(c, b, i, a, w)
	if e != nil || !bytes.Contains(p.BodyOriginal, []byte(`identity\u003c\u003e\u0026`)) {
		t.Fatal("GoHTML")
	}
	saved := append([]byte(nil), p.BodyOriginal...)
	c.HistoryEnvelopeOriginal[1] ^= 1
	if !bytes.Equal(saved, p.BodyOriginal) {
		t.Fatal("alias")
	}
	if _, e = InspectBodyOriginalDATA(p.BodyOriginal, c, b, i, a, w); e == nil {
		t.Fatal("original drift")
	}
}

func TestPublicGoldenVector(t *testing.T) {
	raw, e := os.ReadFile("testdata/public-body-vector.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct{ BodyOriginalUTF8, BodySHA256 string }
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("vector")
	}
	c, b, i, a, w := public()
	plan, e := PrepareBodyDATA(c, b, i, a, w)
	sum := sha256.Sum256(plan.BodyOriginal)
	if e != nil || string(plan.BodyOriginal) != v.BodyOriginalUTF8 || hex.EncodeToString(sum[:]) != v.BodySHA256 {
		t.Fatal("public golden differs")
	}
}
