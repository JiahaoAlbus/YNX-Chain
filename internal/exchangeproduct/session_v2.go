package exchangeproduct

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const exchangeSessionAuthority = "https://wallet-auth.ynxweb4.com"
const exchangeWebOrigin = "https://exchange.ynxweb4.com"

// This is the same accepted shared verifier as the earlier schema-1 owner
// checkpoint, now composed with the actual schema-10 venue. Storage, matching,
// risk, Finance integration and existing signed execution are not replaced.
func NewProductSessionV2Client() (*productsessionv2.Client, error) {
	return newProductSessionV2Client(nil)
}

func newProductSessionV2Client(transport http.RoundTripper) (*productsessionv2.Client, error) {
	return productsessionv2.NewClient(exchangeSessionAuthority, productsessionv2.Policy{
		ProductID: "exchange", ClientID: "ynx-exchange-v1", ApplicationID: "com.ynxweb4.exchange",
		Platform: "web", Origin: exchangeWebOrigin, Callback: exchangeWebOrigin + "/wallet-auth/callback",
		AllowedScopes: []string{"exchange:read"},
	}, transport)
}

type exchangeSessionV2ContextKey struct{}

// Read provenance is an observation of the existing venue, not a new ledger.
type AccountReadSource struct {
	Authority      string `json:"authority"`
	Version        string `json:"version"`
	Classification string `json:"classification"`
	Coverage       string `json:"coverage"`
	AsOf           string `json:"asOf"`
	StateBackend   string `json:"stateBackend"`
	Status         string `json:"status"`
	MultiInstance  bool   `json:"multiInstance"`
}

func (s *Server) authorizeBrowserReadV2(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if len(r.Header.Values(productsessionv2.ProofHeader)) == 0 {
		return r, true
	}
	failure := func(code string, status int) (*http.Request, bool) {
		private := "authorization_required"
		if status >= 500 {
			private = "degraded"
		}
		writeJSON(w, status, map[string]string{"error": code, "privateService": private})
		return r, false
	}
	if len(r.Header.Values("X-YNX-Product-Session-Proof")) != 0 {
		return failure("AMBIGUOUS_SESSION_PROTOCOL", http.StatusBadRequest)
	}
	// Future write/Quant/stream adapters need their own exact business authority.
	// An otherwise valid P-256 read proof must never fall back to a v1 route.
	_, pattern := s.mux.Handler(r)
	if pattern != "GET /v1/account" && pattern != "GET /v1/margin/account" && pattern != "GET /v1/solvency/liability-proof" {
		return failure("EXPLICIT_ROUTE_SCOPE_UNAVAILABLE", http.StatusForbidden)
	}
	if s.service.cfg.SessionV2 == nil {
		return failure("PRIVATE_SERVICE_UNCONFIGURED", http.StatusServiceUnavailable)
	}
	session, err := s.service.cfg.SessionV2.Authorize(r.Context(), r, []string{"exchange:read"})
	if err != nil {
		var typed *productsessionv2.Error
		if errors.As(err, &typed) {
			return failure(typed.Code, typed.Status)
		}
		return failure("PRIVATE_SERVICE_UNAVAILABLE", http.StatusServiceUnavailable)
	}
	created, err1 := time.Parse(time.RFC3339Nano, session.IssuedAt)
	expires, err2 := time.Parse(time.RFC3339Nano, session.ExpiresAt)
	if err1 != nil || err2 != nil {
		return failure("INVALID_SESSION_TIME", http.StatusServiceUnavailable)
	}
	// Deliberately no WalletPublicKey, token issuance or persisted authority.
	auth := WalletSession{Account: session.Account, DeviceID: session.DeviceID,
		ProductDeviceKey: session.DeviceKey, SessionBinding: session.SessionBinding,
		Scopes: append([]string(nil), session.Scopes...), CreatedAt: created, ExpiresAt: expires}
	return r.WithContext(context.WithValue(r.Context(), exchangeSessionV2ContextKey{}, auth)), true
}
