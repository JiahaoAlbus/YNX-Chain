package aiproduct

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"net/http"
)

func (s *Server) registerBrowserSSO() {
	unavailable := func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 503, map[string]string{"code": "SSO_NOT_CONFIGURED"})
	}
	if s.browserSSO == nil {
		s.mux.HandleFunc("GET /sso/start", unavailable)
		s.mux.HandleFunc("GET /sso/callback", unavailable)
		s.mux.HandleFunc("GET /api/account", unavailable)
		s.mux.HandleFunc("POST /api/account/logout", unavailable)
		return
	}
	s.mux.HandleFunc("GET /sso/start", s.browserSSO.Start)
	s.mux.HandleFunc("GET /sso/callback", s.browserSSO.Callback)
	s.mux.HandleFunc("GET /api/account", s.browserSSO.Account)
	s.mux.HandleFunc("POST /api/account/logout", s.browserSSO.Logout)
}
func (s *Server) verifyBrowserIdentity(r *http.Request, account string) error {
	if s.browserSSO == nil {
		return nil
	}
	if _, err := r.Cookie("__Host-ynx-ai-identity-signedout"); err == nil {
		return &productsessionv2.Error{Code: "SSO_SIGNED_OUT", Status: 401}
	}
	if _, err := r.Cookie("__Host-ynx-ai-identity"); err != nil {
		return nil
	}
	binding, local, err := s.browserSSO.Binding(r)
	if err != nil || local.Identity.Account != account {
		return &productsessionv2.Error{Code: "SSO_IDENTITY_MISMATCH", Status: 401}
	}
	_, status := s.browserSSO.VerifyBinding(r.Context(), binding, account)
	if status != 200 {
		return &productsessionv2.Error{Code: "SSO_RECHECK_REQUIRED", Status: status}
	}
	return nil
}
func (s *Server) walletCallbackProjection() string {
	if s.wallet != nil {
		return AIWebCallback
	}
	return s.cfg.ExactWalletCallback
}
func (s *Server) authAuthorityProjection() string {
	if s.wallet != nil {
		return "canonical-wallet-v2: separate fresh scope proofs required"
	}
	if s.cfg.AllowLocalFixtureAuth {
		return "explicit local fixture only"
	}
	return "canonical Wallet integration unavailable; private sign-in fails closed"
}
