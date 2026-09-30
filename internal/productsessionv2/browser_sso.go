package productsessionv2

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const browserIssuer = "https://wallet-auth.ynxweb4.com"

// BrowserIdentity is an identity-only observation, never a private product
// permission or a substitute for Client.Authorize's fresh device proof.
type BrowserIdentity struct {
	Subject    string    `json:"subject"`
	Account    string    `json:"account"`
	Generation int64     `json:"generation"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
type BrowserGrant struct {
	GrantToken string          `json:"grantToken,omitempty"`
	Identity   BrowserIdentity `json:"identity"`
	Audience   string          `json:"audience"`
	Scopes     []string        `json:"scopes"`
	ExpiresAt  time.Time       `json:"expiresAt"`
	CSRF       string          `json:"csrf,omitempty"`
}
type browserPending struct {
	State     string    `json:"state"`
	Verifier  string    `json:"verifier"`
	Target    string    `json:"target"`
	ExpiresAt time.Time `json:"expiresAt"`
	Silent    bool      `json:"silent,omitempty"`
}
type BrowserSSO struct {
	product, origin, clientID, audience, authority, identityCookie, pendingCookie string
	aead                                                                          cipher.AEAD
	client                                                                        *http.Client
	targets                                                                       map[string]bool
	defaultTarget                                                                 string
	now                                                                           func() time.Time
}

// NewBrowserSSO has a fixed first-batch registry. Callers cannot supply a new
// origin, audience, scope or issuer, and must opt in at their existing server.
func NewBrowserSSO(product, authority string, cookieKey []byte, targets []string, transport http.RoundTripper) (*BrowserSSO, error) {
	origin := map[string]string{"finance": "https://finance.ynxweb4.com", "exchange": "https://exchange.ynxweb4.com", "quant": "https://quant.ynxweb4.com"}[product]
	if origin == "" || len(cookieKey) < 32 || len(targets) == 0 {
		return nil, errors.New("browser SSO policy invalid")
	}
	u, err := url.Parse(authority)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || authority != browserIssuer {
		return nil, errors.New("browser SSO authority invalid")
	}
	domain := "YNX product browser SSO cookie v1\x00" + product + "\x00"
	if product == "finance" {
		domain = "YNX Finance SSO cookie v1\x00"
	} // Preserve deployed Finance cookie and durable binding encryption.
	key := sha256.Sum256(append([]byte(domain), cookieKey...))
	block, _ := aes.NewCipher(key[:])
	aead, _ := cipher.NewGCM(block)
	s := &BrowserSSO{product: product, origin: origin, clientID: "ynx-" + product + "-v1-sso-v1", audience: "ynx:" + product + ":identity", authority: authority, identityCookie: "__Host-ynx-" + product + "-identity", pendingCookie: "__Host-ynx-" + product + "-signin", aead: aead, client: &http.Client{Timeout: 5 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, targets: map[string]bool{}, now: time.Now}
	for _, target := range targets {
		if target == "" || strings.ContainsAny(target, "/?#\\\r\n") || len(target) > 64 {
			return nil, errors.New("browser SSO target invalid")
		}
		s.targets[target] = true
	}
	s.defaultTarget = targets[0]
	return s, nil
}
func browserRandom() (string, error) {
	raw := make([]byte, 32)
	_, err := rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw), err
}
func (s *BrowserSSO) target(value string) string {
	if s.targets[value] {
		return value
	}
	return s.defaultTarget
}
func (s *BrowserSSO) seal(name string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(s.aead.Seal(nonce, nonce, raw, []byte(name+"\x00"+s.origin))), nil
}
func (s *BrowserSSO) open(name, encoded string, value any) error {
	if len(encoded) > 4096 {
		return errors.New("browser SSO cookie invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(raw) < s.aead.NonceSize() {
		return errors.New("browser SSO cookie invalid")
	}
	plain, err := s.aead.Open(nil, raw[:s.aead.NonceSize()], raw[s.aead.NonceSize():], []byte(name+"\x00"+s.origin))
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(plain))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("browser SSO cookie invalid")
	}
	return nil
}
func (s *BrowserSSO) cookie(r *http.Request, name string, value any) error {
	var selected *http.Cookie
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			if selected != nil {
				return errors.New("duplicate browser SSO cookie")
			}
			selected = cookie
		}
	}
	if selected == nil {
		return errors.New("browser SSO cookie unavailable")
	}
	return s.open(name, selected.Value, value)
}
func (s *BrowserSSO) set(w http.ResponseWriter, name string, value any, expires time.Time) error {
	encoded, err := s.seal(name, value)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: encoded, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: int(expires.Sub(s.now()).Seconds())})
	return nil
}
func clearBrowserCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}
func browserResponse(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func (s *BrowserSSO) call(ctx context.Context, path string, input, out any) int {
	raw, err := json.Marshal(input)
	if err != nil {
		return 503
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, "POST", s.authority+"/v2/browser-sessions/"+path, bytes.NewReader(raw))
	if err != nil {
		return 503
	}
	r.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(r)
	if err != nil {
		return 503
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode == 401 || response.StatusCode == 403 || response.StatusCode == 400 {
			return response.StatusCode
		}
		return 503
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		return 503
	}
	raw, err = io.ReadAll(io.LimitReader(response.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return 503
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil {
		return 503
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return 503
	}
	return 200
}
func (s *BrowserSSO) valid(grant BrowserGrant) bool {
	_, err := accountaddress.Decode(grant.Identity.Subject)
	return err == nil && strings.ToLower(grant.Identity.Subject) == grant.Identity.Subject && grant.Identity.Account == grant.Identity.Subject && grant.Identity.Generation > 0 && grant.Identity.ExpiresAt.After(s.now()) && grant.ExpiresAt.After(s.now()) && grant.Audience == s.audience && len(grant.Scopes) == 1 && grant.Scopes[0] == "identity:read"
}

func (s *BrowserSSO) Start(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	prompt := r.URL.Query().Get("prompt")
	if prompt != "" && prompt != "none" {
		browserResponse(w, 400, map[string]string{"code": "SSO_REQUEST_REJECTED"})
		return
	}
	silent := prompt == "none"
	if silent && !s.SilentAllowed(r) {
		http.Redirect(w, r, "/#"+s.target(r.URL.Query().Get("target")), 303)
		return
	}
	if !silent {
		for _, cookie := range r.Cookies() {
			if cookie.Name == s.identityCookie+"-signedout" || cookie.Name == s.identityCookie+"-attempt" {
				clearBrowserCookie(w, cookie.Name)
			}
		}
	}
	var pending browserPending
	if s.cookie(r, s.pendingCookie, &pending) != nil || !pending.ExpiresAt.After(s.now()) || pending.Silent != silent {
		state, err := browserRandom()
		if err != nil {
			browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		verifier, err := browserRandom()
		if err != nil {
			browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		pending = browserPending{State: state, Verifier: verifier, Target: s.target(r.URL.Query().Get("target")), ExpiresAt: s.now().Add(2 * time.Minute), Silent: silent}
		// Retain only the sealed original target/state briefly after the two
		// minute authorization deadline, so an explicit denial can return safely.
		// Expired pending transactions can never redeem an authorization code.
		if s.set(w, s.pendingCookie, pending, pending.ExpiresAt.Add(8*time.Minute)) != nil {
			browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
	}
	hash := sha256.Sum256([]byte(pending.Verifier))
	query := url.Values{"clientId": {s.clientID}, "origin": {s.origin}, "redirectUri": {s.origin + "/sso/callback"}, "state": {pending.State}, "codeChallenge": {base64.RawURLEncoding.EncodeToString(hash[:])}, "codeChallengeMethod": {"S256"}}
	if silent {
		if s.set(w, s.identityCookie+"-attempt", true, s.now().Add(time.Minute)) != nil {
			browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		query.Set("prompt", "none")
	}
	http.Redirect(w, r, browserIssuer+"/v2/browser-sessions/authorize?"+query.Encode(), 303)
}
func (s *BrowserSSO) Callback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	var pending browserPending
	query := r.URL.Query()
	if s.cookie(r, s.pendingCookie, &pending) != nil || !pending.ExpiresAt.Add(8*time.Minute).After(s.now()) || len(query) != 2 || len(query["state"]) != 1 || subtle.ConstantTimeCompare([]byte(pending.State), []byte(query.Get("state"))) != 1 {
		browserResponse(w, 400, map[string]string{"code": "SSO_CALLBACK_REJECTED"})
		return
	}
	if len(query["error"]) == 1 && (query.Get("error") == "access_denied" || pending.Silent && query.Get("error") == "login_required") {
		clearBrowserCookie(w, s.pendingCookie)
		http.Redirect(w, r, "/#"+s.target(pending.Target), 303)
		return
	}
	if !pending.ExpiresAt.After(s.now()) || len(query["code"]) != 1 {
		browserResponse(w, 400, map[string]string{"code": "SSO_CALLBACK_REJECTED"})
		return
	}
	var grant BrowserGrant
	status := s.call(r.Context(), "token", map[string]string{"clientId": s.clientID, "origin": s.origin, "redirectUri": s.origin + "/sso/callback", "state": pending.State, "codeVerifier": pending.Verifier, "code": query.Get("code")}, &grant)
	if status != 200 || !s.valid(grant) {
		if status == 200 {
			status = 401
		}
		browserResponse(w, status, map[string]string{"code": "SSO_CALLBACK_UNAVAILABLE"})
		return
	}
	grant.CSRF, _ = browserRandom()
	if grant.CSRF == "" || s.set(w, s.identityCookie, grant, grant.ExpiresAt) != nil {
		browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
		return
	}
	clearBrowserCookie(w, s.pendingCookie)
	http.Redirect(w, r, "/#"+s.target(pending.Target), 303)
}

// VerifyBinding is for the product's existing durable session association. The
// returned sealed credential must remain backend-only, never JSON to a client.
func (s *BrowserSSO) Binding(r *http.Request) (string, BrowserGrant, error) {
	var grant BrowserGrant
	if err := s.cookie(r, s.identityCookie, &grant); err != nil || !s.valid(grant) {
		return "", BrowserGrant{}, errors.New("browser SSO identity unavailable")
	}
	encoded, err := s.seal(s.identityCookie, grant)
	return encoded, grant, err
}
func (s *BrowserSSO) VerifyBinding(ctx context.Context, encoded, account string) (BrowserGrant, int) {
	var local BrowserGrant
	if s.open(s.identityCookie, encoded, &local) != nil || !s.valid(local) || local.Identity.Account != account {
		return BrowserGrant{}, 401
	}
	var fresh BrowserGrant
	status := s.call(ctx, "introspect", map[string]string{"clientId": s.clientID, "grantToken": local.GrantToken}, &fresh)
	if status != 200 {
		return BrowserGrant{}, status
	}
	if !s.valid(fresh) || fresh.Identity != local.Identity {
		return BrowserGrant{}, 401
	}
	return fresh, 200
}
func (s *BrowserSSO) Account(w http.ResponseWriter, r *http.Request) {
	binding, local, err := s.Binding(r)
	if err != nil {
		browserResponse(w, 401, map[string]string{"code": "SSO_LOGIN_REQUIRED"})
		return
	}
	fresh, status := s.VerifyBinding(r.Context(), binding, local.Identity.Account)
	if status != 200 {
		if status == 401 || status == 403 {
			clearBrowserCookie(w, s.identityCookie)
		}
		browserResponse(w, status, map[string]string{"code": "SSO_RECHECK_UNAVAILABLE"})
		return
	}
	browserResponse(w, 200, map[string]any{"signedIn": true, "account": fresh.Identity.Account, "subject": fresh.Identity.Subject, "generation": fresh.Identity.Generation, "expiresAt": fresh.ExpiresAt, "scopes": fresh.Scopes, "csrfToken": local.CSRF, "privateWorkspaceAuthorized": false})
}
func (s *BrowserSSO) Logout(w http.ResponseWriter, r *http.Request) {
	var local BrowserGrant
	if r.Header.Get("Origin") != s.origin || s.cookie(r, s.identityCookie, &local) != nil || subtle.ConstantTimeCompare([]byte(local.CSRF), []byte(r.Header.Get("X-YNX-SSO-CSRF"))) != 1 {
		browserResponse(w, 403, map[string]string{"code": "SSO_CSRF_REJECTED"})
		return
	}
	clearBrowserCookie(w, s.pendingCookie)
	var result struct {
		Revoked bool `json:"revoked"`
	}
	if s.call(r.Context(), "logout-grant", map[string]string{"clientId": s.clientID, "grantToken": local.GrantToken}, &result) != 200 || !result.Revoked {
		browserResponse(w, 503, map[string]string{"code": "SSO_REVOKE_UNCONFIRMED"})
		return
	}
	clearBrowserCookie(w, s.identityCookie)
	if s.set(w, s.identityCookie+"-signedout", true, s.now().Add(30*24*time.Hour)) != nil {
		browserResponse(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
		return
	}
	browserResponse(w, 200, map[string]bool{"revoked": true})
}

// These host-only HttpOnly markers carry no identity or permission. Presence
// (including malformed/duplicate cookies) fails closed for automatic restore.
func (s *BrowserSSO) SilentAllowed(r *http.Request) bool {
	for _, cookie := range r.Cookies() {
		if cookie.Name == s.identityCookie+"-signedout" || cookie.Name == s.identityCookie+"-attempt" {
			return false
		}
	}
	return true
}
