package exchangeproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Optional schema-10 provenance association. This neither issues a local
// session nor authorizes orders, custody, execution or any wider scope.
type browserSSOBinding struct {
	Account     string    `json:"account"`
	GrantDigest string    `json:"grantDigest"`
	SealedGrant string    `json:"sealedGrant"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func ssoDigest(value string) string {
	raw := sha256.Sum256([]byte(value))
	return hex.EncodeToString(raw[:])
}
func (s *Server) authorizeBrowserSSO(r *http.Request, session productsessionv2.Session) int {
	if err := s.service.refreshState(); err != nil {
		return 503
	}
	key := ssoDigest(session.SessionBinding)
	s.service.mu.Lock()
	stored, linked := s.service.state.BrowserSSOBindings[key]
	s.service.mu.Unlock()
	bridge := s.service.cfg.BrowserSSO
	if bridge == nil {
		if linked {
			return 401
		}
		return 200
	}
	encoded, local, err := bridge.Binding(r)
	if err != nil {
		for _, cookie := range r.Cookies() {
			if cookie.Name == "__Host-ynx-exchange-identity" {
				return 401
			}
		}
	}
	if linked {
		if stored.Account != session.Account || !stored.ExpiresAt.After(s.service.cfg.Now()) {
			return 401
		}
		if err == nil && (local.Identity.Account != stored.Account || ssoDigest(local.GrantToken) != stored.GrantDigest) {
			return 401
		}
		_, status := bridge.VerifyBinding(r.Context(), stored.SealedGrant, session.Account)
		return status
	}
	if err != nil {
		return 200 // Independent, previously approved native-only read channel.
	}
	if local.Identity.Account != session.Account {
		return 401
	}
	if _, status := bridge.VerifyBinding(r.Context(), encoded, session.Account); status != 200 {
		return status
	}
	expires, err := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err != nil {
		return 401
	}
	next := browserSSOBinding{session.Account, ssoDigest(local.GrantToken), encoded, expires}
	s.service.mu.Lock()
	defer s.service.mu.Unlock()
	if previous, exists := s.service.state.BrowserSSOBindings[key]; exists {
		if previous.Account == next.Account && previous.GrantDigest == next.GrantDigest && previous.ExpiresAt.Equal(next.ExpiresAt) {
			return 200
		}
		return 401
	}
	before := cloneState(s.service.state)
	if s.service.state.BrowserSSOBindings == nil {
		s.service.state.BrowserSSOBindings = map[string]browserSSOBinding{}
	}
	for key, value := range s.service.state.BrowserSSOBindings {
		if !value.ExpiresAt.After(s.service.cfg.Now()) {
			delete(s.service.state.BrowserSSOBindings, key)
		}
	}
	if len(s.service.state.BrowserSSOBindings) >= 10000 {
		return 503
	}
	s.service.state.BrowserSSOBindings[key] = next
	if s.service.saveOrRollbackLocked(before) != nil {
		// SaveOrRollback already reloads the authoritative CAS winner. A second
		// process associating the same verified grant is semantically idempotent;
		// ciphertext nonce inequality is not an identity conflict.
		if winner, exists := s.service.state.BrowserSSOBindings[key]; exists && winner.Account == next.Account && winner.GrantDigest == next.GrantDigest && winner.ExpiresAt.Equal(next.ExpiresAt) {
			return 200
		}
		return 503
	}
	return 200
}
