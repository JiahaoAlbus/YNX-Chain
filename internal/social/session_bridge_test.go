package social

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Synthetic authority decisions exercise product integration, not installed E2E.
type bridgeAuthority struct {
	session productsessionv2.Session
	err     error
	calls   int
}

func (a *bridgeAuthority) Authorize(_ context.Context, r *http.Request, required []string) (productsessionv2.Session, error) {
	a.calls++
	if a.err != nil {
		return productsessionv2.Session{}, a.err
	}
	for _, scope := range required {
		if !contains(a.session.Scopes, scope) {
			return productsessionv2.Session{}, ErrUnauthorized
		}
	}
	return a.session, nil
}

type bridgeTransport func(*http.Request) (*http.Response, error)

func (f bridgeTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func bridgeService(t *testing.T, authority *bridgeAuthority, bridge *productsessionv2.BrowserSSO) *Service {
	t.Helper()
	dir := t.TempDir()
	key := bytes.Repeat([]byte{9}, 32)
	c, err := chat.New(chat.Config{StatePath: filepath.Join(dir, "chat.json"), APIKey: "test-social-internal-key"})
	if err != nil {
		t.Fatal(err)
	}
	q, err := square.New(square.Config{StatePath: filepath.Join(dir, "square.json"), APIKey: "test-social-internal-key"})
	if err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{StatePath: filepath.Join(dir, "social.json"), TokenKey: key, Chat: c, Square: q, ProductSessions: map[string]ProductSessionAuthorizer{authority.session.Platform: authority}, BrowserSSO: bridge, RateLimitMax: 1000})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func bridgeSession(f fixture, platform string) productsessionv2.Session {
	return productsessionv2.Session{Version: "2", SessionBinding: strings.Repeat("a", 64), ProductID: RequestingProduct, ClientID: ProductClientID, Platform: platform, Account: f.account, DeviceID: "product-device-test", DeviceKey: "synthetic-public-p256-key", Scopes: []string{"account:read", "profile:link", "social.messaging", "social.profile"}, ExpiresAt: time.Now().Add(4 * time.Minute).UTC().Format(time.RFC3339Nano)}
}
func bridgeRegistration(f fixture, session productsessionv2.Session) productDeviceRegistration {
	in := productDeviceRegistration{DeviceID: f.device, SigningPublicKey: nativewallet.EncodePublicKey(f.deviceKeys.SigningPublic), EncryptionPublicKey: nativewallet.EncodePublicKey(f.deviceKeys.EncryptionPublic)}
	in.DeviceProofSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, productDeviceProofPayload(session, in))
	c := chat.RegisterDeviceRequest{Account: session.Account, DeviceID: in.DeviceID, SigningPublicKey: in.SigningPublicKey, EncryptionPublicKey: in.EncryptionPublicKey, IdempotencyKey: RegistrationIdempotencyKey("social-chat", session.SessionBinding)}
	in.ChatRegistrationSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, chat.DeviceRegistrationPayload(c))
	q := square.RegisterDeviceRequest{Account: session.Account, DeviceID: in.DeviceID, SigningPublicKey: in.SigningPublicKey, IdempotencyKey: RegistrationIdempotencyKey("social-square", session.SessionBinding)}
	in.SquareRegistrationSignature = nativewallet.Sign(f.deviceKeys.SigningPrivate, square.DeviceRegistrationPayload(q))
	return in
}
func bridgeRequest(platform, path, method string, body any) *http.Request {
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	r := httptest.NewRequest(method, Origin+path, reader)
	r.Header.Set(productsessionv2.ProofHeader, base64.RawURLEncoding.EncodeToString([]byte(`{"platform":"`+platform+`"}`)))
	return r
}
func TestScopedBridgeReusesDevicePersistsAndRequiresLiveAuthority(t *testing.T) {
	f := newFixture(t, 55)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	server := NewServer(s, s)
	bind := func(session productsessionv2.Session) Session {
		t.Helper()
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, bridgeRequest("android", "/social/v2/session/bind", "POST", bridgeRegistration(f, session)))
		if w.Code != 200 {
			t.Fatalf("bind status %d %s", w.Code, w.Body.String())
		}
		var result struct{ Session Session }
		json.Unmarshal(w.Body.Bytes(), &result)
		return result.Session
	}
	actor := bind(a.session)
	if actor.DeviceID != f.device {
		t.Fatal("chat device substituted")
	}
	first := s.state.Devices[f.device]
	a.session.SessionBinding = strings.Repeat("b", 64)
	actor = bind(a.session)
	if s.state.Devices[f.device] != first {
		t.Fatal("existing device keys/timestamps changed")
	}
	restarted, err := New(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	server = NewServer(restarted, restarted)
	request := bridgeRequest("android", "/social/v1/profile", "GET", nil)
	before := a.calls
	if got, err := server.authorizeProductActor(request, "social.profile"); err != nil || got.ID != actor.ID {
		t.Fatalf("persisted binding %v", err)
	}
	if a.calls != before+1 {
		t.Fatal("authority decision cached")
	}
	a.err = &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: 503}
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, request)
	if w.Code != 503 {
		t.Fatal("degradation authorized or misreported")
	}
	a.err = nil
	previous := a.session.Account
	a.session.Account = newFixture(t, 56).account
	if _, err := server.authorizeProductActor(request, "social.profile"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("account switch reused old actor")
	}
	a.session.Account = previous
	if err := restarted.RevokeSession(actor); err != nil {
		t.Fatal(err)
	}
	if _, err := server.authorizeProductActor(request, "social.profile"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked actor remained accessible")
	}
}
func TestScopedBridgeRejectsIdentityAndDeviceSubstitution(t *testing.T) {
	f := newFixture(t, 57)
	a := &bridgeAuthority{session: bridgeSession(f, "android")}
	s := bridgeService(t, a, nil)
	server := NewServer(s, s)
	for _, scopes := range [][]string{walletScopes, {"social.profile"}} {
		a.session.Scopes = scopes
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, bridgeRequest("android", "/social/v2/session/bind", "POST", bridgeRegistration(f, a.session)))
		if w.Code != 401 {
			t.Fatal("identity/profile-only bind accepted")
		}
	}
	a.session.Scopes = []string{"social.messaging", "social.profile"}
	in := bridgeRegistration(f, a.session)
	in.EncryptionPublicKey = bridgeRegistration(newFixture(t, 58), a.session).EncryptionPublicKey
	if _, err := s.bindProductDevice(a.session, in, "", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("substituted encryption key accepted")
	}
	if len(s.state.ProductBindings) != 0 {
		t.Fatal("failed proof persisted actor")
	}
}
func TestWebBridgeRequiresExactCookieCSRFAndLiveIdentity(t *testing.T) {
	f := newFixture(t, 59)
	a := &bridgeAuthority{session: bridgeSession(f, "web")}
	identity := productsessionv2.BrowserIdentity{Subject: f.account, Account: f.account, Generation: 1, ExpiresAt: time.Now().Add(time.Hour)}
	revoked := false
	transport := bridgeTransport(func(r *http.Request) (*http.Response, error) {
		status := 200
		var body any
		grant := productsessionv2.BrowserGrant{GrantToken: strings.Repeat("g", 43), Identity: identity, Audience: "ynx:social:identity", Scopes: []string{"identity:read"}, ExpiresAt: time.Now().Add(5 * time.Minute)}
		if r.URL.Path == "/v2/browser-sessions/token" {
			body = grant
		} else if revoked {
			status = 401
			body = map[string]bool{"active": false}
		} else {
			body = grant
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
	route, _ := url.Parse(start.Header().Get("Location"))
	callback := httptest.NewRequest("GET", Origin+"/sso/callback?state="+route.Query().Get("state")+"&code="+strings.Repeat("c", 43), nil)
	for _, cookie := range start.Result().Cookies() {
		callback.AddCookie(cookie)
	}
	completed := httptest.NewRecorder()
	bridge.Callback(completed, callback)
	if completed.Code != 303 {
		t.Fatal("identity callback failed")
	}
	s := bridgeService(t, a, bridge)
	server := NewServer(s, s)
	r := bridgeRequest("web", "/social/v2/session/bind", "POST", bridgeRegistration(f, a.session))
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
	if _, _, err := server.browserProductBinding(r, a.session, nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("missing CSRF accepted")
	}
	r.Header.Set("X-YNX-SSO-CSRF", grant.CSRF)
	if _, _, err := server.browserProductBinding(r, a.session, nil); err != nil {
		t.Fatal(err)
	}
	identity.Generation++
	if _, _, err := server.browserProductBinding(r, a.session, nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("changed identity generation accepted")
	}
	identity.Generation--
	revoked = true
	if _, _, err := server.browserProductBinding(r, a.session, nil); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("revoked identity accepted")
	}
}
