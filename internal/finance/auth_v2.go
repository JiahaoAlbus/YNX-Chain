package finance

import (
	"context"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

const BrowserWalletAuthority = "https://wallet-auth.ynxweb4.com"
const BrowserFinanceOrigin = "https://finance.ynxweb4.com"

type productSessionV2Authorizer interface {
	Authorize(context.Context, *http.Request, []string) (productsessionv2.Session, error)
}

// NewBrowserV2Authenticator consumes the shared verifier with the exact Finance
// registry row. Neither the caller nor a business request can inject an endpoint,
// product, callback, application identity, or required scope.
func NewBrowserV2Authenticator() (*Authenticator, error) {
	return newBrowserV2Authenticator(nil)
}

func newBrowserV2Authenticator(transport http.RoundTripper) (*Authenticator, error) {
	verifier, err := productsessionv2.NewClient(BrowserWalletAuthority, productsessionv2.Policy{
		ProductID: "finance", ClientID: "ynx-finance-v1", ApplicationID: "com.ynxweb4.finance.web", Platform: "web",
		Origin: BrowserFinanceOrigin, Callback: BrowserFinanceOrigin + "/wallet-auth/callback",
		AllowedScopes: []string{"finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"},
	}, transport)
	if err != nil {
		return nil, err
	}
	return &Authenticator{v2: verifier}, nil
}

func (a *Authenticator) VerifyRequest(r *http.Request, scope string) (Session, error) {
	if a.v2 == nil {
		return a.Verify(r.Header.Get("X-YNX-Product-Session-Proof"), scope)
	}
	if len(r.Header.Values("X-YNX-Product-Session-Proof")) != 0 {
		return Session{}, &productsessionv2.Error{Code: "LEGACY_AUTHORITY_PROOF_REJECTED", Status: http.StatusUnauthorized}
	}
	if scope == "" {
		scope = "finance.portfolio.read"
	}
	raw, err := a.v2.Authorize(r.Context(), r, []string{scope})
	if err != nil {
		return Session{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, raw.ExpiresAt)
	if err != nil {
		return Session{}, &productsessionv2.Error{Code: "INVALID_AUTHORITY_RESPONSE", Status: http.StatusServiceUnavailable}
	}
	return Session{Token: raw.SessionBinding, Verifier: "wallet-auth-v2", SessionBinding: raw.SessionBinding,
		ProductClient: raw.ClientID, BundleID: raw.ApplicationID, RequestDigest: raw.RequestDigest,
		Account: raw.Account, Scopes: raw.Scopes, ExpiresAt: expiresAt}, nil
}
