package cardproduct

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var (
	ErrGatewayUnauthorized = errors.New("canonical Gateway assertion required")
	identifierPattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`)
)

type GatewayAssertion struct {
	Account       string
	SessionID     string
	DeviceID      string
	ProductID     string
	ClientID      string
	BundleID      string
	Callback      string
	ChainID       string
	Scopes        []string
	RequestDigest string
	IssuedAt      time.Time
	ExpiresAt     time.Time
	Nonce         string
}

type GatewayVerifier struct {
	key    []byte
	window time.Duration
	now    func() time.Time
	store  *Store
}

func NewGatewayVerifier(key []byte, store *Store, now func() time.Time) (*GatewayVerifier, error) {
	if len(key) < 32 {
		return nil, errors.New("Gateway assertion key must contain at least 32 bytes")
	}
	if store == nil {
		return nil, errors.New("Gateway verifier store is required")
	}
	if now == nil {
		now = time.Now
	}
	return &GatewayVerifier{key: append([]byte(nil), key...), window: 5 * time.Minute, now: now, store: store}, nil
}

func (v *GatewayVerifier) Verify(r *http.Request, body []byte) (GatewayAssertion, error) {
	a := GatewayAssertion{
		Account: strings.TrimSpace(r.Header.Get("X-YNX-Account")), SessionID: strings.TrimSpace(r.Header.Get("X-YNX-Session-ID")),
		DeviceID: strings.TrimSpace(r.Header.Get("X-YNX-Device-ID")), ProductID: strings.TrimSpace(r.Header.Get("X-YNX-Product")),
		ClientID: strings.TrimSpace(r.Header.Get("X-YNX-Client")), BundleID: strings.TrimSpace(r.Header.Get("X-YNX-Bundle")),
		Callback: strings.TrimSpace(r.Header.Get("X-YNX-Callback")), ChainID: strings.TrimSpace(r.Header.Get("X-YNX-Chain")),
		RequestDigest: strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Request-Digest"))), Nonce: strings.TrimSpace(r.Header.Get("X-YNX-Nonce")),
	}
	a.Scopes = splitScopes(r.Header.Get("X-YNX-Scopes"))
	var err error
	a.IssuedAt, err = time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Issued-At"))
	if err != nil {
		return GatewayAssertion{}, ErrGatewayUnauthorized
	}
	a.ExpiresAt, err = time.Parse(time.RFC3339Nano, r.Header.Get("X-YNX-Expires-At"))
	if err != nil {
		return GatewayAssertion{}, ErrGatewayUnauthorized
	}
	signature := strings.ToLower(strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Signature")))
	account, accountErr := nativewallet.NormalizeNativeAddress(a.Account)
	now := v.now().UTC()
	if accountErr != nil || !identifierPattern.MatchString(a.SessionID) || !identifierPattern.MatchString(a.DeviceID) || !identifierPattern.MatchString(a.Nonce) ||
		a.ProductID != ProductID || a.ClientID != ClientID || a.BundleID != BundleID || a.Callback != Callback || a.ChainID != "ynx_6423-1" ||
		!sameScopes(a.Scopes, CardScopes) || len(a.RequestDigest) != 64 || len(signature) != 64 || !now.Before(a.ExpiresAt) || a.ExpiresAt.Sub(a.IssuedAt) > v.window || now.Before(a.IssuedAt.Add(-30*time.Second)) || now.After(a.ExpiresAt) {
		return GatewayAssertion{}, ErrGatewayUnauthorized
	}
	a.Account = account
	bodyHash := sha256.Sum256(body)
	material := strings.Join([]string{GatewayDomain, r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), a.Account, a.SessionID, a.DeviceID, a.ProductID, a.ClientID, a.BundleID, a.Callback, a.ChainID, strings.Join(a.Scopes, " "), a.RequestDigest, a.IssuedAt.UTC().Format(time.RFC3339Nano), a.ExpiresAt.UTC().Format(time.RFC3339Nano), a.Nonce}, "\n")
	want := hmacHex(v.key, []byte(material))
	if !hmac.Equal([]byte(signature), []byte(want)) {
		return GatewayAssertion{}, ErrGatewayUnauthorized
	}
	err = v.store.Update(func(state *Snapshot) error {
		for nonce, expiry := range state.GatewaySeen {
			if !now.Before(expiry) {
				delete(state.GatewaySeen, nonce)
			}
		}
		if _, exists := state.GatewaySeen[a.Nonce]; exists {
			return ErrGatewayUnauthorized
		}
		state.GatewaySeen[a.Nonce] = a.ExpiresAt
		return nil
	})
	if err != nil {
		return GatewayAssertion{}, ErrGatewayUnauthorized
	}
	return a, nil
}

func splitScopes(raw string) []string {
	fields := strings.Fields(raw)
	sort.Strings(fields)
	return fields
}
func sameScopes(a, b []string) bool {
	b2 := append([]string(nil), b...)
	sort.Strings(b2)
	return strings.Join(a, "\n") == strings.Join(b2, "\n")
}

func SignGatewayRequest(key []byte, request *http.Request, body []byte, assertion GatewayAssertion) (string, error) {
	account, err := nativewallet.NormalizeNativeAddress(assertion.Account)
	if err != nil {
		return "", err
	}
	scopes := append([]string(nil), assertion.Scopes...)
	sort.Strings(scopes)
	bodyHash := sha256.Sum256(body)
	material := strings.Join([]string{GatewayDomain, request.Method, request.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), account, assertion.SessionID, assertion.DeviceID, assertion.ProductID, assertion.ClientID, assertion.BundleID, assertion.Callback, assertion.ChainID, strings.Join(scopes, " "), assertion.RequestDigest, assertion.IssuedAt.UTC().Format(time.RFC3339Nano), assertion.ExpiresAt.UTC().Format(time.RFC3339Nano), assertion.Nonce}, "\n")
	if len(key) < 32 {
		return "", fmt.Errorf("invalid Gateway signing key")
	}
	return hmacHex(key, []byte(material)), nil
}
