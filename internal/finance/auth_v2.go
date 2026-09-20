package finance

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
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
	return newBrowserV2Authenticator(nil, unavailableEndpointAuthority{code: "FINANCE_AUTHORITY_V2_NOT_CONFIGURED"})
}

func NewBrowserV2AuthenticatorWithAuthority(authority EndpointAuthorityGate) (*Authenticator, error) {
	if authority == nil {
		authority = unavailableEndpointAuthority{code: "FINANCE_AUTHORITY_V2_NOT_CONFIGURED"}
	}
	return newBrowserV2Authenticator(nil, authority)
}

func newBrowserV2Authenticator(transport http.RoundTripper, authorities ...EndpointAuthorityGate) (*Authenticator, error) {
	verifier, err := productsessionv2.NewClient(BrowserWalletAuthority, productsessionv2.Policy{
		ProductID: "finance", ClientID: "ynx-finance-v1", ApplicationID: "com.ynxweb4.finance.web", Platform: "web",
		Origin: BrowserFinanceOrigin, Callback: BrowserFinanceOrigin + "/wallet-auth/callback",
		AllowedScopes: []string{"finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"},
	}, transport)
	if err != nil {
		return nil, err
	}
	authority := EndpointAuthorityGate(unavailableEndpointAuthority{code: "FINANCE_AUTHORITY_V2_NOT_CONFIGURED"})
	if len(authorities) == 1 && authorities[0] != nil {
		authority = authorities[0]
	}
	return &Authenticator{v2: verifier, privateAuthority: authority}, nil
}

func (a *Authenticator) VerifyRequest(r *http.Request, scope string) (Session, error) {
	if a.v2 == nil {
		return a.Verify(r.Header.Get("X-YNX-Product-Session-Proof"), scope)
	}
	if a.privateAuthority == nil {
		return Session{}, &productsessionv2.Error{Code: "FINANCE_AUTHORITY_V2_NOT_CONFIGURED", Status: http.StatusServiceUnavailable}
	}
	if len(r.Header.Values("X-YNX-Product-Session-Proof")) != 0 {
		return Session{}, &productsessionv2.Error{Code: "LEGACY_AUTHORITY_PROOF_REJECTED", Status: http.StatusUnauthorized}
	}
	if gate, ok := a.privateAuthority.(interface{ RequiresProofPrevalidation() bool }); ok && gate.RequiresProofPrevalidation() {
		if err := prevalidateProductSessionV2Proof(r); err != nil {
			return Session{}, err
		}
	}
	if err := a.privateAuthority.Authorize(r.Context()); err != nil {
		return Session{}, err
	}
	if scope == "" {
		scope = "finance.portfolio.read"
	}
	raw, err := a.v2.Authorize(r.Context(), r, []string{scope})
	if err != nil {
		return Session{}, err
	}
	if !slices.Contains(raw.Scopes, scope) {
		return Session{}, &productsessionv2.Error{Code: "INSUFFICIENT_SCOPE", Status: http.StatusForbidden}
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, raw.ExpiresAt)
	if err != nil {
		return Session{}, &productsessionv2.Error{Code: "INVALID_AUTHORITY_RESPONSE", Status: http.StatusServiceUnavailable}
	}
	return Session{Token: raw.SessionBinding, Verifier: "wallet-auth-v2", SessionBinding: raw.SessionBinding,
		ProductClient: raw.ClientID, BundleID: raw.ApplicationID, RequestDigest: raw.RequestDigest,
		Account: raw.Account, Scopes: raw.Scopes, ExpiresAt: expiresAt}, nil
}

// prevalidateProductSessionV2Proof rejects requests that cannot possibly be a
// canonical v2 proof before invoking the bounded external authority process.
// Cryptographic, policy and replay validation remains exclusively in the
// shared productsessionv2 client.
func prevalidateProductSessionV2Proof(r *http.Request) error {
	values := r.Header.Values(productsessionv2.ProofHeader)
	if len(values) != 1 || len(values[0]) == 0 || len(values[0]) > 16384 {
		return &productsessionv2.Error{Code: "PROOF_REQUIRED", Status: http.StatusUnauthorized}
	}
	header := values[0]
	if strings.TrimSpace(header) != header {
		return &productsessionv2.Error{Code: "INVALID_PROOF", Status: http.StatusUnauthorized}
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(header)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != header || len(raw) == 0 || len(raw) > 12288 || !json.Valid(raw) {
		return &productsessionv2.Error{Code: "INVALID_PROOF", Status: http.StatusUnauthorized}
	}
	var shape map[string]json.RawMessage
	if json.Unmarshal(raw, &shape) != nil || len(shape) == 0 || string(shape["version"]) != `"2"` || len(shape["signature"]) == 0 {
		return &productsessionv2.Error{Code: "INVALID_PROOF", Status: http.StatusUnauthorized}
	}
	return nil
}
