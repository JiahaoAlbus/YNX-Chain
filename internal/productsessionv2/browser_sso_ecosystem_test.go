package productsessionv2

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Original Central authority and HTTP routes, with only test-owned temporary
// state/software Wallet signing. No production account, key or OS approval.
func TestBrowserSSOWorkspaceRealCentralHTTP(t *testing.T) {
	if os.Getenv("YNX_QA_CENTRAL_SOURCE") == "" {
		t.Skip("explicit reviewed Central source required for actual Node interoperability")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "testdata/browser-sso-ecosystem-node.mjs")
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	cmd.Env = append(os.Environ(), "YNX_QA_STATE_PATH="+filepath.Join(directory, "browser-authority"))
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	scanner := bufio.NewScanner(stdout)
	var ready struct {
		URL      string `json:"url"`
		Registry []struct {
			ProductID   string   `json:"productId"`
			ClientID    string   `json:"clientId"`
			Origin      string   `json:"origin"`
			RedirectURI string   `json:"redirectUri"`
			Audience    string   `json:"audience"`
			Scopes      []string `json:"scopes"`
		} `json:"registry"`
		DefaultRoster int `json:"defaultRoster"`
	}
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &ready) != nil {
		t.Fatal("actual Central fixture startup failed", diagnostic.String())
	}
	if len(ready.Registry) != 13 || ready.DefaultRoster != 6 {
		t.Fatal("approved identity roster changed")
	}
	local, err := url.Parse(ready.URL)
	if err != nil || local.Hostname() != "127.0.0.1" {
		t.Fatal("fixture must be loopback")
	}
	transport := roundTrip(func(r *http.Request) (*http.Response, error) {
		copy := r.Clone(r.Context())
		u := *r.URL
		u.Scheme = local.Scheme
		u.Host = local.Host
		copy.URL = &u
		return http.DefaultTransport.RoundTrip(copy)
	})
	control := func(path string, input any, output any) {
		t.Helper()
		raw, _ := json.Marshal(input)
		r, err := http.NewRequestWithContext(ctx, "POST", ready.URL+path, bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("fixture command rejected", response.Status)
		}
		if err = json.NewDecoder(response.Body).Decode(output); err != nil {
			t.Fatal(err)
		}
	}
	mode := func(value string) {
		var result map[string]any
		control("/__qa/mode", map[string]string{"mode": value}, &result)
	}
	for _, product := range []string{"cloud", "docs", "calendar"} {
		t.Run(product, func(t *testing.T) {
			s, err := NewBrowserSSO(product, browserIssuer, []byte(strings.Repeat("k", 32)), []string{"overview", "editor"}, transport)
			if err != nil {
				t.Fatal(err)
			}
			if s.client.CheckRedirect(&http.Request{}, nil) != http.ErrUseLastResponse {
				t.Fatal("backend redirect-deny contract changed")
			}
			var matched bool
			for _, entry := range ready.Registry {
				if entry.ProductID == product {
					matched = true
					if s.clientID != entry.ClientID || s.origin != entry.Origin || s.audience != entry.Audience || entry.RedirectURI != s.origin+"/sso/callback" || len(entry.Scopes) != 1 || entry.Scopes[0] != "identity:read" {
						t.Fatal("Go tuple differs from approved JS registry")
					}
				}
			}
			if !matched {
				t.Fatal("product not approved")
			}
			login := func(target string) (*http.Request, string, BrowserGrant) {
				t.Helper()
				start := httptest.NewRecorder()
				s.Start(start, httptest.NewRequest("GET", s.origin+"/sso/start?target="+url.QueryEscape(target), nil))
				if start.Code != 303 {
					t.Fatal("prepare failed")
				}
				location := start.Header().Get("Location")
				u := mustParseURL(t, location)
				if u.Query().Get("clientId") != s.clientID || u.Query().Get("origin") != s.origin || u.Query().Get("redirectUri") != s.origin+"/sso/callback" || u.Query().Get("codeChallengeMethod") != "S256" {
					t.Fatal("prepare tuple drift")
				}
				var approval struct {
					RedirectURI string `json:"redirectUri"`
				}
				control("/__qa/approve", map[string]string{"url": location}, &approval)
				pending := start.Result().Cookies()[0]
				returned := httptest.NewRequest("GET", approval.RedirectURI, nil)
				returned.AddCookie(pending)
				malformed := httptest.NewRequest("GET", approval.RedirectURI+"&state=duplicate", nil)
				malformed.AddCookie(pending)
				bad := httptest.NewRecorder()
				s.Callback(bad, malformed)
				if bad.Code != 400 {
					t.Fatal("duplicate state accepted")
				}
				completed := httptest.NewRecorder()
				s.Callback(completed, returned)
				expected := target
				if expected != "editor" {
					expected = "overview"
				}
				if completed.Code != 303 || completed.Header().Get("Location") != "/#"+expected {
					t.Fatal("redeem failed or target crossed allowlist", completed.Code, completed.Body.String())
				}
				var cookie *http.Cookie
				for _, c := range completed.Result().Cookies() {
					if c.Name == s.identityCookie {
						cookie = c
					}
				}
				if cookie == nil || !cookie.Secure || !cookie.HttpOnly || cookie.Domain != "" || cookie.Path != "/" || cookie.MaxAge > 300 {
					t.Fatal("identity cookie widened")
				}
				request := httptest.NewRequest("GET", s.origin+"/api/sso/account", nil)
				request.AddCookie(cookie)
				binding, grant, err := s.Binding(request)
				if err != nil {
					t.Fatal(err)
				}
				replay := httptest.NewRecorder()
				s.Callback(replay, returned)
				if replay.Code == 303 {
					t.Fatal("used authorization code replayed")
				}
				return request, binding, grant
			}
			request, binding, grant := login("editor")
			if grant.Audience != s.audience || len(grant.Scopes) != 1 || grant.Scopes[0] != "identity:read" || grant.Identity.Generation < 1 {
				t.Fatal("identity grant widened")
			}
			fresh, status := s.VerifyBinding(ctx, binding, grant.Identity.Account)
			if status != 200 || fresh.Identity != grant.Identity {
				t.Fatal("resolve/current actor mismatch", status)
			}
			if _, status = s.VerifyBinding(ctx, binding, "wrong-account"); status != 401 {
				t.Fatal("foreign actor accepted")
			}
			view := httptest.NewRecorder()
			s.Account(view, request)
			if view.Code != 200 || !strings.Contains(view.Body.String(), `"privateWorkspaceAuthorized":false`) || strings.Contains(view.Body.String(), "grantToken") {
				t.Fatal("public account view leaked/widened identity")
			}
			mode("outage")
			view = httptest.NewRecorder()
			s.Account(view, request)
			if view.Code != 503 || len(view.Result().Cookies()) != 0 {
				t.Fatal("outage silently cleared identity")
			}
			mode("normal")
			var revoked map[string]any
			control("/__qa/generation", map[string]string{"clientId": s.clientID}, &revoked)
			if _, status = s.VerifyBinding(ctx, binding, grant.Identity.Account); status != 401 {
				t.Fatal("revoked Central generation survived", status)
			}
			request, binding, grant = login("https://attacker.invalid/return")
			for _, sample := range []struct{ origin, csrf string }{{s.origin, "wrong"}, {"https://attacker.invalid", grant.CSRF}} {
				r := httptest.NewRequest("POST", s.origin+"/api/sso/logout", nil)
				for _, c := range request.Cookies() {
					r.AddCookie(c)
				}
				r.Header.Set("Origin", sample.origin)
				r.Header.Set("X-YNX-SSO-CSRF", sample.csrf)
				w := httptest.NewRecorder()
				s.Logout(w, r)
				if w.Code != 403 {
					t.Fatal("logout CSRF/origin accepted")
				}
			}
			if _, status = s.VerifyBinding(ctx, binding, grant.Identity.Account); status != 200 {
				t.Fatal("rejected logout revoked identity")
			}
			r := httptest.NewRequest("POST", s.origin+"/api/sso/logout", nil)
			for _, c := range request.Cookies() {
				r.AddCookie(c)
			}
			r.Header.Set("Origin", s.origin)
			r.Header.Set("X-YNX-SSO-CSRF", grant.CSRF)
			w := httptest.NewRecorder()
			s.Logout(w, r)
			if w.Code != 200 {
				t.Fatal("confirmed revoke failed", w.Body.String())
			}
			if _, status = s.VerifyBinding(ctx, binding, grant.Identity.Account); status != 401 {
				t.Fatal("logout grant remained active")
			}
			// Redirect responses are not followed by the original production client.
			start := httptest.NewRecorder()
			s.Start(start, httptest.NewRequest("GET", s.origin+"/sso/start", nil))
			var a struct {
				RedirectURI string `json:"redirectUri"`
			}
			control("/__qa/approve", map[string]string{"url": start.Header().Get("Location")}, &a)
			returned := httptest.NewRequest("GET", a.RedirectURI, nil)
			returned.AddCookie(start.Result().Cookies()[0])
			mode("redirect")
			w = httptest.NewRecorder()
			s.Callback(w, returned)
			mode("normal")
			if w.Code != 503 {
				t.Fatal("backend redirect accepted/followed", w.Code)
			}
		})
	}
}

