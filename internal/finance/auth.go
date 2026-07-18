package finance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var allowedScopes = map[string]bool{
	"finance.ai.draft": true, "finance.pay.read": true,
	"finance.portfolio.read": true, "finance.profile.write": true,
}

type Session struct {
	Token          string    `json:"-"`
	Verifier       string    `json:"verifierVersion"`
	SessionBinding string    `json:"sessionBinding"`
	ProductClient  string    `json:"productClientId"`
	BundleID       string    `json:"bundleId"`
	RequestDigest  string    `json:"requestDigest"`
	Account        string    `json:"account"`
	Scopes         []string  `json:"scopes"`
	ExpiresAt      time.Time `json:"expiresAt"`
}

// Authenticator accepts only opaque sessions issued by the canonical Wallet
// Gateway. It deliberately has no local assertion or fallback session.
type Authenticator struct {
	introspectionURL, revocationURL, internalKey, clientID, bundleID string
	client                                                           *http.Client
	now                                                              func() time.Time
}

func NewAuthenticator(gatewayURL, internalKey, clientID, bundleID string) (*Authenticator, error) {
	if _, err := requireHTTPURL(gatewayURL); err != nil {
		return nil, fmt.Errorf("Wallet Gateway URL: %w", err)
	}
	if len(internalKey) < 32 {
		return nil, errors.New("Finance internal Gateway key must be at least 32 bytes")
	}
	if clientID != "ynx-finance-v1" || bundleID != "com.ynxweb4.finance" {
		return nil, errors.New("canonical Finance client or bundle binding is invalid")
	}
	base := strings.TrimRight(gatewayURL, "/")
	return &Authenticator{introspectionURL: base + "/wallet-auth/introspect", revocationURL: base + "/wallet-auth/revoke", internalKey: internalKey, clientID: clientID, bundleID: bundleID, client: &http.Client{Timeout: 5 * time.Second}, now: time.Now}, nil
}

func (a *Authenticator) Verify(header, scope string) (Session, error) {
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || token == header || len(token) > 2048 {
		return Session{}, errors.New("canonical bearer session required")
	}
	req, _ := http.NewRequest(http.MethodPost, a.introspectionURL, bytes.NewReader([]byte("{}")))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-YNX-Finance-Internal-Key", a.internalKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return Session{}, fmt.Errorf("central Wallet session unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Session{}, errors.New("central Wallet session is missing, expired, or revoked")
	}
	var raw struct {
		Verifier       string   `json:"verifierVersion"`
		SessionBinding string   `json:"sessionBinding"`
		ProductClient  string   `json:"productClientId"`
		BundleID       string   `json:"bundleId"`
		RequestDigest  string   `json:"requestDigest"`
		Account        string   `json:"account"`
		Scopes         []string `json:"scopes"`
		IssuedAt       string   `json:"issuedAt"`
		ExpiresAt      string   `json:"expiresAt"`
	}
	dec := json.NewDecoder(resp.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return Session{}, errors.New("central Wallet session response is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339, raw.ExpiresAt)
	if err != nil || !expiresAt.After(a.now().UTC()) || raw.Verifier != "wallet-auth-v1" || raw.ProductClient != a.clientID || raw.BundleID != a.bundleID || len(raw.SessionBinding) != 64 || len(raw.RequestDigest) != 64 {
		return Session{}, errors.New("central Wallet session binding is invalid")
	}
	_, err = accountaddress.Normalize(raw.Account)
	if err != nil || !strings.HasPrefix(strings.ToLower(raw.Account), "ynx1") {
		return Session{}, errors.New("central Wallet session account is invalid")
	}
	account := strings.ToLower(raw.Account)
	if err := validateScopes(raw.Scopes); err != nil {
		return Session{}, err
	}
	if !contains(raw.Scopes, "finance.portfolio.read") || (scope != "" && !contains(raw.Scopes, scope)) {
		return Session{}, fmt.Errorf("central Wallet session lacks %s scope", scope)
	}
	return Session{Token: token, Verifier: raw.Verifier, SessionBinding: raw.SessionBinding, ProductClient: raw.ProductClient, BundleID: raw.BundleID, RequestDigest: raw.RequestDigest, Account: account, Scopes: raw.Scopes, ExpiresAt: expiresAt}, nil
}

func (a *Authenticator) Revoke(header string) {
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || token == header {
		return
	}
	req, _ := http.NewRequest(http.MethodPost, a.revocationURL, bytes.NewReader([]byte("{}")))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-YNX-Finance-Internal-Key", a.internalKey)
	resp, err := a.client.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

func validateScopes(scopes []string) error {
	if len(scopes) == 0 || len(scopes) > len(allowedScopes) {
		return errors.New("central Wallet scopes are empty or too broad")
	}
	for i, scope := range scopes {
		if !allowedScopes[scope] || (i > 0 && scopes[i-1] >= scope) {
			return errors.New("central Wallet scopes must be allowed, unique, and sorted")
		}
	}
	return nil
}
func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
