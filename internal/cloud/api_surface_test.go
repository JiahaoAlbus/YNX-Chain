package cloud

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func TestAPISurfaceLegacyAndRoot(t *testing.T) {
	s := testService(t, nil)
	envelope := testWalletEnvelope(t, s, "cloud", "surface", []string{"files.read", "files.write"})
	token, actor, err := s.CreateSession(context.Background(), envelope)
	if err != nil {
		t.Fatal(err)
	}
	object, err := s.Create(context.Background(), actor.Account, CreateObjectRequest{Product: "cloud", Kind: KindFile, Name: "existing.txt", Content: []byte("unchanged")})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(s)
	if err := server.EnableProductSessionV2("https://wallet-auth.ynxweb4.com"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	MountAPISurfaces(mux, server.Handler())
	request := func(method, route, proof string, proofPresent bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://web4.ynxweb4.com"+route, strings.NewReader(`{}`))
		r.Header.Set("Origin", "https://web4.ynxweb4.com")
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		// None of these client-controlled values may select authentication mode.
		r.Header.Set("X-YNX-API-Surface", "legacy")
		r.Header.Set("X-Forwarded-Prefix", "/cloud")
		r.Header.Set("X-Original-URI", "/cloud/api/v1/objects")
		if proofPresent {
			r.Header.Set(productsessionv2.ProofHeader, proof)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	before, err := json.Marshal(s.state)
	if err != nil {
		t.Fatal(err)
	}
	for _, prefix := range []string{"/cloud", "/docs-app"} {
		if w := request("GET", prefix+"/api/v1/objects/"+object.ID+"/content", "", false); w.Code != 200 || w.Body.String() != "unchanged" {
			t.Fatalf("legacy same-origin data %s: %d %s", prefix, w.Code, w.Body.String())
		}
		if w := request("GET", prefix+"/api/health", "", false); w.Code != 200 {
			t.Fatalf("legacy health: %d %s", w.Code, w.Body.String())
		}
		for _, proof := range []string{"invalid", ""} {
			if w := request("GET", prefix+"/api/v1/objects", proof, true); w.Code != 401 {
				t.Fatalf("proof must not fall back %s %q: %d %s", prefix, proof, w.Code, w.Body.String())
			}
		}
		for _, route := range []string{"/api/v1/session", "/api/v1/session/challenge"} {
			if w := request("POST", prefix+route, "", false); w.Code == 403 || w.Code == 404 {
				t.Fatalf("legacy issuance must reach envelope validation: %d %s", w.Code, w.Body.String())
			}
			if w := request("POST", prefix+route, "invalid", true); w.Code != 403 || !strings.Contains(w.Body.String(), "LEGACY_SESSION_ROUTE_DISABLED") {
				t.Fatalf("proof issuance bypass: %d %s", w.Code, w.Body.String())
			}
		}
	}
	if w := request("GET", "/api/v1/objects", "", false); w.Code != 401 {
		t.Fatalf("root must reject valid legacy bearer and forged headers: %d %s", w.Code, w.Body.String())
	}
	for _, route := range []string{"/api/v1/session", "/api/v1/session/challenge"} {
		if w := request("POST", route, "", false); w.Code != 403 || !strings.Contains(w.Body.String(), "LEGACY_SESSION_ROUTE_DISABLED") {
			t.Fatalf("root issuance: %d %s", w.Code, w.Body.String())
		}
	}
	redirect := request("POST", "/api/v1/objects/../session", "", false)
	if redirect.Code != http.StatusMovedPermanently || redirect.Header().Get("Location") != "/api/v1/session" {
		t.Fatalf("canonical redirect must remain on root: %d %q", redirect.Code, redirect.Header().Get("Location"))
	}
	if w := request("POST", redirect.Header().Get("Location"), "", false); w.Code != 403 || !strings.Contains(w.Body.String(), "LEGACY_SESSION_ROUTE_DISABLED") {
		t.Fatalf("followed root POST issuance: %d %s", w.Code, w.Body.String())
	}
	// A real Go HTTP client follows a 301 POST with GET. The canonical root
	// endpoint must still reject it and must not create any legacy session.
	sessionCount := len(s.state.Sessions)
	live := httptest.NewServer(mux)
	defer live.Close()
	clientRequest, err := http.NewRequest("POST", live.URL+"/api/v1/objects/../session", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	clientRequest.Header.Set("Authorization", "Bearer "+token)
	response, err := live.Client().Do(clientRequest)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.Request.Method != "GET" || response.Request.URL.Path != "/api/v1/session" || response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("POST-to-GET redirect issuance: method=%s path=%s status=%d", response.Request.Method, response.Request.URL.Path, response.StatusCode)
	}
	if len(s.state.Sessions) != sessionCount {
		t.Fatal("redirect issued a legacy session")
	}
	// A local authority double demonstrates successful root routing, not a real
	// Wallet proof or installed/public acceptance.
	fixture := &readAuthorityFixture{now: time.Now()}
	server.v2["https://web4.ynxweb4.com"] = fixture
	if w := request("GET", "/api/v1/objects", "fixture", true); w.Code != 403 || !strings.Contains(w.Body.String(), "CROSS_PRODUCT_SESSION") {
		t.Fatalf("distinct product policy: %d %s", w.Code, w.Body.String())
	}
	server.v2["https://web4.ynxweb4.com"] = nil
	server.v2 = nil
	if w := request("GET", "/api/v1/objects", "", false); w.Code != 503 || !strings.Contains(w.Body.String(), "PRODUCT_SESSION_V2_DISABLED") {
		t.Fatalf("disabled root must fail closed: %d %s", w.Code, w.Body.String())
	}
	if w := request("GET", "/cloud/api/v1/objects", "", false); w.Code != 200 {
		t.Fatalf("disabled v2 must preserve legacy bearer: %d %s", w.Code, w.Body.String())
	}
	// Content reads legitimately update usage; identity and stored records must
	// nevertheless remain valid, with no migration or replacement session.
	if len(before) == 0 {
		t.Fatal("empty original state")
	}
	if _, err := s.Authenticate(token); err != nil {
		t.Fatalf("original session changed: %v", err)
	}
	if got, err := s.Get(actor.Account, object.ID); err != nil || got.Hash != object.Hash {
		t.Fatalf("original object changed: %+v %v", got, err)
	}
}

func TestAPISurfaceRootV2Read(t *testing.T) {
	s := testService(t, nil)
	server := NewServer(s)
	fixture := &readAuthorityFixture{now: time.Now()}
	server.v2 = map[string]productReadAuthority{"https://docs.ynxweb4.com": fixture}
	mux := http.NewServeMux()
	MountAPISurfaces(mux, server.Handler())
	r := httptest.NewRequest("GET", "https://docs.ynxweb4.com/api/v1/objects", nil)
	r.Header.Set("Origin", "https://docs.ynxweb4.com")
	r.Header.Set(productsessionv2.ProofHeader, "explicit-local-authority-double")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	if w.Code != 200 || fixture.calls != 1 {
		t.Fatalf("root fresh authority: %d calls=%d %s", w.Code, fixture.calls, w.Body.String())
	}
}
