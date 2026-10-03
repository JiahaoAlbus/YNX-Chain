package productsessionv2

import (
	"crypto/ed25519"
	"net/http"
	"slices"
)

// NewCalendarWebAuthority composes only the existing Calendar Web registration.
// Operator-owned credentials are supplied in memory; this function loads no
// keys/configuration, enrolls nobody and makes no network request. The original
// gateway remains responsible for explicit consent and the 240-second ceiling.
func NewCalendarWebAuthority(backendKeyID string, backendKey ed25519.PrivateKey, browserSealKey []byte, transport http.RoundTripper) (*RegisteredClientSet, *BrowserSSO, error) {
	policy := Policy{ProductID: "calendar", ClientID: "ynx-calendar-v1", ApplicationID: "com.ynxweb4.calendar.web", Platform: "web", Origin: "https://calendar.ynxweb4.com", Callback: "https://calendar.ynxweb4.com/wallet-auth/callback", AllowedScopes: []string{"calendar:account", "calendar:recover"}}
	client, err := NewClient(browserIssuer, policy, transport)
	if err != nil {
		return nil, nil, err
	}
	reader, err := NewPrivateBusinessRevalidator(client, "ynx-calendar-v1-business-web-v1", backendKeyID, backendKey)
	if err != nil {
		return nil, nil, err
	}
	set, err := NewRegisteredClientSet("calendar", []*Client{client}, []*Revalidator{reader})
	if err != nil {
		return nil, nil, err
	}
	browser, err := NewBrowserSSO("calendar", browserIssuer, browserSealKey, []string{"calendar", "events", "settings"}, transport)
	if err != nil {
		return nil, nil, err
	}
	if err = ValidateCalendarWebAuthority(set, browser); err != nil {
		return nil, nil, err
	}
	return set, browser, nil
}

// ValidateCalendarWebAuthority prevents zero-value or cross-product pointers
// from enabling the concrete Calendar dispatcher. It checks source policy,
// not live operator registration or user authority; every request still uses
// original proof verification and one combined Central decision.
func ValidateCalendarWebAuthority(set *RegisteredClientSet, browser *BrowserSSO) error {
	reject := func() error { return fail("CALENDAR_WEB_PROFILE_UNAVAILABLE", 503) }
	if set == nil || browser == nil || set.product != "calendar" || len(set.clients) != 1 || len(set.readers) != 1 {
		return reject()
	}
	c, r := set.clients["web"], set.readers["web"]
	if c == nil || r == nil || r.client != c || !r.business || r.backendClientID != "ynx-calendar-v1-business-web-v1" || r.keyID == "" || len(r.key) != ed25519.PrivateKeySize || c.endpoint != browserIssuer {
		return reject()
	}
	p := c.policy
	if p.ProductID != "calendar" || p.ClientID != "ynx-calendar-v1" || p.ApplicationID != "com.ynxweb4.calendar.web" || p.Platform != "web" || p.Origin != "https://calendar.ynxweb4.com" || p.Callback != p.Origin+"/wallet-auth/callback" || p.BundleID != nil || p.PackageID != nil || !slices.Equal(p.AllowedScopes, []string{"calendar:account", "calendar:recover"}) {
		return reject()
	}
	if browser.product != "calendar" || browser.origin != p.Origin || browser.clientID != "ynx-calendar-v1-sso-v1" || browser.audience != "ynx:calendar:identity" || browser.authority != browserIssuer || browser.aead == nil || browser.client == nil {
		return reject()
	}
	return nil
}
