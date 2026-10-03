package productsessionv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

// These public-only fixtures are emitted by the actual JS recovery client.
func TestBusinessProofActualJSInterop(t *testing.T) {
	for _, tc := range []struct{ file, method string }{
		{"mail-business-js-proof.json", "POST"},
		{"mail-business-get-js-proof.json", "GET"},
		{"mail-business-native-js-proof.json", "DELETE"},
		{"mail-business-binary-js-proof.json", "POST"},
		{"mail-business-multipart-js-proof.json", "POST"},
	} {
		t.Run(tc.file, func(t *testing.T) {
			b, err := os.ReadFile("testdata/" + tc.file)
			if err != nil {
				t.Fatal(err)
			}
			var f struct {
				Session                            Session
				Header, Body, BodyBase64, Path, At string
			}
			if err = json.Unmarshal(b, &f); err != nil {
				t.Fatal(err)
			}
			if f.BodyBase64 != "" {
				wire, err := base64.StdEncoding.DecodeString(f.BodyBase64)
				if err != nil {
					t.Fatal(err)
				}
				f.Body = string(wire)
			}
			now, err := protocolTime(f.At)
			if err != nil {
				t.Fatal(err)
			}
			c := &Client{policy: Policy{ProductID: "mail", ClientID: "ynx-mail-v1", Platform: f.Session.Platform, ApplicationID: f.Session.ApplicationID, Origin: f.Session.Origin, Callback: f.Session.Callback, BundleID: f.Session.BundleID, PackageID: f.Session.PackageID, AllowedScopes: []string{"mail:account", "mail:recover"}}}
			verify := func(body, method, path string, at time.Time, scopes []string) error {
				_, e := c.VerifyHTTPAction(f.Header, f.Session, method, path, []byte(body), scopes, at)
				return e
			}
			if err = verify(f.Body, tc.method, f.Path, now, []string{"mail:account"}); err != nil {
				t.Fatal(err)
			}
			if _, err := c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, tc.method, f.Path, strings.NewReader(f.Body), int64(len(f.Body)), []string{"mail:account"}, now); err != nil {
				t.Fatal(err)
			}
			if _, err := c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, tc.method, f.Path, strings.NewReader(f.Body+"x"), int64(len(f.Body)), []string{"mail:account"}, now); err == nil {
				t.Fatal("oversize stream accepted")
			}
			if _, err := c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, tc.method, f.Path, strings.NewReader(f.Body+"x"), int64(len(f.Body)+1), []string{"mail:account"}, now); err == nil {
				t.Fatal("wrong actual stream digest accepted")
			}
			cancelled, cancel := context.WithCancel(context.Background())
			cancel()
			if _, err := c.VerifyHTTPActionStream(cancelled, f.Header, f.Session, tc.method, f.Path, strings.NewReader(f.Body), int64(len(f.Body)), []string{"mail:account"}, now); err == nil {
				t.Fatal("cancelled stream accepted")
			}
			// Cryptographic verification is intentionally repeatable. Replay consumption
			// belongs to the product's atomic business transaction, not this verifier.
			if err = verify(f.Body, tc.method, f.Path, now, []string{"mail:account"}); err != nil {
				t.Fatal(err)
			}
			for _, n := range []struct {
				name, body, method, path string
				at                       time.Time
				scopes                   []string
			}{
				{"body", f.Body + " ", tc.method, f.Path, now, []string{"mail:account"}},
				{"method", f.Body, "PUT", f.Path, now, []string{"mail:account"}},
				{"path", f.Body, tc.method, f.Path + "/other", now, []string{"mail:account"}},
				{"expired", f.Body, tc.method, f.Path, now.Add(time.Minute), []string{"mail:account"}},
				{"authority", f.Body, tc.method, "/v2/product-sessions/introspect", now, []string{"mail:account"}},
				{"scope", f.Body, tc.method, f.Path, now, []string{"files:write"}},
				{"deep", strings.Repeat("[", 33) + "0" + strings.Repeat("]", 33), tc.method, f.Path, now, []string{"mail:account"}},
			} {
				t.Run(n.name, func(t *testing.T) {
					if verify(n.body, n.method, n.path, n.at, n.scopes) == nil {
						t.Fatal("accepted substituted business context")
					}
				})
			}
			c.policy.Platform = "wrong-platform"
			if verify(f.Body, tc.method, f.Path, now, []string{"mail:account"}) == nil {
				t.Fatal("accepted wrong platform")
			}
		})
	}
}

type businessRepeatedByteReader byte

func (r businessRepeatedByteReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(r)
	}
	return len(p), nil
}
func TestBusinessLargeStreamActualJS(t *testing.T) {
	data, err := os.ReadFile("testdata/mail-business-large-js-proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Session          Session
		Header, Path, At string
		RepeatByte       byte
		BodyBytes        int64
	}
	if err = json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	now, err := protocolTime(f.At)
	if err != nil {
		t.Fatal(err)
	}
	c := &Client{policy: Policy{ProductID: "mail", ClientID: "ynx-mail-v1", Platform: f.Session.Platform, ApplicationID: f.Session.ApplicationID, Origin: f.Session.Origin, Callback: f.Session.Callback, AllowedScopes: []string{"mail:account", "mail:recover"}}}
	wire := func() io.Reader { return io.LimitReader(businessRepeatedByteReader(f.RepeatByte), f.BodyBytes) }
	if _, err = c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, "POST", f.Path, wire(), 536870912, []string{"mail:account"}, now); err != nil {
		t.Fatal(err)
	}
	if _, err = c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, "POST", f.Path, wire(), 50*1048576, []string{"mail:account"}, now); err == nil {
		t.Fatal("route 50 MiB cap widened to generic 512 MiB ceiling")
	}
	if _, err = c.VerifyHTTPActionStream(context.Background(), f.Header, f.Session, "POST", f.Path, io.LimitReader(businessRepeatedByteReader(f.RepeatByte), f.BodyBytes-1), 536870912, []string{"mail:account"}, now); err == nil {
		t.Fatal("truncated 512 MiB actual body accepted")
	}
}
