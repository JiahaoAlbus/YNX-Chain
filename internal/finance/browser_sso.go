package finance

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
	"github.com/JiahaoAlbus/YNX-Chain/internal/centralbrowserfamily"
)

const financeSSOClient = "ynx-finance-v1-sso-v1"
const financeSSOAudience = "ynx:finance:identity"
const financeSSOCookieName = "__Host-ynx-finance-identity"
const financeSSOPendingName = "__Host-ynx-finance-signin"

type financeSSOPending struct {
	State     string    `json:"state"`
	IntentID  string    `json:"intentId,omitempty"`
	Verifier  string    `json:"verifier"`
	Target    string    `json:"target"`
	ExpiresAt time.Time `json:"expiresAt"`
	Silent    bool      `json:"silent,omitempty"`
}
type financeSSOIdentity struct {
	Subject    string    `json:"subject"`
	Account    string    `json:"account"`
	Generation int64     `json:"generation"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
type financeSSOFamilyReference struct {
	FamilyID string `json:"familyId"`
	CSRF     string `json:"csrf"`
}
type financeSSOGrant struct {
	RevocationPending bool               `json:"-"`
	FamilyID          string             `json:"-"`
	AbsoluteExpiresAt time.Time          `json:"-"`
	GrantToken        string             `json:"grantToken,omitempty"`
	Identity          financeSSOIdentity `json:"identity"`
	Audience          string             `json:"audience"`
	Scopes            []string           `json:"scopes"`
	ExpiresAt         time.Time          `json:"expiresAt"`
	CSRF              string             `json:"csrf,omitempty"`
}

func (s *Server) ssoAvailable() bool {
	if !s.cfg.CentralBrowserSSO {
		return false
	}
	u, err := url.Parse(s.cfg.WalletGatewayURL)
	return err == nil && (u.String() == BrowserWalletAuthority || u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))
}
func ssoRandom() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}
func (s *Server) ssoAEAD() (cipher.AEAD, error) {
	// Domain-separated use of the existing private Finance cursor key. Never
	// expose a grant or PKCE verifier in JavaScript storage, URL, or plaintext.
	key := sha256.Sum256([]byte("YNX Finance SSO cookie v1\x00" + s.cfg.CursorSigningKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (s *Server) sealSSOCookie(w http.ResponseWriter, name string, value any, expires time.Time) error {
	encoded, err := s.sealSSOValue(name, value)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: encoded, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: int(expires.Sub(s.now()).Seconds())})
	return nil
}
func (s *Server) sealSSOValue(name string, value any) (string, error) {
	aead, err := s.ssoAEAD()
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, raw, []byte(name+"\x00"+BrowserFinanceOrigin))
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}
func (s *Server) openSSOCookie(r *http.Request, name string, value any) error {
	var selected *http.Cookie
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			if selected != nil {
				return errors.New("duplicate SSO cookie")
			}
			selected = cookie
		}
	}
	if selected == nil || len(selected.Value) > 4096 {
		return errors.New("SSO cookie unavailable")
	}
	raw, err := base64.RawURLEncoding.DecodeString(selected.Value)
	if err != nil {
		return err
	}
	aead, err := s.ssoAEAD()
	if err != nil || len(raw) < aead.NonceSize() {
		return errors.New("SSO cookie invalid")
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], []byte(name+"\x00"+BrowserFinanceOrigin))
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(plain))
	decoder.DisallowUnknownFields()
	return decoder.Decode(value)
}
func clearSSOCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}
func ssoTarget(value string) string {
	for _, target := range []string{"overview", "assets", "activity", "planning", "statements", "assistant", "settings", "support", "strategies"} {
		if value == target {
			return target
		}
	}
	return "overview"
}
func (s *Server) ssoStart(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if !s.ssoAvailable() {
		writeJSON(w, 503, map[string]string{"code": "SSO_NOT_CONFIGURED"})
		return
	}
	// Reuse the same bounded browser pending transaction across repeat clicks.
	prompt := r.URL.Query().Get("prompt")
	if prompt != "" && prompt != "none" {
		writeJSON(w, 400, map[string]string{"code": "SSO_REQUEST_REJECTED"})
		return
	}
	silent := prompt == "none"
	if silent && !s.ssoSilentAllowed(r) {
		http.Redirect(w, r, "/#"+ssoTarget(r.URL.Query().Get("target")), 303)
		return
	}
	if !silent {
		for _, cookie := range r.Cookies() {
			if cookie.Name == financeSSOCookieName+"-signedout" || cookie.Name == financeSSOCookieName+"-attempt" {
				clearSSOCookie(w, cookie.Name)
			}
		}
	}
	var pending financeSSOPending
	if s.openSSOCookie(r, financeSSOPendingName, &pending) != nil || !pending.ExpiresAt.After(s.now()) || pending.Silent != silent || s.cfg.CentralBrowserFamily != nil && pending.IntentID == "" {
		state, err := ssoRandom()
		if err != nil {
			writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		verifier, err := ssoRandom()
		if err != nil {
			writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		pending = financeSSOPending{State: state, Verifier: verifier, Target: ssoTarget(r.URL.Query().Get("target")), ExpiresAt: s.now().Add(2 * time.Minute), Silent: silent}
		if s.cfg.CentralBrowserFamily != nil {
			var previous financeSSOFamilyReference
			_ = s.openSSOCookie(r, financeSSOCookieName, &previous)
			if previous.FamilyID != "" {
				_, status := s.ssoCookieGrant(r)
				if status == 401 || status == 403 {
					previous.FamilyID = ""
					clearSSOCookie(w, financeSSOCookieName)
					if silent {
						if s.sealSSOCookie(w, financeSSOCookieName+"-signedout", true, s.now().Add(30*24*time.Hour)) != nil {
							writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
							return
						}
						http.Redirect(w, r, "/#"+pending.Target, http.StatusSeeOther)
						return
					}
				} else if status != 200 {
					writeJSON(w, 503, map[string]string{"code": "SSO_RECHECK_UNAVAILABLE"})
					return
				}
			}
			intent, err := s.cfg.CentralBrowserFamily.Prepare(r.Context(), centralbrowserfamily.PrepareInput{State: state, PreviousFamilyID: previous.FamilyID})
			if err != nil || len(intent) != 43 {
				writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
				return
			}
			pending.IntentID = intent
		}
		// Target-only denial recovery outlives authorization, never code redemption.
		if err := s.sealSSOCookie(w, financeSSOPendingName, pending, pending.ExpiresAt.Add(8*time.Minute)); err != nil {
			writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
	}
	hash := sha256.Sum256([]byte(pending.Verifier))
	parameters := url.Values{"clientId": {financeSSOClient}, "origin": {BrowserFinanceOrigin}, "redirectUri": {BrowserFinanceOrigin + "/sso/callback"}, "state": {pending.State}, "codeChallenge": {base64.RawURLEncoding.EncodeToString(hash[:])}, "codeChallengeMethod": {"S256"}}
	if silent {
		if s.sealSSOCookie(w, financeSSOCookieName+"-attempt", true, s.now().Add(time.Minute)) != nil {
			writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
			return
		}
		parameters.Set("prompt", "none")
	}
	// Browser navigates the sole registered public issuer, not a test/proxy URL.
	destination := BrowserWalletAuthority + "/v2/browser-sessions/authorize?" + parameters.Encode()
	// Display preference only: never add locale to the exact signed initiator,
	// PKCE/state, callback destination or browser identity permissions.
	switch r.URL.Query().Get("lang") {
	case "en", "zh-CN", "zh-Hant":
		destination += "#lang=" + r.URL.Query().Get("lang")
	}
	http.Redirect(w, r, destination, http.StatusSeeOther)
}
func (s *Server) ssoCall(ctx context.Context, path string, input any, out any) int {
	if !s.ssoAvailable() {
		return 503
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return 503
	}
	// Canonical object key ordering matches the shared HTTP protocol.
	var canonical any
	if json.Unmarshal(raw, &canonical) != nil {
		return 503
	}
	raw, err = json.Marshal(canonical)
	if err != nil {
		return 503
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(s.cfg.WalletGatewayURL, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return 503
	}
	request.Header.Set("Content-Type", "application/json")
	client := s.cfg.WalletGatewayClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	boundedClient := *client
	boundedClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := boundedClient.Do(request)
	if err != nil {
		return 503
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		if response.StatusCode == 401 || response.StatusCode == 403 {
			return response.StatusCode
		}
		return 503
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		return 503
	}
	encoded, err := io.ReadAll(io.LimitReader(response.Body, 16385))
	if err != nil || len(encoded) > 16384 {
		return 503
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(out); err != nil {
		return 503
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return 503
	}
	return 200
}
func validSSOGrant(grant financeSSOGrant, now time.Time) bool {
	_, err := accountaddress.Decode(grant.Identity.Subject)
	return err == nil && strings.ToLower(grant.Identity.Subject) == grant.Identity.Subject && grant.Identity.Account == grant.Identity.Subject && grant.Identity.Generation > 0 && grant.Identity.ExpiresAt.After(now) && grant.ExpiresAt.After(now) && grant.Audience == financeSSOAudience && len(grant.Scopes) == 1 && grant.Scopes[0] == "identity:read"
}
func (s *Server) ssoCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	var pending financeSSOPending
	if !s.ssoAvailable() || s.openSSOCookie(r, financeSSOPendingName, &pending) != nil || !pending.ExpiresAt.Add(8*time.Minute).After(s.now()) || len(r.URL.Query()) != 2 || len(r.URL.Query()["state"]) != 1 || subtle.ConstantTimeCompare([]byte(pending.State), []byte(r.URL.Query().Get("state"))) != 1 {
		writeJSON(w, 400, map[string]string{"code": "SSO_CALLBACK_REJECTED"})
		return
	}
	if len(r.URL.Query()["error"]) == 1 && (r.URL.Query().Get("error") == "access_denied" || pending.Silent && r.URL.Query().Get("error") == "login_required") {
		clearSSOCookie(w, financeSSOPendingName)
		http.Redirect(w, r, "/#"+ssoTarget(pending.Target), http.StatusSeeOther)
		return
	}
	if !pending.ExpiresAt.After(s.now()) || len(r.URL.Query()["code"]) != 1 {
		writeJSON(w, 400, map[string]string{"code": "SSO_CALLBACK_REJECTED"})
		return
	}
	var result financeSSOGrant
	status := 200
	if s.cfg.CentralBrowserFamily != nil {
		grant, err := s.cfg.CentralBrowserFamily.Redeem(r.Context(), centralbrowserfamily.PKCEInput{Code: r.URL.Query().Get("code"), State: pending.State, CodeVerifier: pending.Verifier, IntentID: pending.IntentID})
		status = familySSOStatus(err)
		if status == 200 {
			if !validFinanceFamilyGrant(grant, s.now()) {
				status = 503
			} else {
				result = financeFamilyGrant(grant)
			}
		}
	} else {
		status = s.ssoCall(r.Context(), "/v2/browser-sessions/token", map[string]string{"clientId": financeSSOClient, "origin": BrowserFinanceOrigin, "redirectUri": BrowserFinanceOrigin + "/sso/callback", "state": pending.State, "codeVerifier": pending.Verifier, "code": r.URL.Query().Get("code")}, &result)
	}
	if status != 200 || !validSSOGrant(result, s.now()) || len(result.GrantToken) != 43 {
		writeJSON(w, 503, map[string]string{"code": "SSO_CALLBACK_UNAVAILABLE"})
		return
	}
	csrf, err := ssoRandom()
	if err != nil {
		writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
		return
	}
	result.CSRF = csrf
	var cookieValue any = result
	cookieExpires := result.ExpiresAt
	if result.FamilyID != "" {
		cookieValue = financeSSOFamilyReference{FamilyID: result.FamilyID, CSRF: csrf}
		cookieExpires = result.AbsoluteExpiresAt
	}
	if err = s.sealSSOCookie(w, financeSSOCookieName, cookieValue, cookieExpires); err != nil {
		writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
		return
	}
	clearSSOCookie(w, financeSSOPendingName)
	http.Redirect(w, r, "/#"+ssoTarget(pending.Target), http.StatusSeeOther)
}
func (s *Server) ssoAccount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	local, status := s.ssoCookieGrant(r)
	var result financeSSOGrant
	if status != 200 {
		blockedSilent := false
		if status == 401 || status == 403 {
			clearSSOCookie(w, financeSSOCookieName)
			if s.cfg.CentralBrowserFamily != nil {
				for _, cookie := range r.Cookies() {
					if cookie.Name == financeSSOCookieName {
						blockedSilent = true
					}
				}
				if blockedSilent && s.sealSSOCookie(w, financeSSOCookieName+"-signedout", true, s.now().Add(30*24*time.Hour)) != nil {
					writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
					return
				}
			}
		}
		if local.RevocationPending {
			writeJSON(w, 503, map[string]any{"code": "SSO_REVOKE_UNCONFIRMED", "revocationPending": true, "csrfToken": local.CSRF})
			return
		}
		writeJSON(w, status, map[string]any{"code": "SSO_LOGIN_REQUIRED", "silentRestoreAllowed": !blockedSilent && s.ssoSilentAllowed(r)})
		return
	}
	if local.FamilyID != "" {
		result = local
	} else {
		status = s.ssoCall(r.Context(), "/v2/browser-sessions/introspect", map[string]string{"grantToken": local.GrantToken, "clientId": financeSSOClient}, &result)
	}
	if status != 200 {
		if status == 401 || status == 403 {
			clearSSOCookie(w, financeSSOCookieName)
		}
		writeJSON(w, status, map[string]string{"code": "SSO_RECHECK_UNAVAILABLE"})
		return
	}
	if !validSSOGrant(result, s.now()) || result.Identity != local.Identity {
		clearSSOCookie(w, financeSSOCookieName)
		writeJSON(w, 401, map[string]string{"code": "SSO_IDENTITY_CHANGED"})
		return
	}
	// Finance already keys its owned AccountState by this verified native
	// subject. Do not merge the separate EVM-subject namespace or return private
	// budgets/portfolio under an identity-only central grant.
	writeJSON(w, 200, map[string]any{"signedIn": true, "account": result.Identity.Account, "subject": result.Identity.Subject, "generation": result.Identity.Generation, "expiresAt": result.ExpiresAt, "csrfToken": local.CSRF, "scopes": result.Scopes, "privateWorkspaceAuthorized": false, "serverNow": s.now()})
}
func (s *Server) ssoLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var local financeSSOGrant
	var family financeSSOFamilyReference
	familyCookie := s.openSSOCookie(r, financeSSOCookieName, &family) == nil && family.FamilyID != ""
	if familyCookie {
		local.CSRF = family.CSRF
	} else if s.openSSOCookie(r, financeSSOCookieName, &local) != nil {
		local.CSRF = ""
	}
	if r.Header.Get("Origin") != BrowserFinanceOrigin || len(local.CSRF) != 43 || subtle.ConstantTimeCompare([]byte(local.CSRF), []byte(r.Header.Get("X-YNX-SSO-CSRF"))) != 1 {
		writeJSON(w, 403, map[string]string{"code": "SSO_CSRF_REJECTED"})
		return
	}
	var result struct {
		Revoked bool `json:"revoked"`
	}
	// A product logout cancels its pending callback too, including another tab.
	// Backend atomic code invalidation fences already in-flight redemption.
	clearSSOCookie(w, financeSSOPendingName)
	var pending financeSSOPending
	logoutIntent := ""
	if s.openSSOCookie(r, financeSSOPendingName, &pending) == nil && pending.ExpiresAt.After(s.now()) {
		logoutIntent = pending.IntentID
	}
	status := 503
	if familyCookie {
		if s.cfg.CentralBrowserFamily != nil {
			status = familySSOStatus(s.cfg.CentralBrowserFamily.Logout(r.Context(), centralbrowserfamily.LogoutInput{FamilyID: family.FamilyID, IntentID: logoutIntent}))
			result.Revoked = status == 200
		}
	} else {
		status = s.ssoCall(r.Context(), "/v2/browser-sessions/logout-grant", map[string]string{"grantToken": local.GrantToken, "clientId": financeSSOClient}, &result)
	}
	// Keep the encrypted bounded revocation target on uncertain network results;
	// UI may hide local data, but this endpoint never claims an unverified revoke.
	if status != 200 || !result.Revoked {
		writeJSON(w, 503, map[string]string{"code": "SSO_REVOKE_UNCONFIRMED"})
		return
	}
	clearSSOCookie(w, financeSSOCookieName)
	if s.sealSSOCookie(w, financeSSOCookieName+"-signedout", true, s.now().Add(30*24*time.Hour)) != nil {
		writeJSON(w, 503, map[string]string{"code": "SSO_UNAVAILABLE"})
		return
	}
	writeJSON(w, 200, map[string]bool{"revoked": true})
}

func (s *Server) ssoSilentAllowed(r *http.Request) bool {
	for _, cookie := range r.Cookies() {
		if cookie.Name == financeSSOCookieName+"-signedout" || cookie.Name == financeSSOCookieName+"-attempt" {
			return false
		}
	}
	return true
}

func familySSOStatus(err error) int {
	if err == nil {
		return http.StatusOK
	}
	var typed *centralbrowserfamily.Error
	if errors.As(err, &typed) {
		if typed.RevocationPending {
			return http.StatusServiceUnavailable
		}
		switch typed.Code {
		case "SSO_GRANT_INVALID", "SSO_FAMILY_INVALID", "SSO_GENERATION_REVOKED", "SSO_FAMILY_REPLAY", centralbrowserfamily.CodeFenced, centralbrowserfamily.CodeBinding, "SSO_LOGIN_REQUIRED", "SSO_SESSION_EXPIRED", "SSO_FAMILY_EXPIRED", "SSO_FAMILY_REVOKED", "SSO_IDENTITY_CHANGED", "SSO_CONSENT_REQUIRED":
			return http.StatusUnauthorized
		case "SSO_CLIENT_REJECTED", "SSO_SCOPE_REJECTED":
			return http.StatusForbidden
		}
	}
	return http.StatusServiceUnavailable
}
func financeFamilyGrant(g centralbrowserfamily.Grant) financeSSOGrant {
	return financeSSOGrant{FamilyID: g.FamilyID, AbsoluteExpiresAt: g.AbsoluteExpiresAt, GrantToken: g.GrantToken, Identity: financeSSOIdentity{Subject: g.Identity.Subject, Account: g.Identity.Account, Generation: g.Identity.Generation, ExpiresAt: g.Identity.ExpiresAt}, Audience: g.Audience, Scopes: g.Scopes, ExpiresAt: g.ExpiresAt}
}
func (s *Server) ssoCookieGrant(r *http.Request) (financeSSOGrant, int) {
	if !s.ssoAvailable() {
		return financeSSOGrant{}, 401
	}
	var reference financeSSOFamilyReference
	if s.openSSOCookie(r, financeSSOCookieName, &reference) == nil {
		if s.cfg.CentralBrowserFamily == nil || len(reference.FamilyID) != 43 || len(reference.CSRF) != 43 {
			return financeSSOGrant{}, 401
		}
		verified, err := s.cfg.CentralBrowserFamily.Resolve(r.Context(), reference.FamilyID)
		if status := familySSOStatus(err); status != 200 {
			var typed *centralbrowserfamily.Error
			if errors.As(err, &typed) && typed.LocallyFenced && typed.RevocationPending {
				return financeSSOGrant{FamilyID: reference.FamilyID, CSRF: reference.CSRF, RevocationPending: true}, status
			}
			return financeSSOGrant{}, status
		}
		grant := financeFamilyGrant(verified)
		grant.CSRF = reference.CSRF
		if grant.FamilyID != reference.FamilyID || !validFinanceFamilyGrant(verified, s.now()) {
			return financeSSOGrant{}, 401
		}
		return grant, 200
	}
	var grant financeSSOGrant
	if s.openSSOCookie(r, financeSSOCookieName, &grant) != nil || !validSSOGrant(grant, s.now()) {
		return grant, 401
	}
	return grant, 200
}
func (s *Server) ssoActivity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var reference financeSSOFamilyReference
	if !s.ssoAvailable() || s.cfg.CentralBrowserFamily == nil || r.Header.Get("Origin") != BrowserFinanceOrigin || s.openSSOCookie(r, financeSSOCookieName, &reference) != nil || len(reference.FamilyID) != 43 || len(reference.CSRF) != 43 || subtle.ConstantTimeCompare([]byte(reference.CSRF), []byte(r.Header.Get("X-YNX-SSO-CSRF"))) != 1 {
		writeJSON(w, 403, map[string]string{"code": "SSO_CSRF_REJECTED"})
		return
	}
	var input struct {
		EventID    string    `json:"eventId"`
		Action     string    `json:"action"`
		ObservedAt time.Time `json:"observedAt"`
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1025))
	if err != nil || len(raw) > 1024 {
		writeJSON(w, 400, map[string]string{"code": "SSO_ACTIVITY_REJECTED"})
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || len(input.EventID) != 43 || (input.Action != "navigate" && input.Action != "save") || input.ObservedAt.After(s.now()) || s.now().Sub(input.ObservedAt) > 30*time.Second {
		writeJSON(w, 400, map[string]string{"code": "SSO_ACTIVITY_REJECTED"})
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		writeJSON(w, 400, map[string]string{"code": "SSO_ACTIVITY_REJECTED"})
		return
	}
	if _, err := base64.RawURLEncoding.DecodeString(input.EventID); err != nil {
		writeJSON(w, 400, map[string]string{"code": "SSO_ACTIVITY_REJECTED"})
		return
	}
	// This local bound supplements Central's durable idempotency/rate checks.
	now := s.now()
	key := "sso.activity." + reference.FamilyID
	s.rateMu.Lock()
	if s.rate == nil {
		s.rate = map[string][]time.Time{}
	}
	recent := s.rate[key][:0]
	for _, at := range s.rate[key] {
		if now.Sub(at) < 30*time.Second {
			recent = append(recent, at)
		}
	}
	if len(recent) >= 12 {
		s.rate[key] = recent
		s.rateMu.Unlock()
		writeJSON(w, 429, map[string]string{"code": "SSO_ACTIVITY_LIMIT"})
		return
	}
	s.rate[key] = append(recent, now)
	s.rateMu.Unlock()
	status := familySSOStatus(s.cfg.CentralBrowserFamily.Activity(r.Context(), reference.FamilyID, input.EventID, input.ObservedAt))
	writeJSON(w, status, map[string]bool{"accepted": status == 200})
}

func validFinanceFamilyGrant(g centralbrowserfamily.Grant, now time.Time) bool {
	return validSSOGrant(financeFamilyGrant(g), now) && len(g.FamilyID) == 43 && len(g.GrantToken) == 43 && g.AbsoluteExpiresAt.After(now) && g.IdleExpiresAt.After(now) && !g.IdleExpiresAt.After(g.AbsoluteExpiresAt) && !g.ExpiresAt.After(g.AbsoluteExpiresAt) && !g.ExpiresAt.After(g.IdleExpiresAt) && g.ApprovedProfile != "" && len(g.ApprovedClientsDigest) == 64
}
