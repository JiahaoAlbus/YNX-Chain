package finance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	introspectionURL, clientID, bundleID string
	client                               *http.Client
	now                                  func() time.Time
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
	return &Authenticator{introspectionURL: base + "/v1/wallet/sessions/introspect", clientID: clientID, bundleID: bundleID, client: &http.Client{Timeout: 5 * time.Second}, now: time.Now}, nil
}

func (a *Authenticator) Verify(proof, scope string) (Session, error) {
	proof = strings.TrimSpace(proof)
	if proof == "" || len(proof) > 8192 {
		return Session{}, errors.New("canonical Product Session proof required")
	}
	body, _ := json.Marshal(map[string]any{"requiredScopes": []string{scope}})
	if scope == "" {
		body = []byte(`{"requiredScopes":[]}`)
	}
	req, _ := http.NewRequest(http.MethodPost, a.introspectionURL, bytes.NewReader(body))
	req.Header.Set("X-YNX-Product-Session-Proof", proof)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return Session{}, fmt.Errorf("central Wallet session unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Session{}, errors.New("central Wallet session is missing, expired, or revoked")
	}
	var envelope struct {
		OK     bool `json:"ok"`
		Result struct {
			Active  bool `json:"active"`
			Session struct {
				Verifier       string   `json:"verifierVersion"`
				SessionBinding string   `json:"sessionBinding"`
				ProductClient  string   `json:"productClientId"`
				BundleID       string   `json:"bundleId"`
				RequestDigest  string   `json:"requestDigest"`
				Account        string   `json:"account"`
				Scopes         []string `json:"scopes"`
				ExpiresAt      string   `json:"expiresAt"`
			} `json:"session"`
		} `json:"result"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&envelope); err != nil || !envelope.OK || !envelope.Result.Active {
		return Session{}, errors.New("central Wallet session response is invalid")
	}
	raw := envelope.Result.Session
	expiresAt, err := time.Parse(time.RFC3339Nano, raw.ExpiresAt)
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
	return Session{Token: raw.SessionBinding, Verifier: raw.Verifier, SessionBinding: raw.SessionBinding, ProductClient: raw.ProductClient, BundleID: raw.BundleID, RequestDigest: raw.RequestDigest, Account: account, Scopes: raw.Scopes, ExpiresAt: expiresAt}, nil
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
