package finance

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var allowedScopes = map[string]bool{
	"finance.ai.draft":       true,
	"finance.pay.read":       true,
	"finance.portfolio.read": true,
	"finance.profile.write":  true,
}

type WalletAssertion struct {
	Version   string    `json:"version"`
	Nonce     string    `json:"nonce"`
	ChainID   string    `json:"chainId"`
	Product   string    `json:"product"`
	ClientID  string    `json:"clientId"`
	DeviceID  string    `json:"deviceId"`
	Account   string    `json:"account"`
	Scopes    []string  `json:"scopes"`
	IssuedAt  time.Time `json:"issuedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type SignedWalletAssertion struct {
	Assertion WalletAssertion `json:"assertion"`
	Signature string          `json:"signature"`
}

type Session struct {
	Token     string    `json:"token"`
	Account   string    `json:"account"`
	Scopes    []string  `json:"scopes"`
	DeviceID  string    `json:"deviceId"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Authenticator struct {
	mu       sync.RWMutex
	secret   []byte
	clientID string
	store    *Store
	sessions map[string]Session
	now      func() time.Time
}

func NewAuthenticator(secret, clientID string, store *Store) (*Authenticator, error) {
	if len(secret) < 32 {
		return nil, errors.New("finance wallet assertion secret must be at least 32 bytes")
	}
	if strings.TrimSpace(clientID) == "" {
		return nil, errors.New("finance wallet client id is required")
	}
	return &Authenticator{secret: []byte(secret), clientID: clientID, store: store, sessions: map[string]Session{}, now: time.Now}, nil
}

func (a *Authenticator) Complete(signed SignedWalletAssertion) (Session, error) {
	raw, err := json.Marshal(signed.Assertion)
	if err != nil {
		return Session{}, err
	}
	want := hmac.New(sha256.New, a.secret)
	_, _ = want.Write(raw)
	got, err := base64.RawURLEncoding.DecodeString(signed.Signature)
	if err != nil || !hmac.Equal(got, want.Sum(nil)) {
		return Session{}, errors.New("wallet assertion signature is invalid")
	}
	v := signed.Assertion
	now := a.now().UTC()
	if v.Version != "1" || v.ChainID != ChainID || v.Product != Product || v.ClientID != a.clientID {
		return Session{}, errors.New("wallet assertion product or network binding is invalid")
	}
	_, err = accountaddress.Normalize(v.Account)
	if err != nil || !strings.HasPrefix(strings.ToLower(v.Account), "ynx1") {
		return Session{}, errors.New("wallet assertion account must be a native ynx1 address")
	}
	account := strings.ToLower(v.Account)
	if len(v.Nonce) < 16 || len(v.Nonce) > 128 || len(v.DeviceID) < 8 || len(v.DeviceID) > 128 {
		return Session{}, errors.New("wallet assertion nonce or device binding is invalid")
	}
	if v.IssuedAt.After(now.Add(30*time.Second)) || now.Sub(v.IssuedAt) > 5*time.Minute || !v.ExpiresAt.After(now) || v.ExpiresAt.Sub(v.IssuedAt) > 5*time.Minute {
		return Session{}, errors.New("wallet assertion is expired or exceeds five minutes")
	}
	if err := validateScopes(v.Scopes); err != nil {
		return Session{}, err
	}
	if !contains(v.Scopes, "finance.portfolio.read") {
		return Session{}, errors.New("wallet assertion lacks portfolio read scope")
	}
	if err := a.store.UseNonce(v.Nonce, v.ExpiresAt); err != nil {
		return Session{}, err
	}
	session := Session{Token: randomToken(), Account: account, Scopes: append([]string(nil), v.Scopes...), DeviceID: v.DeviceID, ExpiresAt: now.Add(30 * time.Minute)}
	a.mu.Lock()
	a.sessions[session.Token] = session
	a.mu.Unlock()
	return session, nil
}

func (a *Authenticator) Verify(header, scope string) (Session, error) {
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" || token == header {
		return Session{}, errors.New("bearer session required")
	}
	a.mu.RLock()
	session, ok := a.sessions[token]
	a.mu.RUnlock()
	if !ok || !session.ExpiresAt.After(a.now().UTC()) {
		return Session{}, errors.New("session is missing or expired")
	}
	if scope != "" && !contains(session.Scopes, scope) {
		return Session{}, fmt.Errorf("session lacks %s scope", scope)
	}
	return session, nil
}

func (a *Authenticator) Revoke(header string) {
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	a.mu.Lock()
	delete(a.sessions, token)
	a.mu.Unlock()
}

func validateScopes(scopes []string) error {
	if len(scopes) == 0 || len(scopes) > len(allowedScopes) {
		return errors.New("wallet assertion scopes are empty or too broad")
	}
	copyScopes := append([]string(nil), scopes...)
	sort.Strings(copyScopes)
	for i, scope := range scopes {
		if !allowedScopes[scope] || scope != copyScopes[i] || (i > 0 && scope == scopes[i-1]) {
			return errors.New("wallet assertion scopes must be allowed, unique and sorted")
		}
	}
	return nil
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
