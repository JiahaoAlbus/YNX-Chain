package social

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Synthetic identities and authority decisions test the product contract only.
// No real homeserver login, provisioning or user-device acceptance is claimed.
func matrixDirectoryFixture(t *testing.T, bindings ...MatrixIdentity) *MatrixDirectory {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"schemaVersion": MatrixDirectorySchema, "bindings": bindings})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := ParseMatrixDirectory(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	return directory
}

func TestMatrixDirectoryPreservesExistingIdentityAndRejectsCollisions(t *testing.T) {
	account := "ynx1" + strings.Repeat("a", 38)
	other := "ynx1" + strings.Repeat("b", 38)
	binding := MatrixIdentity{account, "https://matrix.example.test", "matrix.example.test", "@historical-user:matrix.example.test"}
	directory := matrixDirectoryFixture(t, binding)
	got, err := directory.Resolve(account)
	if err != nil || got.UserID != binding.UserID || got.Homeserver != binding.Homeserver+"/" {
		t.Fatal("existing MXID was replaced or routing differed")
	}
	if _, err := directory.Resolve(other); !errors.Is(err, ErrNotFound) {
		t.Fatal("absent historical mapping was derived")
	}
	for _, bindings := range [][]MatrixIdentity{
		{binding, binding},
		{binding, {other, binding.Homeserver, binding.ServerName, binding.UserID}},
		{{account, "http://matrix.example.test/", binding.ServerName, binding.UserID}},
		{{account, "https://matrix.example.test/?token=fixture", binding.ServerName, binding.UserID}},
		{{account, binding.Homeserver, binding.ServerName, "@historical-user:other.example.test"}},
		{{account, binding.Homeserver, binding.ServerName, "@bad user:matrix.example.test"}},
	} {
		raw, _ := json.Marshal(map[string]any{"schemaVersion": MatrixDirectorySchema, "bindings": bindings})
		if _, err := ParseMatrixDirectory(bytes.NewReader(raw)); err == nil {
			t.Fatal("unsafe/colliding Matrix mapping accepted")
		}
	}
	for _, input := range []string{`{"schemaVersion":"other","bindings":[]}`, `{"schemaVersion":"ynx-social-matrix-directory/v1","bindings":[],"accessToken":"fixture"}`, strings.Repeat(" ", 128*1024+1)} {
		if _, err := ParseMatrixDirectory(strings.NewReader(input)); err == nil {
			t.Fatal("unsupported or oversized configuration accepted")
		}
	}
}

func TestMatrixMetadataMountedTokenFreeAndPreservesPersistentState(t *testing.T) {
	f := newFixture(t, 80)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	expected := MatrixIdentity{f.account, "https://matrix.example.test/", "matrix.example.test", "@old-user:matrix.example.test"}
	s.cfg.MatrixDirectory = matrixDirectoryFixture(t, expected)
	before, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/login-metadata", "POST", map[string]string{"deviceId": "ORIGINAL-DEVICE"}))
	var result map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result) != 5 || result["userId"] != expected.UserID || result["protocol"] != matrixLoginProtocol || result["account"] != f.account {
		t.Fatalf("metadata contract differed: status %d", w.Code)
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Referrer-Policy") != "no-referrer" || strings.Contains(w.Body.String(), "accessToken") || strings.Contains(w.Body.String(), "deviceId") {
		t.Fatal("metadata exposed credentials/device or missed privacy headers")
	}
	after, err := os.ReadFile(s.cfg.StatePath)
	if err != nil || !bytes.Equal(before, after) || len(s.state.Devices) != 0 || len(s.state.ProductBindings) != 0 {
		t.Fatal("metadata changed old account/device/history state")
	}
	w = httptest.NewRecorder()
	NewServer(s, s).Handler().ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/session", "POST", map[string]string{"deviceId": "ORIGINAL-DEVICE"}))
	if w.Code != 404 {
		t.Fatal("obsolete Matrix token issuance was mounted")
	}
}

