package productsessionv2

// PUBLIC transport fixtures only: no signature verifier, live authority, Root,
// account registration, key, server, network or business grant is fabricated.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

type currentRoundTripper func(*http.Request) (*http.Response, error)

type currentCompletionBody struct {
	reader   *bytes.Reader
	complete func()
	done     bool
}

func (b *currentCompletionBody) Read(p []byte) (int, error) {
	n, e := b.reader.Read(p)
	if e == io.EOF && !b.done {
		b.done = true
		b.complete()
	}
	return n, e
}
func (b *currentCompletionBody) Close() error { return nil }

func (f currentRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func currentMS(ms int64) string                                                 { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }
func currentCanonical(t *testing.T, v any) []byte {
	t.Helper()
	b, e := canonical(v)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func currentClone(t *testing.T, v map[string]any) map[string]any {
	t.Helper()
	out, e := canonicalObject(currentCanonical(t, v))
	if e != nil {
		t.Fatal(e)
	}
	return out
}

type currentOracle struct {
	Name     string         `json:"name"`
	Account  string         `json:"account"`
	Input    map[string]any `json:"input"`
	Accepted bool           `json:"accepted"`
}

func currentOracles(t *testing.T) []currentOracle {
	t.Helper()
	raw, e := os.ReadFile("testdata/original_sdk_session_authorization_vectors.json")
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != "6d8cc4dd7ad235a6077fe8576374db5ed18971d2bcd5aacba025f6fa18a32849" {
		t.Fatal("sole SDK original vector bytes drifted")
	}
	var v struct {
		Vectors []currentOracle `json:"vectors"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e = d.Decode(&v); e != nil {
		t.Fatal(e)
	}
	if len(v.Vectors) != 20 {
		t.Fatalf("SDK oracle count %d", len(v.Vectors))
	}
	return v.Vectors
}

type currentFixture struct {
	policy         Policy
	proof, session map[string]any
	before, after  int64
	required       []string
}

func currentFixtureNew(t *testing.T, version string) currentFixture {
	t.Helper()
	o := currentOracles(t)[0]
	p := Policy{ProductID: "social", ClientID: "PUBLIC-social", ApplicationID: "PUBLIC-social-web", Platform: "web", Origin: "https://social.public.invalid", Callback: "https://social.public.invalid/callback", AllowedScopes: []string{"social.read", "social.write"}}
	required := []string{"social.read"}
	body := currentCanonical(t, map[string]any{"requiredScopes": required})
	sum := sha256.Sum256(body)
	proof := map[string]any{"version": "2", "sessionBinding": strings.Repeat("a", 64), "productId": p.ProductID, "clientId": p.ClientID, "applicationId": p.ApplicationID, "bundleId": nil, "packageId": nil, "origin": p.Origin, "callback": p.Callback, "account": o.Account, "deviceId": "PUBLIC-device", "deviceKey": "PUBLIC-device-key", "method": "POST", "path": introspectionPath, "bodyDigest": hex.EncodeToString(sum[:]), "nonce": strings.Repeat("n", 43), "issuedAt": currentMS(900), "expiresAt": currentMS(2000), "signature": "PUBLIC-not-a-verified-signature"}
	session := map[string]any{"version": version, "sessionBinding": proof["sessionBinding"], "chainId": "ynx_6423-1", "productId": p.ProductID, "clientId": p.ClientID, "platform": p.Platform, "applicationId": p.ApplicationID, "bundleId": nil, "packageId": nil, "origin": p.Origin, "callback": p.Callback, "account": o.Account, "deviceId": proof["deviceId"], "deviceAlgorithm": "p256-sha256", "deviceKey": proof["deviceKey"], "deviceBinding": strings.Repeat("b", 64), "nonce": strings.Repeat("s", 43), "state": "active", "scopes": []string{"social.read", "social.write"}, "requestDigest": strings.Repeat("c", 64), "approvalDigest": strings.Repeat("d", 64), "issuedAt": currentMS(800), "expiresAt": currentMS(10000)}
	if version == "3" {
		session["accountAuthorization"] = currentClone(t, o.Input)
	}
	return currentFixture{p, proof, session, 1000, 1500, required}
}
func (x *currentFixture) platform(name string) {
	x.policy.Platform = name
	x.session["platform"] = name
	x.policy.Origin = "app://" + name + "/PUBLIC-social"
	x.policy.Callback = "publicsocial://callback"
	for _, m := range []map[string]any{x.proof, x.session} {
		m["origin"] = x.policy.Origin
		m["callback"] = x.policy.Callback
	}
}
func (x currentFixture) authorize(t *testing.T, method string, origins, proofs []string) (Session, error, int) {
	t.Helper()
	now := x.before
	calls := 0
	transport := currentRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Header.Get(ProofHeader) != base64.RawURLEncoding.EncodeToString(currentCanonical(t, x.proof)) {
			t.Error("original proof header was replaced")
		}
		if r.Method != "POST" || r.URL.String() != "https://authority.public.invalid"+introspectionPath {
			t.Errorf("wrong normal introspection %s %s", r.Method, r.URL)
		}
		body, e := io.ReadAll(r.Body)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(body, currentCanonical(t, map[string]any{"requiredScopes": x.required})) {
			t.Error("not actual route scopes body")
		}
		raw := currentCanonical(t, map[string]any{"schemaVersion": json.Number("2"), "requestId": r.Header.Get("X-Request-Id"), "ok": true, "result": map[string]any{"active": true, "session": x.session}})
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}, "X-Request-Id": {r.Header.Get("X-Request-Id")}}, Body: &currentCompletionBody{reader: bytes.NewReader(raw), complete: func() { now = x.after }}, ContentLength: int64(len(raw)), Request: r}, nil
	})
	c, e := NewClient("https://authority.public.invalid", x.policy, transport)
	if e != nil {
		t.Fatal(e)
	}
	c.clock = func() time.Time { return time.UnixMilli(now) }
	request, e := http.NewRequest(method, "https://social.public.invalid/api/test", nil)
	if e != nil {
		t.Fatal(e)
	}
	for _, origin := range origins {
		request.Header.Add("Origin", origin)
	}
	header := base64.RawURLEncoding.EncodeToString(currentCanonical(t, x.proof))
	if proofs == nil {
		proofs = []string{header}
	}
	for _, p := range proofs {
		if p == "SAME" {
			p = header
		}
		request.Header.Add(ProofHeader, p)
	}
	s, e := c.Authorize(context.Background(), request, x.required)
	return s, e, calls
}

func TestCurrentSessionSDKOriginalAuthorizationOracle(t *testing.T) {
	for _, v := range currentOracles(t) {
		t.Run(v.Name, func(t *testing.T) {
			originalInput := currentCanonical(t, v.Input)
			got, e := parseSessionAccountAuthorization(v.Input, v.Account)
			if !bytes.Equal(originalInput, currentCanonical(t, v.Input)) {
				t.Fatal("parser mutated original SDK DATA")
			}
			if (e == nil) != v.Accepted {
				t.Fatalf("SDK accepted=%v, Go err=%v", v.Accepted, e)
			}
			if v.Accepted {
				if got == nil {
					t.Fatal("accepted with missing authorization")
				}
				raw, e := json.Marshal(got)
				if e != nil {
					t.Fatal(e)
				}
				var actual map[string]any
				d := json.NewDecoder(bytes.NewReader(raw))
				d.UseNumber()
				if e = d.Decode(&actual); e != nil {
					t.Fatal(e)
				}
				if !reflect.DeepEqual(actual, v.Input) {
					t.Fatal("authorization9 not retained losslessly")
				}
			}
		})
	}
}
func TestCurrentAuthorizeLegacyAndV3(t *testing.T) {
	for _, version := range []string{"2", "3"} {
		t.Run(version, func(t *testing.T) {
			x := currentFixtureNew(t, version)
			s, e, n := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
			if e != nil || n != 1 {
				t.Fatalf("normal %s err=%v calls=%d", version, e, n)
			}
			if version == "3" && s.AccountAuthorization == nil {
				t.Fatal("v3 authorization discarded")
			}
			if version == "2" && s.AccountAuthorization != nil {
				t.Fatal("legacy invented authorization")
			}
		})
	}
}
func TestCurrentAuthorizeSDKOracleThroughNormalHTTP(t *testing.T) {
	for _, v := range currentOracles(t) {
		t.Run(v.Name, func(t *testing.T) {
			x := currentFixtureNew(t, "3")
			x.session["account"] = v.Account
			x.proof["account"] = v.Account
			x.session["accountAuthorization"] = v.Input
			_, e, n := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
			if n != 1 || (e == nil) != v.Accepted {
				t.Fatalf("SDK=%v HTTP err=%v calls=%d", v.Accepted, e, n)
			}
		})
	}
}
func TestCurrentAuthorizeCompletionClock(t *testing.T) {
	for _, v := range []struct {
		name          string
		after         int64
		sessionExpiry int64
		want          bool
	}{{"normal", 1500, 10000, true}, {"proof-expires-in-await", 2500, 10000, false}, {"proof-exact-expiry", 2000, 10000, false}, {"clock-rollback", 999, 10000, false}, {"session-exact-expiry", 2000, 2000, false}} {
		t.Run(v.name, func(t *testing.T) {
			x := currentFixtureNew(t, "2")
			x.after = v.after
			x.session["expiresAt"] = currentMS(v.sessionExpiry)
			_, e, n := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
			if n != 1 || (e == nil) != v.want {
				t.Fatalf("completion fence err=%v calls=%d want=%v", e, n, v.want)
			}
		})
	}
}
func TestCurrentAuthorizeWholeScopeSubset(t *testing.T) {
	x := currentFixtureNew(t, "2")
	x.session["scopes"] = []string{"social.read", "social.write", "z.unregistered"}
	_, e, _ := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
	if e == nil {
		t.Fatal("unrequired unauthorized scope widened session")
	}
}
func TestCurrentAuthorizeOriginAndDuplicateProof(t *testing.T) {
	cases := []struct {
		name, platform, method string
		origins, proofs        []string
		want                   bool
	}{{"web-post-missing", "web", "POST", nil, nil, false}, {"web-post-duplicate", "web", "POST", []string{"SAME", "SAME"}, nil, false}, {"web-post-wrong", "web", "POST", []string{"https://other.public.invalid"}, nil, false}, {"web-get-missing", "web", "GET", nil, nil, true}, {"native-post-missing", "android", "POST", nil, nil, true}, {"duplicate-proof", "web", "POST", []string{"SAME"}, []string{"SAME", "SAME"}, false}}
	for _, v := range cases {
		t.Run(v.name, func(t *testing.T) {
			x := currentFixtureNew(t, "2")
			if v.platform != "web" {
				x.platform(v.platform)
			}
			origins := append([]string(nil), v.origins...)
			for i := range origins {
				if origins[i] == "SAME" {
					origins[i] = x.policy.Origin
				}
			}
			_, e, n := x.authorize(t, v.method, origins, v.proofs)
			if (e == nil) != v.want {
				t.Fatalf("want=%v err=%v calls=%d", v.want, e, n)
			}
			if !v.want && n != 0 {
				t.Fatalf("invalid incoming headers dispatched upstream %d", n)
			}
		})
	}
}
func TestCurrentAuthorizeCrossSender(t *testing.T) {
	for _, key := range []string{"sessionBinding", "account", "deviceId", "deviceKey"} {
		t.Run(key, func(t *testing.T) {
			x := currentFixtureNew(t, "2")
			x.session[key] = "PUBLIC-other-sender"
			if key == "sessionBinding" {
				x.session[key] = strings.Repeat("e", 64)
			}
			if key == "account" {
				account, e := accountaddress.Encode("0x" + strings.Repeat("2", 40))
				if e != nil {
					t.Fatal(e)
				}
				x.session[key] = account
			}
			_, e, n := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
			if e == nil || n != 1 {
				t.Fatalf("cross sender admitted err=%v calls=%d", e, n)
			}
		})
	}
}

func TestCurrentAuthorizeVersionFieldClosure(t *testing.T) {
	for _, v := range []struct {
		name   string
		modify func(map[string]any)
	}{
		{"v3-missing-authorization", func(s map[string]any) { delete(s, "accountAuthorization") }},
		{"v3-null-authorization", func(s map[string]any) { s["accountAuthorization"] = nil }},
		{"v3-partial-authorization", func(s map[string]any) {
			s["accountAuthorization"] = map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1"}
		}},
		{"legacy-must-not-ignore-authorization", func(s map[string]any) { s["version"] = "2" }},
		{"unknown-version", func(s map[string]any) { s["version"] = "4" }},
		{"unknown-session-field", func(s map[string]any) { s["registered"] = true }},
	} {
		t.Run(v.name, func(t *testing.T) {
			x := currentFixtureNew(t, "3")
			v.modify(x.session)
			_, e, n := x.authorize(t, "POST", []string{x.policy.Origin}, nil)
			if e == nil || n != 1 {
				t.Fatalf("session schema widened err=%v calls=%d", e, n)
			}
		})
	}
}
