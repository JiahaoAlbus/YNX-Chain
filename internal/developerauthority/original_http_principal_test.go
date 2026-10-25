package developerauthority

// Actual normal Go methods, TLS pin/HTTP/context/body custody. Remote body is
// explicitly PUBLIC metadata fixture, not Root/PS crypto (R191 covers those).
import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type httpPrincipalFixture struct {
	mu         sync.Mutex
	calls      int
	operations []string
	change     bool
	last       originalHTTPPrincipalInput
}

func principalHTTPFixture(t *testing.T) (*OriginalDeveloperHTTPAuthority, *httpPrincipalFixture) {
	return principalHTTPFixtureWithLifetime(t, 20*time.Second)
}

// PUBLIC transport session lifetime is not a per-approval/current permission.
// Longer normal session fixture lets independent bounded flows run on CI;
// every Source/control/publication approval keeps its own <=30s window.
func principalHTTPFixtureWithLifetime(t *testing.T, lifetime time.Duration) (*OriginalDeveloperHTTPAuthority, *httpPrincipalFixture) {
	t.Helper()
	state := &httpPrincipalFixture{}
	if lifetime <= 0 || lifetime > 3*time.Minute {
		t.Fatal("PUBLIC session fixture lifetime invalid")
	}
	deadline := time.Now().Add(lifetime).UnixMilli()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in originalHTTPPrincipalInput
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			t.Error("fixture input")
			w.WriteHeader(400)
			return
		}
		state.mu.Lock()
		state.calls++
		state.operations = append(state.operations, in.Operation)
		state.last = in
		change := state.change
		state.mu.Unlock()
		p := Principal{"PUBLIC-account", "PUBLIC-device", "PUBLIC-session", "PUBLIC-current", 9007199254740993, 18446744073709551615, deadline}
		if change {
			p.SessionGeneration = 1
		}
		original, _ := json.Marshal(p)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"version": "YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v1", "principalOriginal": string(original), "principalSHA256": hash(original), "profileDigest": strings.Repeat("b", 64), "currentRaw": "PUBLIC-no-real-Root-source", "method": in.Method, "path": in.Path, "bodyDigest": hash([]byte(in.Body)), "expiresAtMs": deadline, "dataOnly": true, "authorized": false, "nativeAdmission": false})
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)
	owner, e := OpenOriginalDeveloperHTTPAuthority(OriginalDeveloperHTTPAuthorityConfig{hash(server.Certificate().RawSubjectPublicKeyInfo)})
	if e != nil {
		t.Fatal(e)
	}
	if owner.endpoint != originalHTTPPrincipalEndpoint || owner.transport.Proxy != nil {
		t.Fatal("not fixed normal transport")
	}
	// Explicit hermetic fixture-only rewiring of private fields: not a public
	// endpoint/CA provider or production admission path.
	pool := x509.NewCertPool()
	pool.AddCert(server.Certificate())
	owner.transport.TLSClientConfig.RootCAs = pool
	owner.transport.TLSClientConfig.ServerName = server.Certificate().DNSNames[0]
	owner.endpoint = server.URL + "/v1/developer/original-http-principal"
	t.Cleanup(func() { owner.Close() })
	return owner, state
}
func actualPrincipalRequest() *http.Request {
	r := httptest.NewRequest("POST", "https://developer.ynxweb4.com/api/developer/projects", strings.NewReader(`{"original":"<&>","revision":9007199254740993}`))
	r.Header.Set("x-request-id", "req_PUBLIC_ORIGINAL_12345")
	r.Header.Set(originalHTTPProofHeader, "PUBLIC-no-device-crypto-in-this-transport-fixture")
	return r
}

