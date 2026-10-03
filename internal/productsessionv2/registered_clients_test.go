package productsessionv2

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func registeredFixture(t *testing.T, file string) (*Client, *Revalidator, Session, string, string, string) {
	t.Helper()
	raw, e := os.ReadFile("testdata/" + file)
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Session                Session
		Header, Body, Path, At string
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	c, e := NewClient("https://wallet-auth.ynxweb4.com", Policy{ProductID: "mail", ClientID: "ynx-mail-v1", Platform: f.Session.Platform, ApplicationID: f.Session.ApplicationID, Origin: f.Session.Origin, Callback: f.Session.Callback, BundleID: f.Session.BundleID, PackageID: f.Session.PackageID, AllowedScopes: []string{"mail:account", "mail:recover"}}, nil)
	if e != nil {
		t.Fatal(e)
	}
	r, e := NewPrivateBusinessRevalidator(c, "ynx-mail-v1-business-"+c.policy.Platform+"-v1", "isolated-test-key", ed25519.NewKeyFromSeed(make([]byte, 32)))
	if e != nil {
		t.Fatal(e)
	}
	at, e := protocolTime(f.At)
	if e != nil {
		t.Fatal(e)
	}
	c.clock = func() time.Time { return at }
	return c, r, f.Session, f.Header, f.Body, f.Path
}
func TestRegisteredClientsActualJSWebNativeProof(t *testing.T) {
	web, wr, ws, wh, wb, wp := registeredFixture(t, "mail-business-js-proof.json")
	native, nr, ns, nh, nb, np := registeredFixture(t, "mail-business-native-js-proof.json")
	set, e := NewRegisteredClientSet("mail", []*Client{web, native}, []*Revalidator{wr, nr})
	if e != nil {
		t.Fatal(e)
	}
	for _, tc := range []struct {
		session                    Session
		header, body, path, method string
		c                          *Client
	}{{ws, wh, wb, wp, "POST", web}, {ns, nh, nb, np, "DELETE", native}} {
		if _, e = set.VerifyHTTPAction(tc.header, tc.session, tc.method, tc.path, []byte(tc.body), []string{"mail:account"}, tc.c.clock()); e != nil {
			t.Fatal(e)
		}
		if _, e = set.VerifyHTTPActionStream(context.Background(), tc.header, tc.session, tc.method, tc.path, strings.NewReader(tc.body), int64(len(tc.body)), []string{"mail:account"}, tc.c.clock()); e != nil {
			t.Fatal(e)
		}
		changed := tc.session
		changed.Platform = "unregistered"
		if _, e = set.VerifyHTTPAction(tc.header, changed, tc.method, tc.path, []byte(tc.body), []string{"mail:account"}, tc.c.clock()); e == nil {
			t.Fatal("unsupported platform accepted")
		}
		changed = tc.session
		changed.Origin = "https://attacker.invalid"
		if _, e = set.VerifyHTTPAction(tc.header, changed, tc.method, tc.path, []byte(tc.body), []string{"mail:account"}, tc.c.clock()); e == nil {
			t.Fatal("cross origin accepted")
		}
	}
}
func TestRegisteredClientsRejectDuplicateOrMismatchedReaders(t *testing.T) {
	c, r, _, _, _, _ := registeredFixture(t, "mail-business-js-proof.json")
	other, or, _, _, _, _ := registeredFixture(t, "mail-business-native-js-proof.json")
	for _, tc := range []struct {
		product string
		clients []*Client
		readers []*Revalidator
	}{{"ai", []*Client{c}, []*Revalidator{r}}, {"mail", []*Client{c, c}, []*Revalidator{r, r}}, {"mail", []*Client{c}, []*Revalidator{or}}, {"mail", []*Client{other}, []*Revalidator{nil}}, {"mail", nil, nil}} {
		if _, e := NewRegisteredClientSet(tc.product, tc.clients, tc.readers); e == nil {
			t.Fatal("invalid configured tuple/reader accepted")
		}
	}
}
func TestRegisteredClientsProofCannotBorrowOtherPlatformOrActionAsIntrospection(t *testing.T) {
	c, r, sess, header, _, _ := registeredFixture(t, "mail-business-native-js-proof.json")
	set, e := NewRegisteredClientSet("mail", []*Client{c}, []*Revalidator{r})
	if e != nil {
		t.Fatal(e)
	}
	req, _ := http.NewRequest("DELETE", "https://mail.ynxweb4.com/api/messages", nil)
	req.Header.Set(ProofHeader, header)
	if _, e = set.Authorize(context.Background(), req, []string{"mail:account"}); e == nil {
		t.Fatal("business action used as consumed introspection")
	}
	sess.Platform = "web"
	if _, e = set.Revalidate(context.Background(), sess, []string{"mail:account"}); e == nil {
		t.Fatal("native session relabeled web")
	}
	raw, _ := base64.RawURLEncoding.DecodeString(header)
	fields, _ := canonicalObject(raw)
	fields["origin"] = "https://mail.ynxweb4.com"
	fields["applicationId"] = "com.ynxweb4.mail.web"
	changed, _ := canonical(fields)
	req.Header.Set(ProofHeader, base64.RawURLEncoding.EncodeToString(changed))
	if _, e = set.Authorize(context.Background(), req, []string{"mail:account"}); e == nil {
		t.Fatal("unregistered web tuple selected native backend")
	}
}
