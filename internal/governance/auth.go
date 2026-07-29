package governance

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SessionIdentity struct {
	Account, DeviceID, SessionID string
	ExpiresAt                    time.Time
}
type SessionVerifier func(binding, token, deviceID string) (SessionIdentity, error)
type RoleResolver func(account string, asOf time.Time) Entitlements

type CanonicalAuthenticator struct {
	Origin string
	Verify SessionVerifier
	Roles  RoleResolver
	Now    func() time.Time
}

func NewCanonicalAuthenticator(origin string, verify SessionVerifier, roles RoleResolver, now func() time.Time) (*CanonicalAuthenticator, error) {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil || verify == nil || roles == nil {
		return nil, ErrInvalid
	}
	if now == nil {
		now = time.Now
	}
	return &CanonicalAuthenticator{Origin: origin, Verify: verify, Roles: roles, Now: now}, nil
}

func (a *CanonicalAuthenticator) Authenticate(r *http.Request) (Principal, error) {
	if strings.TrimSpace(r.Header.Get("Origin")) != a.Origin {
		return Principal{}, errors.New("wrong governance product binding")
	}
	token := strings.TrimSpace(r.Header.Get("X-YNX-App-Session"))
	device := strings.TrimSpace(r.Header.Get("X-YNX-Device-ID"))
	if token == "" || device == "" {
		return Principal{}, errors.New("session and device required")
	}
	identity, err := a.Verify(a.Origin, token, device)
	if err != nil || identity.Account == "" || identity.DeviceID != device || identity.SessionID == "" || !a.Now().UTC().Before(identity.ExpiresAt.UTC()) {
		return Principal{}, errors.New("session introspection failed")
	}
	entitlements := a.Roles(identity.Account, a.Now().UTC())
	if len(entitlements.Roles) == 0 || len(entitlements.Scopes) == 0 {
		return Principal{}, errors.New("no active governance role")
	}
	return Principal{Account: identity.Account, Product: "governance", DeviceID: identity.DeviceID, SessionID: identity.SessionID, Roles: entitlements.Roles, Scopes: entitlements.Scopes}, nil
}
