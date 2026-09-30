package productsessionv2

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// Backend response fixture only: these tests are not Wallet/public approval.
func TestBrowserSSOExpiredTransactionReturnsTargetWithoutRedeeming(t *testing.T) {
	for _, product := range []string{"finance", "exchange", "quant"} {
		s, err := NewBrowserSSO(product, browserIssuer, []byte(strings.Repeat("q", 32)), []string{"overview", "risk"}, roundTrip(func(*http.Request) (*http.Response, error) {
			t.Fatal("expired transaction reached token exchange")
			return nil, nil
		}))
		if err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		s.now = func() time.Time { return now }
		start := httptest.NewRecorder()
		s.Start(start, httptest.NewRequest("GET", s.origin+"/sso/start?target=risk", nil))
		cookie := start.Result().Cookies()[0]
		if cookie.MaxAge != 600 || !cookie.Secure || !cookie.HttpOnly {
			t.Fatal("target recovery cookie is not bounded/private")
		}
		state := mustParseURL(t, start.Header().Get("Location")).Query().Get("state")
		now = now.Add(3 * time.Minute)
		for _, sample := range []struct {
			query  string
			status int
			target string
		}{
			{"state=" + state + "&error=access_denied", 303, "/#risk"},
			{"state=" + state + "&code=" + strings.Repeat("c", 43), 400, ""},
			{"state=" + strings.Repeat("x", 43) + "&error=access_denied", 400, ""},
		} {
			r := httptest.NewRequest("GET", s.origin+"/sso/callback?"+sample.query, nil)
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			s.Callback(w, r)
			if w.Code != sample.status || w.Header().Get("Location") != sample.target {
				t.Fatal("expired callback crossed authorization or target boundary")
			}
		}
		now = now.Add(8 * time.Minute)
		r := httptest.NewRequest("GET", s.origin+"/sso/callback?state="+state+"&error=access_denied", nil)
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		s.Callback(w, r)
		if w.Code != 400 {
			t.Fatal("target recovery retention was unbounded")
		}
	}
}

func mustParseURL(t *testing.T, value string) *url.URL {
	t.Helper()
	u, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestBrowserSSORegisteredConsumersKeepIdentityAndPrivatePermissionSeparate(t *testing.T) {
	account := fixture(t).Session.Account
	for _, product := range []string{"finance", "exchange", "quant"} {
		t.Run(product, func(t *testing.T) {
			var degraded, revoked bool
			var remembered string
			var s *BrowserSSO
			transport := roundTrip(func(r *http.Request) (*http.Response, error) {
				if r.Header.Get("Origin") != "" || r.Header.Get("Cookie") != "" {
					t.Fatal("backend credential request carried browser auth")
				}
				var input map[string]string
				_ = json.NewDecoder(r.Body).Decode(&input)
				if input["clientId"] != "ynx-"+product+"-v1-sso-v1" {
					t.Fatal("client was not registry-owned")
				}
				status := 200
				var body any
				grant := BrowserGrant{GrantToken: strings.Repeat("g", 43), Identity: BrowserIdentity{account, account, 1, time.Now().Add(time.Hour)}, Audience: "ynx:" + product + ":identity", Scopes: []string{"identity:read"}, ExpiresAt: time.Now().Add(5 * time.Minute)}
				if r.URL.Path == "/v2/browser-sessions/token" {
					if input["origin"] != s.origin || input["redirectUri"] != s.origin+"/sso/callback" || len(input["codeVerifier"]) != 43 {
						t.Fatal("redemption lost PKCE/origin binding")
					}
					body = grant
				} else if r.URL.Path == "/v2/browser-sessions/logout-grant" {
					revoked = true
					body = map[string]bool{"revoked": true}
				} else if degraded {
					status = 503
					body = map[string]string{"code": "temporary"}
				} else if revoked {
					status = 401
					body = map[string]string{"code": "revoked"}
				} else {
					var local BrowserGrant
					_ = s.open(s.identityCookie, remembered, &local)
					grant.Identity = local.Identity
					grant.GrantToken = ""
					body = grant
				}
				raw, _ := json.Marshal(body)
				return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(raw)))}, nil
			})
			var err error
			s, err = NewBrowserSSO(product, browserIssuer, []byte(strings.Repeat("k", 32)), []string{"account", "activity"}, transport)
			if err != nil {
				t.Fatal(err)
			}
			start := httptest.NewRecorder()
			s.Start(start, httptest.NewRequest("GET", s.origin+"/sso/start?target=activity", nil))
			pendingCookie := start.Result().Cookies()[0]
			location, _ := url.Parse(start.Header().Get("Location"))
			if location.Host != "wallet-auth.ynxweb4.com" {
				t.Fatal("issuer drift")
			}
			repeat := httptest.NewRecorder()
			repeatRequest := httptest.NewRequest("GET", s.origin+"/sso/start?target=account", nil)
			repeatRequest.AddCookie(pendingCookie)
			s.Start(repeat, repeatRequest)
			if repeat.Header().Get("Location") != start.Header().Get("Location") {
				t.Fatal("repeated start replaced intent")
			}
			callback := httptest.NewRequest("GET", s.origin+"/sso/callback?"+url.Values{"state": {location.Query().Get("state")}, "code": {strings.Repeat("c", 43)}}.Encode(), nil)
			callback.AddCookie(pendingCookie)
			completed := httptest.NewRecorder()
			s.Callback(completed, callback)
			if completed.Code != 303 || completed.Header().Get("Location") != "/#activity" {
				t.Fatal("original target not restored")
			}
			identityCookie := completed.Result().Cookies()[0]
			if !identityCookie.Secure || !identityCookie.HttpOnly || identityCookie.Domain != "" || identityCookie.Path != "/" {
				t.Fatal("cookie protections missing")
			}
			request := httptest.NewRequest("GET", s.origin+"/api/sso/account", nil)
			request.AddCookie(identityCookie)
			binding, local, err := s.Binding(request)
			if err != nil {
				t.Fatal(err)
			}
			remembered = binding
			view := httptest.NewRecorder()
			s.Account(view, request)
			if view.Code != 200 || strings.Contains(view.Body.String(), "grantToken") || strings.Contains(view.Body.String(), "verifier") || !strings.Contains(view.Body.String(), `"privateWorkspaceAuthorized":false`) {
				t.Fatal("identity widened or leaked a backend credential")
			}
			degraded = true
			temporary := httptest.NewRecorder()
			s.Account(temporary, request)
			if temporary.Code != 503 || len(temporary.Result().Cookies()) != 0 {
				t.Fatal("temporary failure cleared valid identity cookie")
			}
			degraded = false
			if _, status := s.VerifyBinding(context.Background(), binding, "wrong-account"); status != 401 {
				t.Fatal("another native account adopted identity")
			}
			logoutRequest := httptest.NewRequest("POST", s.origin+"/api/sso/logout", nil)
			logoutRequest.AddCookie(identityCookie)
			logoutRequest.Header.Set("Origin", s.origin)
			logoutRequest.Header.Set("X-YNX-SSO-CSRF", local.CSRF)
			logout := httptest.NewRecorder()
			s.Logout(logout, logoutRequest)
			if logout.Code != 200 || len(logout.Result().Cookies()) != 2 {
				t.Fatal("logout did not clear identity and pending callbacks")
			}
			if _, status := s.VerifyBinding(context.Background(), binding, account); status != 401 {
				t.Fatal("revoked linked permission survived server recheck")
			}
		})
	}
}

