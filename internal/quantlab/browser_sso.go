package quantlab

import (
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// This optional association is not a tenant credential or Paper permission.
type browserSSOBinding struct {
	Account     string    `json:"account"`
	GrantDigest string    `json:"grantDigest"`
	SealedGrant string    `json:"sealedGrant"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func (s *Server) authorizeBrowserSSO(r *http.Request, session productsessionv2.Session) int {
	root := s.service.cfg.browserBindings
	if root == nil {
		root = s.service
	}
	key := hashBytes([]byte(session.SessionBinding))
	root.mu.Lock()
	release, err := root.lockAndReload()
	if err != nil {
		root.mu.Unlock()
		return 503
	}
	stored, linked := root.state.BrowserSSOBindings[key]
	release()
	root.mu.Unlock()
	bridge := s.service.cfg.BrowserSSO
	if bridge == nil {
		if linked {
			return 401
		}
		return 200
	}
	sealed, grant, err := bridge.Binding(r)
	if err != nil {
		for _, cookie := range r.Cookies() {
			if cookie.Name == "__Host-ynx-quant-identity" {
				return 401
			}
		}
	}
	if linked {
		if stored.Account != session.Account || !stored.ExpiresAt.After(root.cfg.Now()) {
			return 401
		}
		if err == nil && (grant.Identity.Account != stored.Account || hashBytes([]byte(grant.GrantToken)) != stored.GrantDigest) {
			return 401
		}
		_, status := bridge.VerifyBinding(r.Context(), stored.SealedGrant, session.Account)
		return status
	}
	if err != nil {
		return 200
	} // Original independent approved native session.
	if grant.Identity.Account != session.Account {
		return 401
	}
	if _, status := bridge.VerifyBinding(r.Context(), sealed, session.Account); status != 200 {
		return status
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil {
		return 401
	}
	next := browserSSOBinding{session.Account, hashBytes([]byte(grant.GrantToken)), sealed, expires}
	root.mu.Lock()
	defer root.mu.Unlock()
	release, err = root.lockAndReload()
	if err != nil {
		return 503
	}
	defer release()
	if previous, exists := root.state.BrowserSSOBindings[key]; exists {
		if previous.Account == next.Account && previous.GrantDigest == next.GrantDigest && previous.ExpiresAt.Equal(next.ExpiresAt) {
			return 200
		}
		return 401
	}
	if root.state.BrowserSSOBindings == nil {
		root.state.BrowserSSOBindings = map[string]browserSSOBinding{}
	}
	for key, previous := range root.state.BrowserSSOBindings {
		if !previous.ExpiresAt.After(root.cfg.Now()) {
			delete(root.state.BrowserSSOBindings, key)
		}
	}
	if len(root.state.BrowserSSOBindings) >= 10000 {
		return 503
	}
	root.state.BrowserSSOBindings[key] = next
	if root.save() != nil {
		return 503
	}
	return 200
}
