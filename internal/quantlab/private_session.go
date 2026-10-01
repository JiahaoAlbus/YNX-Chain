package quantlab

import (
	"context"
	"errors"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const QuantPrivateAuthority = "https://wallet-auth.ynxweb4.com"

// ProductSessionAuthorizer is the unchanged shared v2 consumer, not an issuer
// or a substitute for a native Wallet's exact-action mandate/order signature.
type ProductSessionAuthorizer interface {
	Authorize(context.Context, *http.Request, []string) (productsessionv2.Session, error)
}

func NewQuantPrivateSessionClient() (*productsessionv2.Client, error) {
	return productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), nil)
}

func QuantPrivateSessionPolicy() productsessionv2.Policy {
	return productsessionv2.Policy{ProductID: "quant", ClientID: "ynx-quant-v1", ApplicationID: "com.ynxweb4.quant.web", Platform: "web", Origin: "https://quant.ynxweb4.com", Callback: "https://quant.ynxweb4.com/wallet-auth/callback", AllowedScopes: []string{"quant:account", "quant:paper:workspace", "quant:records:read"}}
}

func (s *Server) privateAccount(w http.ResponseWriter, r *http.Request) {
	var empty struct{}
	if !decode(w, r, &empty) {
		return
	}
	if s.service.cfg.PrivateSession == nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "private_session_unavailable")
		return
	}
	// The route, not the submitted body, chooses the exact introspection scope.
	// Authorize consumes a fresh proof on each request, including network retry.
	session, err := s.service.cfg.PrivateSession.Authorize(r.Context(), r, []string{"quant:account"})
	if err != nil {
		var authError *productsessionv2.Error
		if errors.As(err, &authError) {
			writeProblem(w, r, authError.Status, authError.Code)
		} else {
			writeProblem(w, r, http.StatusServiceUnavailable, "private_session_unavailable")
		}
		return
	}
	if status := s.authorizeBrowserSSO(r, session); status != 200 {
		writeProblem(w, r, status, "browser_identity_binding_unavailable")
		return
	}
	write(w, http.StatusOK, map[string]any{"account": session.Account, "sessionBinding": session.SessionBinding, "expiresAt": session.ExpiresAt, "authority": QuantPrivateAuthority, "productId": "quant", "nativeExecutionEnabled": false, "paperWorkspaceLinked": false})
}

// Records are a separate explicit Wallet consent. quant:account remains only
// account metadata; central identity and a tenant header cannot grant this read.
func (s *Server) privateRecords(w http.ResponseWriter, r *http.Request) {
	var empty struct{}
	if !decode(w, r, &empty) {
		return
	}
	if s.service.cfg.PrivateSession == nil || s.service.cfg.ownedRecords == nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "private_records_unavailable")
		return
	}
	session, err := s.service.cfg.PrivateSession.Authorize(r.Context(), r, []string{"quant:records:read"})
	if err != nil {
		var authError *productsessionv2.Error
		if errors.As(err, &authError) {
			writeProblem(w, r, authError.Status, authError.Code)
		} else {
			writeProblem(w, r, http.StatusServiceUnavailable, "private_records_unavailable")
		}
		return
	}
	if status := s.authorizeBrowserSSO(r, session); status != 200 {
		writeProblem(w, r, status, "browser_identity_binding_unavailable")
		return
	}
	// Account is chosen only by the fresh verified native session, never JSON,
	// tenant name or central subject. The existing reader excludes research/Paper.
	data, err := s.service.cfg.ownedRecords(session.Account)
	if err != nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "private_records_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	write(w, http.StatusOK, map[string]any{"account": session.Account, "sessionBinding": session.SessionBinding, "expiresAt": session.ExpiresAt, "records": data, "nativeExecutionEnabled": false, "paperWorkspaceLinked": false})
}

func rejectV2NativeBridge(w http.ResponseWriter, r *http.Request) bool {
	if len(r.Header.Values(productsessionv2.ProofHeader)) == 0 {
		return false
	}
	// Exchange's existing adapter still verifies a business-bound v1 proof. A
	// v2 introspection proof may never be forwarded as that incompatible proof.
	writeProblem(w, r, http.StatusServiceUnavailable, "native_exchange_v2_adapter_unavailable")
	return true
}