func TestMatrixMetadataRejectsMalformedInputsBeforeAuthority(t *testing.T) {
	f := newFixture(t, 81)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	handler := NewServer(s, s).Handler()
	for _, body := range []string{`{}`, `{"deviceId":"ab"}`, `{"deviceId":"ORIGINAL","deviceId":"SECOND"}`, `{"deviceId":"ORIGINAL","account":"other"}`, `{"deviceId":"ORIGINAL","accessToken":"fixture"}`, `{"deviceId":"ORIGINAL"}{}`, `[]`, strings.Repeat(" ", 1025)} {
		w := httptest.NewRecorder()
		r := bridgeRequest("android", "/social/v3/matrix/login-metadata", "POST", nil)
		r.Body = io.NopCloser(strings.NewReader(body))
		handler.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("malformed metadata status %d", w.Code)
		}
	}
	for _, path := range []string{"/social/v3/matrix/login-metadata?account=other", "/social/v3/matrix/peer?account=bad", "/social/v3/matrix/peer?account=" + f.account + "&account=" + f.account, "/social/v3/matrix/peer?account=" + f.account + "&token=fixture", "/social/v3/matrix/peer?account=%"} {
		method := "POST"
		if strings.Contains(path, "/peer") {
			method = "GET"
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", path, method, map[string]string{"deviceId": "ORIGINAL"}))
		if w.Code != 400 {
			t.Fatalf("malformed query status %d", w.Code)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/login-metadata", "GET", nil))
	if w.Code != 405 || w.Header().Get("Allow") != "POST" || a.calls != 0 {
		t.Fatal("malformed requests reached authority or wrong method accepted")
	}
}

func TestMatrixMetadataRequiresFreshExplicitScopesAndExistingMapping(t *testing.T) {
	f := newFixture(t, 82)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	handler := NewServer(s, s).Handler()
	call := func() int {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/login-metadata", "POST", map[string]string{"deviceId": "ORIGINAL"}))
		return w.Code
	}
	if call() != 401 {
		t.Fatal("contacts approval was bypassed")
	}
	a.session.Scopes = []string{"social.contacts", "social.messaging"}
	if call() != 401 {
		t.Fatal("profile approval was bypassed")
	}
	a.session.Scopes = append(a.session.Scopes, "social.profile")
	if call() != 503 {
		t.Fatal("missing operator directory was invented")
	}
	s.cfg.MatrixDirectory = matrixDirectoryFixture(t, MatrixIdentity{"ynx1" + strings.Repeat("b", 38), "https://matrix.example.test/", "matrix.example.test", "@old:matrix.example.test"})
	if call() != 409 {
		t.Fatal("missing account mapping was auto-registered")
	}
	a.err = &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
	if call() != 503 {
		t.Fatal("network outage became revoked identity")
	}
	a.err = ErrUnauthorized
	if call() != 401 {
		t.Fatal("revocation was cached as active")
	}
	a.err = nil
	a.session.ExpiresAt = time.Now().Add(-time.Minute).Format(time.RFC3339Nano)
	if call() != 401 {
		t.Fatal("expired authority session accepted")
	}
	w := httptest.NewRecorder()
	r := bridgeRequest("android", "/social/v3/matrix/login-metadata", "POST", map[string]string{"deviceId": "ORIGINAL"})
	r.Header.Del(productsessionv2.ProofHeader)
	handler.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("identity-only or absent proof accepted")
	}
}

func TestMatrixPeerRequiresAcceptedContactAndSupportsAnotherHomeserver(t *testing.T) {
	f, peer := newFixture(t, 83), newFixture(t, 84)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	s := bridgeService(t, a, nil)
	s.cfg.MatrixDirectory = matrixDirectoryFixture(t,
		MatrixIdentity{f.account, "https://one.example.test/", "one.example.test", "@old-one:one.example.test"},
		MatrixIdentity{peer.account, "https://two.example.test/", "two.example.test", "@old-two:two.example.test"})
	handler := NewServer(s, s).Handler()
	call := func(account string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, bridgeRequest("android", "/social/v3/matrix/peer?account="+account, "GET", nil))
		return w
	}
	if call(peer.account).Code != 401 {
		t.Fatal("unaccepted peer identity was exposed")
	}
	// Deliberately synthetic accepted-contact fixture, not real-user acceptance.
	s.state.Contacts[pairKey(f.account, peer.account)] = Contact{Left: f.account, Right: peer.account, CreatedAt: time.Now()}
	w := call(peer.account)
	var result map[string]any
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result) != 5 || result["userId"] != "@old-two:two.example.test" || result["protocol"] != matrixPeerProtocol {
		t.Fatal("remote historical peer mapping differed")
	}
	if call(f.account).Code != 401 {
		t.Fatal("self peer was treated as accepted contact")
	}
	if err := s.Block(Session{Account: f.account}, peer.account); err != nil || call(peer.account).Code != 401 {
		t.Fatal("blocked/deleted contact mapping remained available")
	}
}

