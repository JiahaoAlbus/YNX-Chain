package finance

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"
)

// This is a revocation association for an EXISTING scope-verified native
// ProductSession, not an alternate identity or a new permission grant.
type FinanceBrowserSSOBinding struct {
	Account     string    `json:"account"`
	GrantDigest string    `json:"grantDigest"`
	SealedGrant string    `json:"sealedGrant"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func browserSSOBindingKey(session Session) string {
	digest := sha256.Sum256([]byte(session.Verifier + "\x00" + session.ProductClient + "\x00" + session.SessionBinding))
	return hex.EncodeToString(digest[:])
}
func (s *Store) browserSSOBinding(key string) (FinanceBrowserSSOBinding, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return FinanceBrowserSSOBinding{}, false, err
	}
	value, exists := s.state.BrowserSSOBindings[key]
	return value, exists, nil
}
func (s *Store) bindBrowserSSO(key string, value FinanceBrowserSSOBinding, now time.Time) error {
	return s.updateAllState(value.Account, "browser_session.private_linked", key, func(state *persistedState) error {
		if state.BrowserSSOBindings == nil {
			state.BrowserSSOBindings = map[string]FinanceBrowserSSOBinding{}
		}
		for key, binding := range state.BrowserSSOBindings {
			if !binding.ExpiresAt.After(now) {
				delete(state.BrowserSSOBindings, key)
			}
		}
		if previous, exists := state.BrowserSSOBindings[key]; exists {
			if previous.Account != value.Account || previous.GrantDigest != value.GrantDigest || !previous.ExpiresAt.Equal(value.ExpiresAt) {
				return errors.New("private session is already browser-bound")
			}
			return nil
		}
		if len(state.BrowserSSOBindings) >= 10000 {
			return errors.New("browser binding capacity exceeded")
		}
		state.BrowserSSOBindings[key] = value
		return nil
	})
}
func (s *Server) authorizeBrowserSSOContext(r *http.Request, session Session) int {
	key := browserSSOBindingKey(session)
	binding, linked, err := s.service.Store.browserSSOBinding(key)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	if !s.cfg.CentralBrowserSSO {
		if linked {
			return http.StatusUnauthorized
		}
		return http.StatusOK
	}
	var local financeSSOGrant
	hasCookie := false
	for _, cookie := range r.Cookies() {
		if cookie.Name == financeSSOCookieName {
			hasCookie = true
		}
	}
	if !linked && !hasCookie {
		return http.StatusOK
	} // Existing native-only login is not silently upgraded to SSO.
	if linked {
		if binding.Account != session.Account || !binding.ExpiresAt.After(s.now()) {
			return http.StatusUnauthorized
		}
		copy := r.Clone(r.Context())
		copy.Header = r.Header.Clone()
		copy.Header.Set("Cookie", financeSSOCookieName+"="+binding.SealedGrant)
		if s.openSSOCookie(copy, financeSSOCookieName, &local) != nil {
			return http.StatusUnauthorized
		}
	} else if s.openSSOCookie(r, financeSSOCookieName, &local) != nil {
		return http.StatusUnauthorized
	}
	var fresh financeSSOGrant
	status := s.ssoCall(r.Context(), "/v2/browser-sessions/introspect", map[string]string{"grantToken": local.GrantToken, "clientId": financeSSOClient}, &fresh)
	if status != http.StatusOK {
		return status
	}
	if !validSSOGrant(fresh, s.now()) || fresh.Identity != local.Identity || fresh.Identity.Account != session.Account {
		return http.StatusUnauthorized
	}
	if hasCookie && linked {
		var current, currentFresh financeSSOGrant
		if s.openSSOCookie(r, financeSSOCookieName, &current) != nil {
			return http.StatusUnauthorized
		}
		status = s.ssoCall(r.Context(), "/v2/browser-sessions/introspect", map[string]string{"grantToken": current.GrantToken, "clientId": financeSSOClient}, &currentFresh)
		if status != http.StatusOK {
			return status
		}
		if !validSSOGrant(currentFresh, s.now()) || currentFresh.Identity != fresh.Identity {
			return http.StatusUnauthorized
		}
	}
	if !linked {
		sealed, err := s.sealSSOValue(financeSSOCookieName, local)
		if err != nil {
			return http.StatusServiceUnavailable
		}
		grantDigest := sha256.Sum256([]byte(local.GrantToken))
		if err = s.service.Store.bindBrowserSSO(key, FinanceBrowserSSOBinding{Account: session.Account, GrantDigest: hex.EncodeToString(grantDigest[:]), SealedGrant: sealed, ExpiresAt: session.ExpiresAt}, s.now()); err != nil {
			return http.StatusServiceUnavailable
		}
	}
	return http.StatusOK
}
