package productsessionv2

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSocialBrowserSSOUsesExactIdentityOnlyRegistration(t *testing.T) {
	s, err := NewBrowserSSO("social", browserIssuer, []byte(strings.Repeat("s", 32)), []string{"profile", "conversations"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if s.origin != "https://social.ynxweb4.com" || s.audience != "ynx:social:identity" || s.identityCookie != "__Host-ynx-social-identity" {
		t.Fatal("Social registration or cookie isolation differs")
	}
	w := httptest.NewRecorder()
	s.Start(w, httptest.NewRequest("GET", s.origin+"/sso/start?target=conversations", nil))
	u := mustParseURL(t, w.Header().Get("Location"))
	if u.Query().Get("clientId") != "ynx-social-v1-sso-v1" || u.Query().Get("origin") != s.origin || u.Query().Get("redirectUri") != s.origin+"/sso/callback" {
		t.Fatal("Social authorization tuple differs from exact registry")
	}
	if _, err := NewBrowserSSO("social.evil", browserIssuer, []byte(strings.Repeat("s", 32)), []string{"profile"}, nil); err == nil {
		t.Fatal("unregistered product accepted")
	}
}