func TestOriginalHTTPPrincipalActualTLSNormalMethodsAndExactBigIntegers(t *testing.T) {
	o, s := principalHTTPFixture(t)
	r := actualPrincipalRequest()
	p, e := o.CurrentExistingPrincipal(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	if p.AccountGeneration != 9007199254740993 || p.SessionGeneration != 18446744073709551615 || p.CurrentRef != "PUBLIC-current" {
		t.Fatal("principal defaults/rounding")
	}
	body, _ := io.ReadAll(r.Body)
	if string(body) != `{"original":"<&>","revision":9007199254740993}` {
		t.Fatal("original body changed")
	}
	if e = o.AssertPrincipalCurrent(context.Background(), p); e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls != 2 || strings.Join(s.operations, ",") != "authenticate,recheck" || s.last.Body != string(body) {
		t.Fatal("normal calls not original/auth+recheck")
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("two methods became Source13")
	}
}
func TestOriginalHTTPPrincipalDuplicateOrMutatedPrincipalNeverResubmits(t *testing.T) {
	o, s := principalHTTPFixture(t)
	r := actualPrincipalRequest()
	p, e := o.CurrentExistingPrincipal(context.Background(), r)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = o.CurrentExistingPrincipal(context.Background(), r); e != ErrConflict {
		t.Fatal("blind proof replay", e)
	}
	p.DeviceID = "other"
	if e = o.AssertPrincipalCurrent(context.Background(), p); e != ErrDenied {
		t.Fatal("unobserved principal accepted")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls != 1 {
		t.Fatal("duplicate/mutated crossed transport")
	}
}
func TestOriginalHTTPPrincipalCurrentGenerationChangeKeepsUnknownAndFirstClose(t *testing.T) {
	o, s := principalHTTPFixture(t)
	p, e := o.CurrentExistingPrincipal(context.Background(), actualPrincipalRequest())
	if e != nil {
		t.Fatal(e)
	}
	s.mu.Lock()
	s.change = true
	s.mu.Unlock()
	if e = o.AssertPrincipalCurrent(context.Background(), p); e != ErrUnknown {
		t.Fatal("generation change accepted", e)
	}
	if e = o.AssertPrincipalCurrent(context.Background(), p); e != ErrDenied {
		t.Fatal("unknown automatically retried", e)
	}
	first := o.Close()
	if first != ErrUnknown || o.Close() != first {
		t.Fatal("lost first close result")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls != 2 {
		t.Fatal("unknown transport replay")
	}
}
func TestOriginalHTTPPrincipalWrongPinNeverReachesHandler(t *testing.T) {
	o, s := principalHTTPFixture(t)
	o.transport.TLSClientConfig.VerifyConnection = func(_ tls.ConnectionState) error { return ErrDenied }
	if _, e := o.CurrentExistingPrincipal(context.Background(), actualPrincipalRequest()); e != ErrUnknown {
		t.Fatal(e)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls != 0 {
		t.Fatal("wrong TLS identity reached handler")
	}
}
func TestOriginalHTTPPrincipalHeaderQueryAndUTF8FailBeforeTransportAndPreserveBody(t *testing.T) {
	o, s := principalHTTPFixture(t)
	for _, kind := range []string{"header", "query", "utf8"} {
		r := actualPrincipalRequest()
		switch kind {
		case "header":
			r.Header["x-ynx-product-session-proof-v2"] = []string{"PUBLIC-duplicate"}
		case "query":
			r.URL.RawQuery = "unbound=1"
		case "utf8":
			r.Body = io.NopCloser(strings.NewReader(string([]byte{255, 254})))
		}
		if _, e := o.CurrentExistingPrincipal(context.Background(), r); e != ErrDenied {
			t.Fatal(kind, e)
		}
		if kind == "utf8" {
			b, _ := io.ReadAll(r.Body)
			if len(b) != 2 || b[0] != 255 {
				t.Fatal("failed body consumed")
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.calls != 0 {
		t.Fatal("bad input crossed transport")
	}
}
func TestOriginalHTTPPrincipalPrivateCredentialsNeverFormat(t *testing.T) {
	v := originalHTTPPrincipalInput{Body: "PUBLIC_CREDENTIAL_MUST_NOT_FORMAT", ProofHeader: "PUBLIC_PROOF_MUST_NOT_FORMAT"}
	r := &originalHTTPPrincipalRecord{input: v, raw: []byte("PUBLIC_RAW_MUST_NOT_FORMAT")}
	for _, s := range []string{fmt.Sprintf("%v|%#v", v, v), fmt.Sprintf("%v|%#v", r, r), fmt.Sprintf("%v|%#v", &OriginalDeveloperHTTPAuthority{records: map[string]*originalHTTPPrincipalRecord{"test": r}}, &OriginalDeveloperHTTPAuthority{records: map[string]*originalHTTPPrincipalRecord{"test": r}})} {
		if strings.Contains(s, "MUST_NOT_FORMAT") {
			t.Fatal("private original formatted")
		}
	}
}
