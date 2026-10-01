package social

import (
	"errors"
	"reflect"
	"testing"
)

func TestLoginDoesNotElevateIdentityIntoPrivateScopes(t *testing.T) {
	s, now := testService(t)
	result, err := s.Login(signedLogin(t, s, newFixture(t, 51), now, walletScopes...))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Session.Scopes) != 0 {
		t.Fatal("identity-only approval gained private scopes")
	}
	for scope := range allowedScopes {
		if _, err := s.Authenticate(result.Token, scope); !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("identity approval authorized %s", scope)
		}
	}
}

func TestLoginRetainsOnlyExplicitRegisteredSocialScopes(t *testing.T) {
	s, now := testService(t)
	result, err := s.Login(signedLogin(t, s, newFixture(t, 52), now, "account:read", "profile:link", "social.profile"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result.Session.Scopes, []string{"social.profile"}) {
		t.Fatalf("unexpected private scopes: %v", result.Session.Scopes)
	}
	if _, err := s.Authenticate(result.Token, "social.profile"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Authenticate(result.Token, "social.messaging"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("profile approval authorized messaging")
	}
}

func TestWalletScopesRejectUnregisteredOrAmbiguousPermissions(t *testing.T) {
	for _, scopes := range [][]string{nil, {"social.ai"}, {"social.feed"}, {"social.*"}, {"social.profile", "social.messaging"}, {"social.messaging", "social.messaging"}} {
		if validWalletScopes(scopes) {
			t.Fatalf("accepted noncanonical or unregistered scopes: %v", scopes)
		}
	}
}
