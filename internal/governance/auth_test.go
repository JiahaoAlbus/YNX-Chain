package governance

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCanonicalAuthenticatorRejectsWrongProductDeviceExpiryRevokeAndNoRole(t *testing.T) {
	now := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	expiresAt := now.Add(time.Hour)
	revoked := false
	verify := func(binding, token, device string) (SessionIdentity, error) {
		if revoked || token != "token-1" || binding != "https://governance.test.ynx.network" {
			return SessionIdentity{}, errors.New("revoked")
		}
		return SessionIdentity{Account: "ynx1delegate", DeviceID: "device-1", SessionID: "session-1", ExpiresAt: expiresAt}, nil
	}
	roles := func(account string, _ time.Time) Entitlements {
		if account == "ynx1delegate" {
			return Entitlements{Roles: map[string]bool{"proposer": true}, Scopes: map[Scope]bool{ScopeBridge: true}}
		}
		return Entitlements{}
	}
	a, err := NewCanonicalAuthenticator("https://governance.test.ynx.network", verify, roles, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/governance/proposals", nil)
	request.Header.Set("Origin", "https://governance.test.ynx.network")
	request.Header.Set("X-YNX-App-Session", "token-1")
	request.Header.Set("X-YNX-Device-ID", "device-1")
	p, err := a.Authenticate(request)
	if err != nil || p.Account != "ynx1delegate" || !p.Roles["proposer"] {
		t.Fatalf("valid auth: %+v %v", p, err)
	}
	for name, mutate := range map[string]func(){"wrong product": func() { request.Header.Set("Origin", "https://wallet.test.ynx.network") }, "wrong device": func() { request.Header.Set("X-YNX-Device-ID", "device-2") }} {
		request.Header.Set("Origin", "https://governance.test.ynx.network")
		request.Header.Set("X-YNX-Device-ID", "device-1")
		mutate()
		if _, err = a.Authenticate(request); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	request.Header.Set("Origin", "https://governance.test.ynx.network")
	request.Header.Set("X-YNX-Device-ID", "device-1")
	now = now.Add(2 * time.Hour)
	if _, err = a.Authenticate(request); err == nil {
		t.Fatal("expired session accepted")
	}
	now = now.Add(-2 * time.Hour)
	revoked = true
	if _, err = a.Authenticate(request); err == nil {
		t.Fatal("revoked session accepted")
	}
}
