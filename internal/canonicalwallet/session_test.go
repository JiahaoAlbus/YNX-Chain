package canonicalwallet

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSessionBindingAndTamperFailClosed(t *testing.T) {
	now := time.Date(2026, 7, 18, 4, 0, 0, 0, time.UTC)
	r := Registry{2, "ynx-trust-center-v1", "trust-center", "com.ynxweb4.trust", []string{"ynxtrust://wallet-auth/callback"}, []string{"account:read", "trust:appeal", "trust:evidence:read", "trust:evidence:write", "trust:transparency"}, 5, []string{"p256-sha256"}}
	s := Session{"wallet-auth-v1", strings.Repeat("a", 64), ChainID, "trust-center", r.ProductClientID, r.BundleID, r.Callbacks[0], "p256-sha256", "A-device-key", strings.Repeat("b", 64), "ynx1account", r.Scopes, "nonce-value", "Review bounded evidence", strings.Repeat("c", 64), strings.Repeat("d", 64), now.Add(-time.Minute), now.Add(5 * time.Minute)}
	b, _ := json.Marshal(s)
	got, err := ParseVerifiedSession(b, r, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := AssertActive(got, s.SessionBinding, s.ProductDeviceKey, []string{"account:read"}, now); err != nil {
		t.Fatal(err)
	}
	if err := AssertActive(got, s.SessionBinding, "other-device", nil, now); err == nil {
		t.Fatal("cross-device reuse accepted")
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	m["extra"] = true
	b, _ = json.Marshal(m)
	if _, err := ParseVerifiedSession(b, r, now); err == nil {
		t.Fatal("unknown field accepted")
	}
}

func FuzzParseVerifiedSessionFailsClosed(f *testing.F) {
	r := Registry{2, "ynx-trust-center-v1", "trust-center", "com.ynxweb4.trust", []string{"ynxtrust://wallet-auth/callback"}, []string{"account:read"}, 1, []string{"p256-sha256"}}
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"verifierVersion":"wallet-auth-v1"}`))
	f.Fuzz(func(t *testing.T, raw []byte) { _, _ = ParseVerifiedSession(raw, r, time.Now().UTC()) })
}
