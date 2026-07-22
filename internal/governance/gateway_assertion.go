package governance

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type GatewayAssertionAuthenticator struct {
	key     []byte
	roles   RoleResolver
	now     func() time.Time
	maxSkew time.Duration
	mu      sync.Mutex
	seen    map[string]time.Time
}

func NewGatewayAssertionAuthenticator(key []byte, roles RoleResolver, now func() time.Time) (*GatewayAssertionAuthenticator, error) {
	if len(key) < 32 || roles == nil {
		return nil, ErrInvalid
	}
	if now == nil {
		now = time.Now
	}
	return &GatewayAssertionAuthenticator{key: append([]byte(nil), key...), roles: roles, now: now, maxSkew: 30 * time.Second, seen: map[string]time.Time{}}, nil
}

func (a *GatewayAssertionAuthenticator) Authenticate(r *http.Request) (Principal, error) {
	account := strings.TrimSpace(r.Header.Get("X-YNX-Verified-Account"))
	device := strings.TrimSpace(r.Header.Get("X-YNX-Verified-Device-ID"))
	session := strings.TrimSpace(r.Header.Get("X-YNX-Verified-Session-ID"))
	product := strings.TrimSpace(r.Header.Get("X-YNX-Verified-Product"))
	nonce := strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Nonce"))
	timestampRaw := strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Timestamp"))
	signature := strings.TrimSpace(r.Header.Get("X-YNX-Gateway-Signature"))
	if account == "" || device == "" || session == "" || product != "governance" || len(nonce) < 16 || signature == "" {
		return Principal{}, errors.New("incomplete gateway assertion")
	}
	timestampUnix, err := strconv.ParseInt(timestampRaw, 10, 64)
	if err != nil {
		return Principal{}, errors.New("invalid gateway assertion timestamp")
	}
	at := time.Unix(timestampUnix, 0).UTC()
	now := a.now().UTC()
	delta := now.Sub(at)
	if delta < 0 {
		delta = -delta
	}
	if delta > a.maxSkew {
		return Principal{}, errors.New("expired gateway assertion")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 256*1024+1))
	if err != nil || len(body) > 256*1024 {
		return Principal{}, errors.New("gateway assertion body exceeds policy")
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	bodyHash := sha256.Sum256(body)
	message := strings.Join([]string{r.Method, r.URL.EscapedPath(), hex.EncodeToString(bodyHash[:]), account, device, session, product, timestampRaw, nonce}, "\n")
	mac := hmac.New(sha256.New, a.key)
	_, _ = mac.Write([]byte(message))
	expected := mac.Sum(nil)
	provided, err := hex.DecodeString(signature)
	if err != nil || !hmac.Equal(expected, provided) {
		return Principal{}, errors.New("invalid gateway assertion signature")
	}
	a.mu.Lock()
	for value, expires := range a.seen {
		if !now.Before(expires) {
			delete(a.seen, value)
		}
	}
	if _, ok := a.seen[nonce]; ok {
		a.mu.Unlock()
		return Principal{}, ErrReplay
	}
	a.seen[nonce] = now.Add(a.maxSkew)
	a.mu.Unlock()
	entitlements := a.roles(account, now)
	if len(entitlements.Roles) == 0 || len(entitlements.Scopes) == 0 {
		return Principal{}, errors.New("no active governance entitlement")
	}
	return Principal{Account: account, Product: product, DeviceID: device, SessionID: session, Roles: entitlements.Roles, Scopes: entitlements.Scopes}, nil
}

func SignGatewayAssertion(key []byte, method, path string, body []byte, identity SessionIdentity, product string, at time.Time, nonce string) string {
	bodyHash := sha256.Sum256(body)
	message := strings.Join([]string{method, path, hex.EncodeToString(bodyHash[:]), identity.Account, identity.DeviceID, identity.SessionID, product, strconv.FormatInt(at.UTC().Unix(), 10), nonce}, "\n")
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}
