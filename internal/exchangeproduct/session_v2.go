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

// NewProductSessionV2Client binds the accepted Wallet registry's Exchange Web
// identity. No browser input or legacy Gateway configuration can change it.
func NewProductSessionV2Client() (*productsessionv2.Client, error) {
	return newProductSessionV2Client(nil)
}

// The transport seam is package-private and used only by offline fixtures.
func newProductSessionV2Client(transport http.RoundTripper) (*productsessionv2.Client, error) {
	return productsessionv2.NewClient(exchangeSessionAuthority, productsessionv2.Policy{
		ProductID: "exchange", ClientID: "ynx-exchange-v1", ApplicationID: "com.ynxweb4.exchange",
		Platform: "web", Origin: exchangeWebOrigin, Callback: exchangeWebOrigin + "/wallet-auth/callback",
		AllowedScopes: []string{"exchange:ai", "exchange:deposit", "exchange:read", "exchange:trade", "exchange:withdrawal-review"},
	}, transport)
}

type exchangeSessionV2ContextKey struct{}
type exchangeSessionV2Authorization struct {
	scope   string
	session WalletSession
}

func (s *Server) handlePrivate(pattern, scope string, handler http.HandlerFunc) {
	s.privateScopes[pattern] = scope
	s.mux.HandleFunc(pattern, handler)
}

func (s *Server) authorizeSessionV2(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	_, pattern := s.mux.Handler(r)
	scope, private := s.privateScopes[pattern]
	if !private || len(r.Header.Values(productsessionv2.ProofHeader)) == 0 {
		return r, true // Guest and existing v1 sessions retain their own paths.
	}
	failure := func(code string, status int) (*http.Request, bool) {
		state := "authorization_required"
		if status >= 500 {
			state = "degraded"
		}
		// Fixed codes only. Never echo a proof, upstream body or device key.
		writeJSON(w, status, map[string]string{"error": code, "privateService": state})
		return r, false
	}
	if len(r.Header.Values("X-YNX-Product-Session-Proof")) != 0 {
		return failure("AMBIGUOUS_SESSION_PROTOCOL", http.StatusBadRequest)
	}
	// The existing security/support mutations only declare read permission.
	// Do not carry that legacy ambiguity into v2 or invent wider registry scopes.
	if scope == "exchange:read" && r.Method != http.MethodGet && r.Method != http.MethodHead {
		return failure("EXPLICIT_WRITE_SCOPE_UNAVAILABLE", http.StatusForbidden)
	}
	if s.service.cfg.SessionV2 == nil {
		return failure("PRIVATE_SERVICE_UNCONFIGURED", http.StatusServiceUnavailable)
	}
	v, err := s.service.cfg.SessionV2.Authorize(r.Context(), r, []string{scope})
	if err != nil {
		var typed *productsessionv2.Error
		if errors.As(err, &typed) {
			return failure(typed.Code, typed.Status)
		}
		return failure("PRIVATE_SERVICE_UNAVAILABLE", http.StatusServiceUnavailable)
	}
	created, err1 := time.Parse(time.RFC3339Nano, v.IssuedAt)
	expires, err2 := time.Parse(time.RFC3339Nano, v.ExpiresAt)
	if err1 != nil || err2 != nil {
		return failure("INVALID_SESSION_TIME", http.StatusServiceUnavailable)
	}
	// A P-256 device proof is not a native wallet action signature/public key.
	// Never issue a local bearer token or persist an authority session here.
	auth := exchangeSessionV2Authorization{scope: scope, session: WalletSession{
		Account: v.Account, DeviceID: v.DeviceID, ProductDeviceKey: v.DeviceKey,
		SessionBinding: v.SessionBinding, Scopes: append([]string(nil), v.Scopes...),
		CreatedAt: created, ExpiresAt: expires,
	}}
	return r.WithContext(context.WithValue(r.Context(), exchangeSessionV2ContextKey{}, auth)), true
}