func TestMatrixWebMetadataRequiresCookieCSRFAndLiveBrowserIdentity(t *testing.T) {
	f := newFixture(t, 85)
	a := &bridgeAuthority{session: bridgeSession(f, "web")}
	a.session.Scopes = append(a.session.Scopes, "social.contacts")
	identity := productsessionv2.BrowserIdentity{Subject: f.account, Account: f.account, Generation: 1, ExpiresAt: time.Now().Add(time.Hour)}
	revoked, unavailable := false, false
	transport := bridgeTransport(func(r *http.Request) (*http.Response, error) {
		if unavailable {
			return nil, errors.New("synthetic network interruption")
		}
		status := 200
		var body any = productsessionv2.BrowserGrant{GrantToken: strings.Repeat("g", 43), Identity: identity, Audience: "ynx:social:identity", Scopes: []string{"identity:read"}, ExpiresAt: time.Now().Add(5 * time.Minute)}
		if revoked {
			status, body = 401, map[string]bool{"active": false}
		}
		raw, _ := json.Marshal(body)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(bytes.NewReader(raw))}, nil
	})
	bridge, err := productsessionv2.NewBrowserSSO("social", "https://wallet-auth.ynxweb4.com", bytes.Repeat([]byte{9}, 32), []string{"conversations"}, transport)
	if err != nil {
		t.Fatal(err)
	}
	start := httptest.NewRecorder()
	bridge.Start(start, httptest.NewRequest("GET", Origin+"/sso/start", nil))
	redirect, _ := url.Parse(start.Header().Get("Location"))
	callback := httptest.NewRequest("GET", Origin+"/sso/callback?state="+redirect.Query().Get("state")+"&code="+strings.Repeat("c", 43), nil)
	for _, cookie := range start.Result().Cookies() {
		callback.AddCookie(cookie)
	}
	completed := httptest.NewRecorder()
	bridge.Callback(completed, callback)
	if completed.Code != 303 {
		t.Fatal("synthetic SSO cookie fixture failed")
	}
	s := bridgeService(t, a, bridge)
	s.cfg.MatrixDirectory = matrixDirectoryFixture(t, MatrixIdentity{f.account, "https://matrix.example.test/", "matrix.example.test", "@original:matrix.example.test"})
	handler := NewServer(s, s).Handler()
	request := func() *http.Request {
		r := bridgeRequest("web", "/social/v3/matrix/login-metadata", "POST", map[string]string{"deviceId": "ORIGINAL"})
		for _, cookie := range completed.Result().Cookies() {
			if cookie.MaxAge != -1 {
				r.AddCookie(cookie)
			}
		}
		_, grant, err := bridge.Binding(r)
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Origin", Origin)
		r.Header.Set("X-YNX-SSO-CSRF", grant.CSRF)
		return r
	}
	call := func(r *http.Request) int {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	if call(request()) != 200 {
		t.Fatal("current cookie/proof/CSRF contract rejected")
	}
	r := request()
	r.Header.Del("X-YNX-SSO-CSRF")
	if call(r) != 401 {
		t.Fatal("missing CSRF accepted")
	}
	r = request()
	r.Header.Set("Origin", "https://other.example.test")
	if call(r) != 401 {
		t.Fatal("cross-origin metadata accepted")
	}
	identity.Generation++
	if call(request()) != 401 {
		t.Fatal("changed identity generation accepted")
	}
	identity.Generation--
	revoked = true
	if call(request()) != 401 {
		t.Fatal("revoked browser identity accepted")
	}
	revoked, unavailable = false, true
	if call(request()) != 503 {
		t.Fatal("temporary browser authority outage became revoked identity")
	}
}
