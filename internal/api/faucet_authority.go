package api

import (
	"net/http"
	"regexp"
)

const FaucetCoreAuthorityVersion = "ynx-faucet-core-token-v1"
const FaucetCoreAuthorityHeader = "X-YNX-Faucet-Auth"

var faucetCoreTokenPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (s *Server) faucetAuthorityRequired() bool {
	return s.networkConfig.Slug == "testnet" || s.networkConfig.Slug == "mainnet" || s.faucetCoreAuthToken != ""
}

func (s *Server) faucetAuthorityModel() map[string]any {
	return map[string]any{
		"version": FaucetCoreAuthorityVersion, "header": FaucetCoreAuthorityHeader,
		"required": s.faucetAuthorityRequired(), "configured": faucetCoreTokenPattern.MatchString(s.faucetCoreAuthToken),
	}
}

func (s *Server) authorizeFaucet(w http.ResponseWriter, r *http.Request) bool {
	if !s.faucetAuthorityRequired() {
		return true
	}
	if !faucetCoreTokenPattern.MatchString(s.faucetCoreAuthToken) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "faucet service authority is not configured", "status": "faucet_authority_unavailable"})
		return false
	}
	values := r.Header.Values(FaucetCoreAuthorityHeader)
	if len(values) != 1 || !faucetCoreTokenPattern.MatchString(values[0]) || !constantTimeEqual(values[0], s.faucetCoreAuthToken) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "faucet requires the authenticated funding service", "status": "faucet_authority_required"})
		return false
	}
	return true
}
