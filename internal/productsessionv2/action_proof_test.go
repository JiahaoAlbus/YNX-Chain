package productsessionv2

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

// Synthetic QA fixture emitted by the actual RecoverableProductSessionClient
// and existing noble P256 signer. It contains no device private key or user data.
func TestSocialAudienceActionJSInterop(t *testing.T) {
	raw, err := os.ReadFile("testdata/social-action-js-proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Session                Session `json:"session"`
		Header, Body, Path, At string
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	now, err := protocolTime(f.At)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := VerifySocialAudienceProof(f.Header, f.Session, "POST", f.Path, []byte(f.Body), now)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Nonce == "" || accepted.SessionBinding != f.Session.SessionBinding || !accepted.ExpiresAt.After(now) {
		t.Fatal("missing transaction replay binding")
	}
	// Verification deliberately does not consume. The existing product transaction
	// must consume the returned session/nonce once with its own audience revision.
	if _, err = VerifySocialAudienceProof(f.Header, f.Session, "POST", f.Path, []byte(f.Body), now); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, method, path, body string
		session                  Session
		at                       time.Time
	}{
		{"body", "POST", f.Path, `{"kind":"private"}`, f.Session, now},
		{"path", "POST", "/social/v3/matrix/audience/authorize", f.Body, f.Session, now},
		{"method", "GET", f.Path, f.Body, f.Session, now},
		{"unknownpath", "POST", "/social/v3/feed", f.Body, f.Session, now},
		{"expired", "POST", f.Path, f.Body, f.Session, now.Add(time.Minute)},
		{"future", "POST", f.Path, f.Body, f.Session, now.Add(-time.Second)},
		{"scope", "POST", f.Path, f.Body, func() Session { s := f.Session; s.Scopes = []string{"social.messaging"}; return s }(), now},
		{"account", "POST", f.Path, f.Body, func() Session {
			s := f.Session
			s.Account = strings.Replace(s.Account, "q", "p", 1)
			if s.Account == f.Session.Account {
				s.Account = "ynx1" + strings.Repeat("p", 38)
			}
			return s
		}(), now},
		{"device", "POST", f.Path, f.Body, func() Session { s := f.Session; s.DeviceID = "other-device-id"; return s }(), now},
		{"session", "POST", f.Path, f.Body, func() Session { s := f.Session; s.SessionBinding = strings.Repeat("0", 64); return s }(), now},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, e := VerifySocialAudienceProof(f.Header, c.session, c.method, c.path, []byte(c.body), c.at); e == nil {
				t.Fatal("accepted changed action context")
			}
		})
	}
	decoded, _ := base64.RawURLEncoding.DecodeString(f.Header)
	var proof map[string]any
	_ = json.Unmarshal(decoded, &proof)
	for _, field := range []string{"nonce", "expiresAt", "signature"} {
		t.Run("tamper-"+field, func(t *testing.T) {
			p := map[string]any{}
			for k, v := range proof {
				p[k] = v
			}
			if field == "nonce" {
				p[field] = strings.Repeat("b", 43)
			} else if field == "expiresAt" {
				p[field] = now.Add(31 * time.Second).Format("2006-01-02T15:04:05.000Z")
			} else {
				p[field] = strings.Repeat("a", 94)
			}
			b, _ := canonical(p)
			if _, e := VerifySocialAudienceProof(base64.RawURLEncoding.EncodeToString(b), f.Session, "POST", f.Path, []byte(f.Body), now); e == nil {
				t.Fatal("accepted unsigned change")
			}
		})
	}
	t.Run("unknown-and-trailing", func(t *testing.T) {
		for _, b := range [][]byte{append(decoded, []byte("{}")...), append([]byte(`{"unknown":true,`), decoded[1:]...)} {
			if _, e := VerifySocialAudienceProof(base64.RawURLEncoding.EncodeToString(b), f.Session, "POST", f.Path, []byte(f.Body), now); e == nil {
				t.Fatal("accepted noncanonical proof")
			}
		}
	})
}

func TestSocialAudienceActionBodyJSParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/social-action-js-body-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Session  Session `json:"session"`
		Path, At string
		Cases    []struct {
			Name, Body, Header string
			Accept             bool
		}
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	now, err := protocolTime(f.At)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) != 11 {
		t.Fatal("missing actual JS body cases")
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			_, err := VerifySocialAudienceProof(c.Header, f.Session, "POST", f.Path, []byte(c.Body), now)
			if (err == nil) != c.Accept {
				t.Fatalf("expected accepted=%v: %v", c.Accept, err)
			}
		})
	}
}