func TestBrowserSSOPolicyAndCrossProductCookiesFailClosed(t *testing.T) {
	if _, err := NewBrowserSSO("attacker", browserIssuer, []byte(strings.Repeat("k", 32)), []string{"account"}, nil); err == nil {
		t.Fatal("unknown product accepted")
	}
	if _, err := NewBrowserSSO("finance", "https://attacker.example", []byte(strings.Repeat("k", 32)), []string{"account"}, nil); err == nil {
		t.Fatal("unknown issuer accepted")
	}
	if _, err := NewBrowserSSO("finance", "http://127.0.0.1:12345", []byte(strings.Repeat("k", 32)), []string{"account"}, nil); err == nil {
		t.Fatal("production constructor accepted loopback issuer")
	}
	if _, err := NewBrowserSSO("finance", browserIssuer, []byte("weak"), []string{"account"}, nil); err == nil {
		t.Fatal("weak cookie key accepted")
	}
	finance, _ := NewBrowserSSO("finance", browserIssuer, []byte(strings.Repeat("k", 32)), []string{"account"}, nil)
	quant, _ := NewBrowserSSO("quant", browserIssuer, []byte(strings.Repeat("k", 32)), []string{"account"}, nil)
	encoded, _ := finance.seal(finance.identityCookie, BrowserGrant{})
	var value BrowserGrant
	if quant.open(quant.identityCookie, encoded, &value) == nil {
		t.Fatal("cross-product cookie accepted")
	}
}

func TestBrowserSSOFinanceOldCipherAndDurableBindingRemainReadable(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	account := fixture(t).Session.Account
	local := BrowserGrant{GrantToken: strings.Repeat("g", 43), Identity: BrowserIdentity{account, account, 1, time.Now().Add(time.Hour)}, Audience: "ynx:finance:identity", Scopes: []string{"identity:read"}, ExpiresAt: time.Now().Add(5 * time.Minute), CSRF: strings.Repeat("c", 43)}
	oldKey := sha256.Sum256(append([]byte("YNX Finance SSO cookie v1\x00"), key...))
	block, _ := aes.NewCipher(oldKey[:])
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	raw, _ := json.Marshal(local)
	sealed := base64.RawURLEncoding.EncodeToString(aead.Seal(nonce, nonce, raw, []byte("__Host-ynx-finance-identity\x00https://finance.ynxweb4.com")))
	bridge, err := NewBrowserSSO("finance", browserIssuer, key, []string{"account"}, roundTrip(func(*http.Request) (*http.Response, error) {
		fresh := local
		fresh.GrantToken = ""
		fresh.CSRF = ""
		encoded, _ := json.Marshal(fresh)
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(encoded)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "https://finance.ynxweb4.com/api/sso/account", nil)
	request.AddCookie(&http.Cookie{Name: "__Host-ynx-finance-identity", Value: sealed})
	if _, grant, err := bridge.Binding(request); err != nil || grant.Identity.Account != account {
		t.Fatal("existing Finance cookie became unreadable")
	}
	if _, status := bridge.VerifyBinding(context.Background(), sealed, account); status != 200 {
		t.Fatal("existing Finance persisted sealed binding became unreadable")
	}
}