func TestBrowserSSOWorkspaceCookieAndConstructorBoundaries(t *testing.T) {
	key := []byte(strings.Repeat("k", 32))
	cloud, err := NewBrowserSSO("cloud", browserIssuer, key, []string{"home"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := cloud.seal(cloud.identityCookie, BrowserGrant{})
	if err != nil {
		t.Fatal(err)
	}
	for _, product := range []string{"docs", "calendar", "social", "finance"} {
		s, err := NewBrowserSSO(product, browserIssuer, key, []string{"home"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		var grant BrowserGrant
		if s.open(s.identityCookie, sealed, &grant) == nil {
			t.Fatal("Cloud cookie crossed product AES/AAD boundary")
		}
	}
	for _, product := range []string{"music", "card", "mail", "video", "creator-studio", "unknown"} {
		if _, err := NewBrowserSSO(product, browserIssuer, key, []string{"home"}, nil); err == nil {
			t.Fatal("unimplemented/unapproved constructor product admitted", product)
		}
	}
	for _, authority := range []string{"https://cloud.ynxweb4.com", "https://wallet-auth.ynxweb4.com/", "http://127.0.0.1:1"} {
		if _, err := NewBrowserSSO("cloud", authority, key, []string{"home"}, nil); err == nil {
			t.Fatal("authority relaxed")
		}
	}
	for _, target := range []string{"../escape", "https://attacker.invalid", "home?code=x", "home#x"} {
		if _, err := NewBrowserSSO("docs", browserIssuer, key, []string{target}, nil); err == nil {
			t.Fatal("redirect target relaxed")
		}
	}
}
