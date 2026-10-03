package productsessionv2

import (
	"bytes"
	"crypto/ed25519"
	"net/http"
	"testing"
)

func TestCalendarWebProfileExactComposition(t *testing.T) {
	calls := 0
	transport := roundTrip(func(*http.Request) (*http.Response, error) {
		calls++
		t.Fatal("constructor made authority request")
		return nil, nil
	})
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{3}, ed25519.SeedSize))
	set, browser, err := NewCalendarWebAuthority("isolated-profile-only", key, bytes.Repeat([]byte{4}, 32), transport)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateCalendarWebAuthority(set, browser); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatal(calls)
	}
	if browser.clientID != "ynx-calendar-v1-sso-v1" || !bytes.Equal([]byte(set.clients["web"].policy.Callback), []byte("https://calendar.ynxweb4.com/wallet-auth/callback")) {
		t.Fatal("tuple changed")
	}
}
func TestCalendarWebProfileRejectsIncompleteOrBorrowedInput(t *testing.T) {
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{3}, ed25519.SeedSize))
	for _, tc := range []struct {
		id   string
		key  ed25519.PrivateKey
		seal []byte
	}{{"", key, bytes.Repeat([]byte{4}, 32)}, {"qa", nil, bytes.Repeat([]byte{4}, 32)}, {"qa", key, nil}} {
		if set, browser, err := NewCalendarWebAuthority(tc.id, tc.key, tc.seal, nil); err == nil || set != nil || browser != nil {
			t.Fatal("partial profile accepted")
		}
	}
	if ValidateCalendarWebAuthority(&RegisteredClientSet{}, &BrowserSSO{}) == nil {
		t.Fatal("zero profile accepted")
	}
	set, browser, err := NewCalendarWebAuthority("qa", key, bytes.Repeat([]byte{4}, 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewBrowserSSO("shop", browserIssuer, bytes.Repeat([]byte{4}, 32), []string{"orders"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if ValidateCalendarWebAuthority(set, other) == nil {
		t.Fatal("Shop identity borrowed")
	}
	set.clients["web"].policy.AllowedScopes = append(set.clients["web"].policy.AllowedScopes, "files.write")
	if ValidateCalendarWebAuthority(set, browser) == nil {
		t.Fatal("scope extension accepted")
	}
}
