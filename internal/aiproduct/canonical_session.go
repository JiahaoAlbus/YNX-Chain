package aiproduct

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const AIWebOrigin = "https://assistant.ynxweb4.com"
const AIWebCallback = AIWebOrigin + "/wallet-auth/callback"

type canonicalSessionAuthorizer interface {
	Authorize(context.Context, *http.Request, []string) (productsessionv2.Session, error)
}

func aiWalletPolicy() productsessionv2.Policy {
	return productsessionv2.Policy{
		ProductID: "ai", ClientID: FormalProductClientID,
		ApplicationID: FormalBundleID + ".web", Platform: "web",
		Origin: AIWebOrigin, Callback: AIWebCallback,
		AllowedScopes: append([]string(nil), FormalScopes...),
	}
}

func (s *Server) handleWalletConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"productId": "ai", "clientId": FormalProductClientID,
		"applicationId": FormalBundleID + ".web", "origin": AIWebOrigin,
		"callback": AIWebCallback, "scopes": append([]string(nil), FormalScopes...),
		"gatewayOrigin":           s.cfg.CanonicalWalletGatewayOrigin,
		"canonicalConfigured":     s.wallet != nil,
		"localFixtureAuthEnabled": s.cfg.AllowLocalFixtureAuth,
		"proofHeader":             productsessionv2.ProofHeader,
		"sessionReadbackScopes":   []string{"ai:conversations"},
		"integratedCentral":       false,
		"boundary":                "Configuration is not deployment acceptance. Every private request needs a fresh Wallet scope proof; it is not approval of a business action.",
	})
}

func (s *Server) authenticateRequest(r *http.Request, scope string) (ProductSession, error) {
	if s.wallet != nil {
		// Canonical mode must never fall back to a fixture token, even when the
		// same state file contains historical development sessions.
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-YNX-Product-Session-Proof") != "" {
			return ProductSession{}, &productsessionv2.Error{Code: "LEGACY_CREDENTIAL_REJECTED", Status: http.StatusUnauthorized}
		}
		if scope == "" {
			scope = "ai:conversations"
		}
		verified, err := s.wallet.Authorize(r.Context(), r, []string{scope})
		if err != nil {
			return ProductSession{}, err
		}
		issued, err1 := time.Parse(time.RFC3339Nano, verified.IssuedAt)
		expires, err2 := time.Parse(time.RFC3339Nano, verified.ExpiresAt)
		if err1 != nil || err2 != nil {
			return ProductSession{}, &productsessionv2.Error{Code: "INVALID_AUTHORITY_RESPONSE", Status: http.StatusServiceUnavailable}
		}
		return ProductSession{ID: verified.SessionBinding, SessionBinding: verified.SessionBinding,
			Account: verified.Account, DeviceID: verified.DeviceID, ProductClientID: verified.ClientID,
			Scopes: append([]string(nil), verified.Scopes...), IssuedAt: issued, ExpiresAt: expires,
			Status: "active", AuthAuthority: "canonical-wallet-v2"}, nil
	}
	if r.Header.Get(productsessionv2.ProofHeader) != "" {
		return ProductSession{}, &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: http.StatusServiceUnavailable}
	}
	if !s.cfg.AllowLocalFixtureAuth && r.URL.Path != "/api/auth/revoke" {
		return ProductSession{}, &productsessionv2.Error{Code: "AUTHORITY_UNAVAILABLE", Status: http.StatusServiceUnavailable}
	}
	return s.store.Authenticate(r.Header.Get("Authorization"), r.Header.Get("X-YNX-Device-ID"))
}

func writeSessionAuthError(w http.ResponseWriter, err error) {
	var authorityError *productsessionv2.Error
	if errors.As(err, &authorityError) {
		message := "Wallet session authorization was rejected"
		if authorityError.Status == http.StatusServiceUnavailable {
			message = "canonical Wallet session integration is unavailable"
		}
		writeJSON(w, authorityError.Status, map[string]any{"error": message, "code": authorityError.Code})
		return
	}
	writeError(w, http.StatusUnauthorized, "product session invalid or expired")
}
